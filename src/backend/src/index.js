/* ────────────────────────────────────────────────────────────────
   Argo-Helm-Toggler – backend
   ─────────────────────────────────────────────────────────────── */

import express       from "express";
import helmet        from "helmet";
import axios         from "axios";
import yaml          from "js-yaml";
import fs            from "fs/promises";
import path          from "node:path";
import { spawnSync } from "node:child_process";

import cfg                       from "./config.js";
import { ensureRepo, listAppFiles } from "./git.js";
import { deltaYaml }             from "./diff.js";
import { triggerWebhook,
         triggerDeleteWebhook }   from "./argo.js";

/* ─── constants & env overrides ───────────────────────────────── */
const CHARTS_ROOT   = process.env.CHARTS_ROOT   || "charts/external";
const VALUES_SUBDIR = process.env.VALUES_SUBDIR || "values";

/* ─── express app & middle-ware ───────────────────────────────── */
const app = express();
app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

/* ─── clone Git repo once on boot (non-blocking) ─────────────── */
ensureRepo()
  .then(dir => console.log("[DEBUG] Git repo cloned to", dir))
  .catch(e  => console.error("❌  Git clone failed:", e));

/* ============================================================= */
/* 1.  List YAML files for tabs                                   */
/* ============================================================= */
app.get("/api/files", async (_req, res) => {
  const full = await listAppFiles();
  res.json(full.map(p => path.resolve(p)));
});

/* ============================================================= */
/* 2.  Flatten `appProjects` ↦ array of { project,file,app }      */
/* ============================================================= */
app.get("/api/apps", async (req, res) => {
  const targets = req.query.file
    ? [path.resolve(req.query.file)]
    : await listAppFiles();

  const flat = [];
  for (const f of targets) {
    const txt = await fs.readFile(f, "utf8");
    const y   = yaml.load(txt) || {};
    (y.appProjects || []).forEach(proj =>
      (proj.applications || []).forEach(app =>
        flat.push({ project: proj.name, file: f, app })));
  }
  res.json(flat);
});

/* ============================================================= */
/* 3.  ArtifactHub search (≥4 chars, 1 h cache)                   */
/* ============================================================= */
const searchCache = new Map();                           // q → { t, d }
const TTL = 60 * 60 * 1000;                              // 1 hour

app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 4)
    return res.status(400).json({ error: "query must be ≥ 4 characters" });

  const hit = searchCache.get(q);
  if (hit && Date.now() - hit.t < TTL) return res.json(hit.d);

  const url =
    `https://artifacthub.io/api/v1/packages/search?kind=0&limit=20&ts_query_web=${encodeURIComponent(q)}`;
  console.log(`[DEBUG] curl -s "${url}"`);

  try {
    const { data } = await axios.get(url, { timeout: 10_000 });
    const out = (data.packages || []).map(p => ({
      name       : p.name,
      repo       : p.repo?.url || p.repository?.url || "",
      version    : p.version,
      displayName: p.displayName,
      logo       : p.logoImageId ? `https://artifacthub.io/image/${p.logoImageId}` : null,
    }));
    searchCache.set(q, { t: Date.now(), d: out });
    res.json(out);
  } catch (e) {
    console.error("[ArtifactHub]", e.message);
    res.status(e.response?.status || 502).json({ error: "ArtifactHub error" });
  }
});

/* ============================================================= */
/* 4.  Values & chart metadata popup                              */
/*       – default chart values   (…/charts/external/…/values.yaml) */
/*       – override values file   (<VALUES_SUBDIR>/<app-name>.yml)  */
/* ============================================================= */
app.get("/api/app/values", async (req, res) => {
  const { project, name, chart, version, repoURL, file } = req.query;
  if (!project || !name)
    return res.status(400).json({ error: "params missing" });

  const repoRoot = await ensureRepo();          // already cloned
  const fileDir  = path.dirname(file);          // same dir as YAML

  /* prefer .yml – fall back to .yaml for legacy repos */
  const overrideCandidates = [
    path.join(fileDir, VALUES_SUBDIR, `${name}.yml`),
    path.join(fileDir, VALUES_SUBDIR, `${name}.yaml`),
  ];

  const owner = (repoURL || "")
    .split("/")
    .filter(Boolean)
    .pop() || "unknown";
  const chartDir = path.join(repoRoot, CHARTS_ROOT, owner, chart, version);
  const defaultYamlFile = path.join(chartDir, "values.yaml");
  const chartMetaFile   = path.join(chartDir, "Chart.yaml");

  let overrideY = "", defaultY = "", meta = {};
  /* —— override search (first hit wins) —— */
  for (const p of overrideCandidates) {
    try { overrideY = await fs.readFile(p, "utf8"); break; } catch {}
  }
  /* —— chart-default YAML —— */
  try { defaultY = await fs.readFile(defaultYamlFile, "utf8"); } catch {}
  /* —— Chart.yaml meta —— */
  try {
    const m = yaml.load(await fs.readFile(chartMetaFile, "utf8")) || {};
    meta.description = m.description || "";
    meta.home        = m.home || "";
    meta.maintainers = (m.maintainers || []).map(x => x.name || x.email || x);
  } catch {/* ignore */}
  res.json({ defaultValues: defaultY, overrideValues: overrideY, meta });
});

/* ============================================================= */
/* 5.  Install / update webhook                                   */
/* ============================================================= */
app.post("/api/apps", async (req, res) => {
  const {
    chart, repo, version, release, namespace,
    userValuesYaml, project = namespace,
  } = req.body;

  if (!chart || !repo || !release || !namespace)
    return res.status(400).json({ error: "missing fields" });

  const helm = spawnSync("helm", [
    "show", "values",
    `${repo.endsWith("/") ? repo : repo + "/"}${chart}`,
    "--version", version,
  ]);
  if (helm.status !== 0)
    return res.status(500).send(helm.stderr.toString());

  const delta = deltaYaml(helm.stdout.toString(), userValuesYaml);
  await triggerWebhook({
    chart, repo, version, release,
    namespace, project, values_yaml: delta,
  });
  res.json({ ok: true });
});

/* ============================================================= */
/* 6.  Delete webhook                                             */
/* ============================================================= */
app.post("/api/apps/delete", async (req, res) => {
  const { release, namespace } = req.body || {};
  if (!release || !namespace)
    return res.status(400).json({ error: "release & namespace required" });

  await triggerDeleteWebhook({ release, namespace });
  res.json({ ok: true });
});

/* ============================================================= */
app.listen(cfg.port, () =>
  console.log(`✔︎ argo-helm-toggler backend listening on ${cfg.port}`)
);
