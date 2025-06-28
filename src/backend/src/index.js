import express       from "express";
import helmet        from "helmet";
import axios         from "axios";
import yaml          from "js-yaml";
import fs            from "fs/promises";
import path          from "node:path";
import { spawnSync } from "node:child_process";

import cfg                       from "./config.js";
import { ensureRepo,
         listAppFiles }          from "./git.js";
import { deltaYaml }             from "./diff.js";
import { triggerWebhook,
         triggerDeleteWebhook }   from "./argo.js";

const CHARTS_ROOT   = process.env.CHARTS_ROOT   || "charts/external";
const VALUES_SUBDIR = process.env.VALUES_SUBDIR || "values";

const app = express();
app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

/* ── pre-clone on boot ─────────────────────────────────────────── */
ensureRepo()
  .then(dir => console.log("[DEBUG] Git repo cloned to", dir))
  .catch(e  => console.error("❌  Git clone failed:", e));


/* ── 1. files list ──────────────────────────────────────────────── */
app.get("/api/files", async (_req, res) => {
  const full = await listAppFiles();
  res.json(full.map((p) => path.resolve(p)));
});

/* ── 2. flatten appProjects → apps array ───────────────────────── */
app.get("/api/apps", async (req, res) => {
  const targets = req.query.file
    ? [path.resolve(req.query.file)]
    : await listAppFiles();

  const flat = [];
  for (const f of targets) {
    const txt = await fs.readFile(f, "utf8");
    const y   = yaml.load(txt) || {};
    (y.appProjects || []).forEach((proj) =>
      (proj.applications || []).forEach((app) =>
        flat.push({ project: proj.name, file: f, app }))
    );
  }
  res.json(flat);
});

/* ── 3. ArtifactHub search (≥4 chars, 1-h cache) ───────────────── */
const searchCache = new Map(); const TTL = 60 * 60 * 1000;
app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 4) return res.status(400).json({ error: "≥4 chars" });

  const c = searchCache.get(q);
  if (c && Date.now() - c.t < TTL) return res.json(c.d);

  const url = `https://artifacthub.io/api/v1/packages/search?kind=0&limit=20&ts_query_web=${encodeURIComponent(q)}`;
  console.log(`[DEBUG] curl -s "${url}"`);
  try {
    const { data } = await axios.get(url, { timeout: 10_000 });
    const out = (data.packages || []).map((p) => ({
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

/* ── 4. on-click details – default & override YAML ─────────────── */
app.get("/api/app/values", async (req, res) => {
  const { project, name, chart, version, repoURL, file } = req.query;
  if (!project || !name) return res.status(400).json({ error: "params missing" });

  /* paths relative to repo root ---------------------------------- */
  const repoRoot = await ensureRepo();
  const fileDir  = path.dirname(file);                         // same dir as YAML
  const valuesPath = path.join(fileDir, VALUES_SUBDIR, `${name}.yaml`);

  /* charts/external/<owner>/<chart>/<version>/values.yaml -------- */
  const owner     = (repoURL || "").split("/").filter(Boolean).pop() || "unknown";
  const chartPath = path.join(repoRoot, CHARTS_ROOT, owner, chart, version, "values.yaml");

  let overrideY = "", defaultY = "";
  try { overrideY = await fs.readFile(valuesPath, "utf8"); } catch {}
  try { defaultY  = await fs.readFile(chartPath, "utf8");  } catch {}

  res.json({ defaultValues: defaultY, overrideValues: overrideY });
});

/* ── 5. webhook create / update ────────────────────────────────── */
app.post("/api/apps", async (req, res) => {
  const { chart, repo, version, release, namespace,
          userValuesYaml, project = namespace } = req.body;
  if (!chart || !repo || !release || !namespace)
    return res.status(400).json({ error: "missing fields" });

  const helm = spawnSync("helm", [
    "show","values",
    `${repo.endsWith("/") ? repo : repo + "/"}${chart}`,
    "--version", version,
  ]);
  if (helm.status !== 0) return res.status(500).send(helm.stderr.toString());

  const delta = deltaYaml(helm.stdout.toString(), userValuesYaml);
  await triggerWebhook({ chart, repo, version, release,
                         namespace, project, values_yaml: delta });
  res.json({ ok: true });
});

/* ── 6. delete ─────────────────────────────────────────────────── */
app.post("/api/apps/delete", async (req, res) => {
  const { release, namespace } = req.body || {};
  if (!release || !namespace)
    return res.status(400).json({ error: "release & namespace required" });
  await triggerDeleteWebhook({ release, namespace });
  res.json({ ok: true });
});

/* ──────────────────────────────────────────────────────────────── */
app.listen(cfg.port, () =>
  console.log(`✔︎ argo-helm-toggler backend listening on ${cfg.port}`)
);
