/*  src/backend/src/index.js
    ────────────────────────────────────────────────────────────────
    Improvements
    • repoURL is ignored – chart location is inferred from the `path`
      field ( …/external/<OWNER>/<CHART>/<VER>/ ).
    • values files can have .yaml **or** .yml extension.
    • extra DEBUG logs for:
        – /api/app/values     (override + default file chosen)
        – /api/chart/versions (folder scan)
        – /api/chart/values   (each path attempt)
    • graceful fall-back to charts/external/… and “file not found”
      situations never break the UI – you’ll just see an empty result.
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

/* ── folders inside the Git repo ──────────────────────────────── */
export const CHARTS_ROOT   = process.env.CHARTS_ROOT   || "charts";
export const VALUES_SUBDIR = process.env.VALUES_SUBDIR || "values";

/* ── helper: read the first existing file from a list ─────────── */
async function readFirst(candidatePaths) {
  for (const p of candidatePaths) {
    try { return await fs.readFile(p, "utf8"); } catch {}
  }
  return "";
}

const app = express();
app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

/* ── pre-clone repo so the first request is instant ───────────── */
ensureRepo()
  .then(dir => console.log("[DEBUG] Git repo cloned to", dir))
  .catch(e  => console.error("❌  Git clone failed:", e));

/* ═══════════════════════════════════════════════════════════════
   1.  List all *app-of-apps*.yml files        →  /api/files
   ═════════════════════════════════════════════════════════════ */
app.get("/api/files", async (_req, res) => {
  const full = await listAppFiles();
  res.json(full.map(p => path.resolve(p)));
});

/* ═══════════════════════════════════════════════════════════════
   2.  Flatten   appProjects[]  →  applications[]   →  /api/apps
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
        flat.push({ project: proj.name, file: f, app }))
    );
  }
  res.json(flat);
});

/* ═══════════════════════════════════════════════════════════════
   3.  ArtifactHub search (≥4 chars, 1 h cache)  →  /api/search
   ═════════════════════════════════════════════════════════════ */
const searchCache = new Map();            //   { q => {t, d} }
const TTL = 60 * 60 * 1000;               //   1 h

app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 4) return res.status(400).json({ error: "≥4 chars" });

  const  c = searchCache.get(q);
  if (c && Date.now() - c.t < TTL) return res.json(c.d);

  const url = "https://artifacthub.io/api/v1/packages/search" +
              "?kind=0&limit=20&ts_query_web=" + encodeURIComponent(q);
  console.log("[search] %s", url);

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
    searchCache.set(q,{t:Date.now(),d:out});
    res.json(out);
  } catch (e) {
    console.error("[search] ArtifactHub", e.message);
    res.status(e.response?.status || 502).json({ error:"ArtifactHub error" });
  }
});

/* ═══════════════════════════════════════════════════════════════
   4.  Chart default & override values for App-details modal
       → /api/app/values
   ═════════════════════════════════════════════════════════════ */
app.get("/api/app/values", async (req, res) => {
  const { project, name, chart, version, path: chartPath, file } = req.query;
  if (!project || !name) return res.status(400).json({ error:"params missing" });

  const repoRoot = await ensureRepo();
  const fileDir  = path.dirname(file);

  /* override file – try both .yaml & .yml */
  const overridePaths = [
    path.join(fileDir, VALUES_SUBDIR, `${name}.yaml`),
    path.join(fileDir, VALUES_SUBDIR, `${name}.yml`)
  ];
  const overrideY = await readFirst(overridePaths);

  /* deduce owner / chart / ver either from explicit fields or from `path` */
  let owner = "unknown", ch = chart, ver = version;
  if (!chartPath && (!chart || !version)) {
    return res.json({ defaultValues:"", overrideValues:overrideY });
  }
  if (!chart || !version) {
    const seg = chartPath.split("/").filter(Boolean);
    ver  = seg.at(-1);
    ch   = seg.at(-2);
    owner= seg.at(-3) || "unknown";
  } else {
    owner = (chartPath || "").split("/").filter(Boolean).at(-3) || "unknown";
  }

  /* locate default values in <CHARTS_ROOT> or charts/external */
  const defaultPaths = [
    path.join(repoRoot, CHARTS_ROOT, owner, ch, ver, "values.yaml"),
    path.join(repoRoot, CHARTS_ROOT, owner, ch, ver, "values.yml"),
    path.join(repoRoot, CHARTS_ROOT, "external", owner, ch, ver,"values.yaml"),
    path.join(repoRoot, CHARTS_ROOT, "external", owner, ch, ver,"values.yml")
  ];
  const defaultY = await readFirst(defaultPaths);

  console.log("[vals] %s/%s – override %s  default %s",
              project, name,
              overrideY ? "✔︎" : "✖︎",
              defaultY  ? "✔︎" : "✖︎");

  res.json({ defaultValues: defaultY, overrideValues: overrideY });
});

/* ═══════════════════════════════════════════════════════════════
   5.  List versions available in repo            → /api/chart/versions
   ═════════════════════════════════════════════════════════════ */
app.get("/api/chart/versions", async (req, res) => {
  const { owner = "unknown", chart } = req.query;
  if (!chart) return res.status(400).json({ error:"chart required" });

  try {
    const repoRoot = await ensureRepo();
    const attempts = [
      path.join(repoRoot, CHARTS_ROOT, owner, chart),
      path.join(repoRoot, CHARTS_ROOT, "external", owner, chart)
    ];

    let dirents = [];
    for (const base of attempts) {
      try {
        dirents = await fs.readdir(base, { withFileTypes:true });
        console.log("[versions] %s → %d dirs",
                    path.relative(repoRoot, base), dirents.length);
        if (dirents.length) break;
      } catch {}
    }
    res.json(dirents.filter(d=>d.isDirectory())
                    .map(d=>d.name).sort().reverse());
  } catch (err) {
    console.error("[versions] ERROR", owner, chart, err.message);
    res.json([]);           // keeps UI functional
  }
});

/* ═══════════════════════════════════════════════════════════════
   6.  Fetch chart’s default values.yaml/yml  → /api/chart/values
   ═════════════════════════════════════════════════════════════ */
app.get("/api/chart/values", async (req, res) => {
  const { owner="unknown", chart, ver } = req.query;
  if (!chart || !ver) return res.status(400).json({ error:"missing fields" });

  try {
    const repoRoot = await ensureRepo();
    const paths = [
      path.join(repoRoot, CHARTS_ROOT, owner, chart, ver, "values.yaml"),
      path.join(repoRoot, CHARTS_ROOT, owner, chart, ver, "values.yml"),
      path.join(repoRoot, CHARTS_ROOT, "external", owner, chart, ver, "values.yaml"),
      path.join(repoRoot, CHARTS_ROOT, "external", owner, chart, ver, "values.yml")
    ];

    console.log("[chart/values] %s/%s@%s", owner, chart, ver);
    paths.forEach(p => console.log("  ↳", path.relative(repoRoot, p)));

    const txt = await readFirst(paths);
    res.type("text/plain").send(txt || "# (no default values)");
  } catch (err) {
    console.error("[chart/values] ERROR", owner, chart, ver, err.message);
    res.type("text/plain").send("# (failed to read default values)");
  }
});

/* ═══════════════════════════════════════════════════════════════
   7.  Create / update  (triggers deploy webhook)
   ═════════════════════════════════════════════════════════════ */
app.post("/api/apps", async (req, res) => {
  const { chart, repo, version, release, namespace,
          userValuesYaml, project = namespace } = req.body;
  if (!chart || !release || !namespace)
    return res.status(400).json({ error:"missing fields" });

  /* `repo` can still be useful for helm show values */
  const helm = spawnSync("helm", [
    "show","values",
    `${repo?.endsWith("/") ? repo : (repo||"") + "/"}${chart}`,
    "--version", version
  ]);
  if (helm.status !== 0)
    return res.status(500).send(helm.stderr.toString());

  const delta = deltaYaml(helm.stdout.toString(), userValuesYaml || "");
  await triggerWebhook({ chart, repo, version, release,
                         namespace, project, values_yaml: delta });
  res.json({ ok:true });
});

/* ═══════════════════════════════════════════════════════════════
   8.  Delete
   ═════════════════════════════════════════════════════════════ */
app.post("/api/apps/delete", async (req, res) => {
  const { release, namespace } = req.body || {};
  if (!release || !namespace)
    return res.status(400).json({ error:"release & namespace required" });

  await triggerDeleteWebhook({ release, namespace });
  res.json({ ok:true });
});

/* ─────────────────────────────────────────────────────────────── */
app.listen(cfg.port, () =>
  console.log(`✔︎ argo-helm-toggler backend listening on ${cfg.port}`));
