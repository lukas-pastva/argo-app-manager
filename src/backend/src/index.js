/*  src/backend/src/index.js
    ───────────────────────────────────────────────
    Express-based API for the Argo-Helm-Toggler UI.
    – repoURL is ignored; chart location comes from `path`
    – values files may use .yaml **or** .yml
*/

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

/* ── folders inside the Git repo ─────────────────────────────── */
export const CHARTS_ROOT   = process.env.CHARTS_ROOT   || "charts";
export const VALUES_SUBDIR = process.env.VALUES_SUBDIR || "values";

/* ── tiny helper: read the 1st existing file in a list ───────── */
async function readFirst(paths) {
  for (const p of paths) {
    try { return await fs.readFile(p, "utf8"); } catch { /*ignore*/ }
  }
  return "";          // nothing found → empty string
}

const app = express();
app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

/* ── pre-clone the repo on boot so first UI load is faster ───── */
ensureRepo()
  .then(dir => console.log("[DEBUG] Git repo cloned to", dir))
  .catch(e  => console.error("❌  Git clone failed:", e));

/* ═══════════════════════════════════════════════════════════════
   1.  List YAML files (app-of-apps*)
   ═════════════════════════════════════════════════════════════ */
app.get("/api/files", async (_req, res) => {
  const full = await listAppFiles();
  res.json(full.map(p => path.resolve(p)));
});

/* ═══════════════════════════════════════════════════════════════
   2.  Flatten appProjects → apps[]
   ═════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════
   3.  ArtifactHub search  (≥4 chars, 1-h cache)
   ═════════════════════════════════════════════════════════════ */
const searchCache = new Map(); const TTL = 60 * 60 * 1_000;
app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 4) return res.status(400).json({ error: "≥4 chars" });

  const cached = searchCache.get(q);
  if (cached && Date.now() - cached.t < TTL) return res.json(cached.d);

  const url = "https://artifacthub.io/api/v1/packages/search" +
              "?kind=0&limit=20&ts_query_web=" + encodeURIComponent(q);
  console.log(`[DEBUG] curl -s "${url}"`);
  try {
    const { data } = await axios.get(url, { timeout: 10_000 });
    const out = (data.packages || []).map(p => ({
      name       : p.name,
      repo       : p.repo?.url || p.repository?.url || "",
      version    : p.version,
      displayName: p.displayName,
      description: p.description,
      logo       : p.logoImageId
                   ? `https://artifacthub.io/image/${p.logoImageId}` : null
    }));
    searchCache.set(q, { t: Date.now(), d: out });
    res.json(out);
  } catch (e) {
    console.error("[ArtifactHub]", e.message);
    res.status(e.response?.status || 502).json({ error: "ArtifactHub error" });
  }
});

/* ═══════════════════════════════════════════════════════════════
   4.  Chart default & override values for modal
       – repoURL ignored; path-based lookup
       – supports both .yaml and .yml
   ═════════════════════════════════════════════════════════════ */
app.get("/api/app/values", async (req, res) => {
  const { project, name, version, path: chartPath, file } = req.query;
  if (!project || !name)
    return res.status(400).json({ error: "params missing" });

  const repoRoot = await ensureRepo();
  const fileDir  = path.dirname(file);

  /* override file – prefer .yaml, fallback to .yml */
  const overrideY = await readFirst([
    path.join(fileDir, VALUES_SUBDIR, `${name}.yaml`),
    path.join(fileDir, VALUES_SUBDIR, `${name}.yml`)
  ]);

  /* default chart values */
  let defaultY = "";
  if (chartPath) {                              // modern “path” style
    defaultY = await readFirst([
      path.join(repoRoot, CHARTS_ROOT, chartPath, "values.yaml"),
      path.join(repoRoot, CHARTS_ROOT, chartPath, "values.yml")
    ]);
  } else {                                      // legacy fields
    // chart & owner part sit in chartPath in legacy so we derive from version
    const segments = (req.query.chart || "").split("/");
    const chart = segments.pop();
    defaultY = await readFirst([
      path.join(repoRoot, CHARTS_ROOT, chart, version, "values.yaml"),
      path.join(repoRoot, CHARTS_ROOT, chart, version, "values.yml")
    ]);
  }

  /* DEBUG ─────────────────────────────────────────────── */
  console.log("[vals] %s / %s → override:%s default:%s",
              project, name,
              overrideY ? "✔︎" : "✖︎",
              defaultY  ? "✔︎" : "✖︎");

  res.json({ defaultValues: defaultY, overrideValues: overrideY });
});

/* ═══════════════════════════════════════════════════════════════
   5 & 6.  (Install wizard endpoints)  – unchanged
   ═════════════════════════════════════════════════════════════ */
app.get("/api/chart/versions", async (req, res) => {
  const { owner = "unknown", chart } = req.query;
  if (!chart) return res.status(400).json({ error: "chart required" });

  try {
    const repoRoot = await ensureRepo();
    const baseDir  = path.join(repoRoot, CHARTS_ROOT, owner, chart);
    const dirents  = await fs.readdir(baseDir, { withFileTypes: true });
    res.json(dirents.filter(d => d.isDirectory())
                    .map(d => d.name).sort().reverse());
  } catch { res.json([]); }
});

app.get("/api/chart/values", async (req, res) => {
  const { owner = "unknown", chart, ver } = req.query;
  if (!chart || !ver) return res.status(400).json({ error: "missing fields" });

  try {
    const repoRoot = await ensureRepo();
    const txt = await readFirst([
      path.join(repoRoot, CHARTS_ROOT, owner, chart, ver, "values.yaml"),
      path.join(repoRoot, CHARTS_ROOT, owner, chart, ver, "values.yml")
    ]);
    res.type("text/plain").send(txt || "# (no default values file)");
  } catch {
    res.type("text/plain").send("# (no default values file)");
  }
});

/* ═══════════════════════════════════════════════════════════════
   7.  Create / update (webhook) – unchanged
   ═════════════════════════════════════════════════════════════ */
app.post("/api/apps", async (req, res) => {
  const { chart, repo, version, release, namespace,
          userValuesYaml, project = namespace } = req.body;
  if (!chart || !repo || !release || !namespace)
    return res.status(400).json({ error: "missing fields" });

  const helm = spawnSync("helm", [
    "show", "values",
    `${repo.endsWith("/") ? repo : repo + "/"}${chart}`,
    "--version", version
  ]);
  if (helm.status !== 0)
    return res.status(500).send(helm.stderr.toString());

  const delta = deltaYaml(helm.stdout.toString(), userValuesYaml);
  await triggerWebhook({ chart, repo, version, release,
                         namespace, project, values_yaml: delta });
  res.json({ ok: true });
});

/* ═══════════════════════════════════════════════════════════════
   8.  Delete – unchanged
   ═════════════════════════════════════════════════════════════ */
app.post("/api/apps/delete", async (req, res) => {
  const { release, namespace } = req.body || {};
  if (!release || !namespace)
    return res.status(400).json({ error: "release & namespace required" });

  await triggerDeleteWebhook({ release, namespace });
  res.json({ ok: true });
});

/* ─────────────────────────────────────────────────────────────── */
app.listen(cfg.port, () =>
  console.log(`✔︎ argo-helm-toggler backend listening on ${cfg.port}`));
