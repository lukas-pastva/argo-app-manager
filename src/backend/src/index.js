/* ────────────────────────────────────────────────────────────────
   Argo-Helm-Toggler – backend
   src/backend/src/index.js
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

/* ── env-tunable paths ───────────────────────────────────────── */
const CHARTS_ROOT   = process.env.CHARTS_ROOT   || "charts";   // ← default changed
const VALUES_SUBDIR = process.env.VALUES_SUBDIR || "values";

/* ── express bootstrap ───────────────────────────────────────── */
const app = express();
app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

/* clone repo once on boot (non-blocking) */
ensureRepo()
  .then(dir => console.log("[DEBUG] Git repo cloned to", dir))
  .catch(e  => console.error("❌  Git clone failed:", e));

/* ============================================================= *
 * 1. List YAML files (tabs)                                      *
 * ============================================================= */
app.get("/api/files", async (_req, res) => {
  const full = await listAppFiles();
  res.json(full.map(p => path.resolve(p)));
});

/* ============================================================= *
 * 2. Flatten appProjects → apps                                  *
 * ============================================================= */
app.get("/api/apps", async (req, res) => {
  const targets = req.query.file
    ? [path.resolve(req.query.file)]
    : await listAppFiles();

  const out = [];
  for (const f of targets) {
    const txt = await fs.readFile(f, "utf8");
    const y   = yaml.load(txt) || {};
    (y.appProjects || []).forEach(proj =>
      (proj.applications || []).forEach(app =>
        out.push({ project: proj.name, file: f, app })));
  }
  res.json(out);
});

/* ============================================================= *
 * 3. ArtifactHub search (≥4 chars, cached 1 h)                   *
 * ============================================================= */
const cache = new Map();                    // q → { t, res }
const TTL   = 60 * 60 * 1000;               // 1 h

app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 4) return res.status(400).json({ error: "≥4 characters" });

  const hit = cache.get(q);
  if (hit && Date.now() - hit.t < TTL) return res.json(hit.res);

  const url = `https://artifacthub.io/api/v1/packages/search?kind=0&limit=20&ts_query_web=${encodeURIComponent(q)}`;
  console.log(`[DEBUG] curl -s "${url}"`);

  try {
    const { data } = await axios.get(url, { timeout: 10_000 });
    const resBody = (data.packages || []).map(p => ({
      name       : p.name,
      repo       : p.repo?.url || p.repository?.url || "",
      version    : p.version,
      displayName: p.displayName,
      logo       : p.logoImageId ? `https://artifacthub.io/image/${p.logoImageId}` : null,
    }));
    cache.set(q, { t: Date.now(), res: resBody });
    res.json(resBody);
  } catch (e) {
    console.error("[ArtifactHub]", e.message);
    res.status(e.response?.status || 502).json({ error: "ArtifactHub error" });
  }
});

/* ============================================================= *
 * 4. Chart & values popup                                        *
 * ============================================================= */
app.get("/api/app/values", async (req, res) => {
  const { project, name, chart, version, repoURL, file, path: helmPath } = req.query;

  if (!project || !name)
    return res.status(400).json({ error: "required params missing" });

  /* —— where is the repo on disk? —— */
  const repoRoot = await ensureRepo();            // already cloned
  const fileDir  = path.dirname(file);            // dir of app-of-apps file

  /* —— override: <VALUES_SUBDIR>/<name>.yml | .yaml —— */
  const overrideFiles = [
    path.join(fileDir, VALUES_SUBDIR, `${name}.yml`),
    path.join(fileDir, VALUES_SUBDIR, `${name}.yaml`),
  ];

  /* —— chart directory ——                                           *
   *  1) If Application.spec.path present → CHARTS_ROOT + that path   *
   *  2) Else fallback owner/chart/version (old style)                */
  let chartDir;
  if (helmPath) {
    chartDir = path.join(repoRoot, CHARTS_ROOT, helmPath);
  } else {
    const owner = (repoURL || "").split("/").filter(Boolean).pop() || "unknown";
    chartDir    = path.join(repoRoot, CHARTS_ROOT, owner, chart, version);
  }

  const defaultYamlFile = path.join(chartDir, "values.yaml");
  const chartYamlFile   = path.join(chartDir, "Chart.yaml");

  /* read files (ignore ENOENT) */
  const read = async p => {
    try { return await fs.readFile(p, "utf8"); } catch { return ""; }
  };

  let override = "";
  for (const p of overrideFiles) {
    override = await read(p);
    if (override) break;
  }

  const def   = await read(defaultYamlFile);
  const metaY = await read(chartYamlFile);
  let meta = {};
  if (metaY) {
    try {
      const m = yaml.load(metaY) || {};
      meta = {
        description: m.description || "",
        home       : m.home || "",
        maintainers: (m.maintainers || []).map(x => x.name || x.email || x),
      };
    } catch {/* ignore parse errors */}
  }

  res.json({ defaultValues: def, overrideValues: override, meta });
});

/* ============================================================= *
 * 5. Install / update webhook → CI                               *
 * ============================================================= */
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

/* ============================================================= *
 * 6. Delete webhook                                              *
 * ============================================================= */
app.post("/api/apps/delete", async (req, res) => {
  const { release, namespace } = req.body || {};
  if (!release || !namespace)
    return res.status(400).json({ error: "release & namespace required" });

  await triggerDeleteWebhook({ release, namespace });
  res.json({ ok: true });
});

/* ============================================================= */
app.listen(cfg.port, () =>
  console.log(`✔︎ argo-helm-toggler backend listening on ${cfg.port}`));
