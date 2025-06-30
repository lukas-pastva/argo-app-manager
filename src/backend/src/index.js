/*  ────────────────────────────────────────────────────────────────
    Argo-Helm-Toggler – backend
    © 2025 • MIT • @lukas
    ──────────────────────────────────────────────────────────────── */

import express  from "express";
import helmet   from "helmet";
import axios    from "axios";
import yaml     from "js-yaml";
import fs       from "fs/promises";
import path     from "node:path";

import cfg                          from "./config.js";
import { ensureRepo, listAppFiles } from "./git.js";
import { deltaYaml }                from "./diff.js";
import {
  triggerWebhook,
  triggerDeleteWebhook,
  triggerUpgradeWebhook,
  triggerDownloadWebhook,
} from "./argo.js";

/* ───────── constants ─────────────────────────────────────────── */
export const CHARTS_ROOT   = process.env.CHARTS_ROOT   || "charts";
export const VALUES_SUBDIR = process.env.VALUES_SUBDIR || "values";
const ARTHUB_BASE          = "https://artifacthub.io/api/v1";

/* ───────── express bootstrap ────────────────────────────────── */
const app = express();

app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc : ["'self'"],
        scriptSrc  : ["'self'"],
        styleSrc   : ["'self'", "'unsafe-inline'"],
        imgSrc     : ["'self'", "data:", "https://artifacthub.io"],
        connectSrc : ["'self'", "https://artifacthub.io"],
        objectSrc  : ["'none'"],
      },
    },
  }),
);

app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));
app.get("/favicon.ico", (_q, r) => r.status(204).end());

/* ────────── clone repo once on boot ──────────────────────────── */
let gitRoot = "";
ensureRepo()
  .then(dir => {
    gitRoot = dir;
    console.log("[BOOT] Git repo cloned →", dir);
  })
  .catch(err => console.error("❌  Git clone failed:", err));

/* ════════════════════════════════════════════════════════════════
   6.  Webhook proxies  (install / delete / upgrade / download)

/* ════════════════════════════════════════════════════════════════
   1.  List app-of-apps YAML files (for the sidebar)
   ═══════════════════════════════════════════════════════════════ */
app.get("/api/files", async (_req, res) => {
  const files = await listAppFiles();
  const resolved = files.map(p => path.resolve(p));
  console.log("[DEBUG]  /api/files →", resolved);
  res.json(resolved);
});

/* ════════════════════════════════════════════════════════════════
   2.  Flatten `appProjects[].applications[]`
   ═══════════════════════════════════════════════════════════════ */
app.get("/api/apps", async (req, res) => {
  const targets = req.query.file ? [req.query.file] : await listAppFiles();
  const flat    = [];

  for (const f of targets) {
    const doc = yaml.load(await fs.readFile(f, "utf8")) ?? {};
    (doc.appProjects || []).forEach(p =>
      (p.applications || []).forEach(a =>
        flat.push({ project: p.name, file: f, app: a }),
      ),
    );
  }
  res.json(flat);
});

/* ════════════════════════════════════════════════════════════════
   3.  Read chart defaults + override values from the repo
   ═══════════════════════════════════════════════════════════════ */
app.get("/api/app/values", async (req, res) => {
  const { name, file: yamlFile, path: chartPath } = req.query;

  if (!name || !yamlFile || !chartPath)
    return res.status(400).json({ error: "name, file & path required" });

  const overrideFile = path.join(
    path.dirname(yamlFile),
    VALUES_SUBDIR,
    `${name}.yaml`,
  );
  const chartDir   = path.join(gitRoot, CHARTS_ROOT, chartPath);
  const safeRead   = p => fs.readFile(p, "utf8").catch(() => "");

  const defaultVals  = await safeRead(path.join(chartDir, "values.yaml"));
  const overrideVals = await safeRead(overrideFile);

  /* mini-meta from Chart.yaml – optional */
  let meta = {};
  try {
    const c = yaml.load(await safeRead(path.join(chartDir, "Chart.yaml"))) || {};
    meta = {
      description : c.description || "",
      home        : c.home        || "",
      maintainers : (c.maintainers || []).map(m => m.name).filter(Boolean),
    };
  } catch {/* ignore */}

  console.log(
    `[vals-file] ${name}\n` +
    `           override: ${overrideVals ? "✔︎" : "✖︎"} → ${overrideFile}\n` +
    `           default : ${defaultVals ? "✔︎" : "✖︎"} → ${chartDir}/values.yaml`,
  );

  res.json({
    defaultValues  : defaultVals,
    overrideValues : overrideVals,
    meta,
  });
});

/* ════════════════════════════════════════════════════════════════
   4.  Artifact Hub helpers (versions & default values)
   ═══════════════════════════════════════════════════════════════ */
/* 4-a  list chart versions **with release dates**  + debug log   */
app.get("/api/chart/versions", async (req, res) => {
  const { owner: repo, chart, limit = 40 } = req.query;
  if (!repo || !chart)
    return res.status(400).json({ error: "owner & chart required" });

  console.log(`[vers] repo=${repo} chart=${chart} limit=${limit}`);

  try {
    const { data } = await axios.get(
      `${ARTHUB_BASE}/packages/helm/${encodeURIComponent(repo)}/${encodeURIComponent(chart)}`,
      { timeout: 10_000 },
    );

    const versions = (data.available_versions || [])
      .slice(0, +limit)
      .map(v => ({
        version: v.version,
        date   : v.created_at || null,
      }));

    /* ─── DEBUG: print count + first item ───────────────────── */
    console.log(
      `[vers] got ${versions.length} versions` +
      (versions.length ? ` – first: ${JSON.stringify(versions[0])}` : ""),
    );

    res.json(versions);
  } catch (e) {
    console.warn("[ArtHub] versions error:", e.message);
    res.json([]);
  }
});

/* 4-b  fetch raw values.yaml for a given pkgId+version */
app.get("/api/chart/values", async (req, res) => {
  const { pkgId, version } = req.query;
  if (!pkgId || !version)
    return res.status(400).json({ error: "pkgId & version required" });

  console.log(`[vals-api] pkgId=${pkgId} ver=${version}`);

  try {
    const { data } = await axios.get(
      `${ARTHUB_BASE}/packages/${pkgId}/${version}/values`,
      { timeout: 10_000, responseType: "text" },
    );
    res.type("text/yaml").send(data);
  } catch (e) {
    console.warn("[ArtHub] values error:", e.message);
    res.type("text/yaml").send("# (no default values found)");
  }
});

/* ════════════════════════════════════════════════════════════════
   5.  YAML-Δ preview (override-only)
   ═══════════════════════════════════════════════════════════════ */
app.post("/api/delta", (req, res) => {
  const { defaultYaml = "", userYaml = "" } = req.body || {};
  const delta = deltaYaml(defaultYaml, userYaml);
  res.type("text/yaml").send(delta);
});

/* ════════════════════════════════════════════════════════════════
   6.  Webhook proxies  (install / delete / upgrade)
   ═══════════════════════════════════════════════════════════════ */
/* 6-a  install – original endpoint, kept for compatibility         */
app.post("/api/apps", async (req, res) => {
  console.log("[apps] Deploy request body:", JSON.stringify(req.body, null, 2));
  try {
    await triggerWebhook(req.body);               // helm install
    res.json({ ok: true });
  } catch (e) {
    console.error("[apps] webhook error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/* 6-b  alias: /api/sync  → does the same as /api/apps              */
app.post("/api/sync", async (req, res) => {
  try { await triggerWebhook(req.body); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* 6-c  delete release                                              */
app.post("/api/delete", async (req, res) => {
  try { await triggerDeleteWebhook(req.body); res.json({ ok: true }); }
  catch (e) {
    console.error("[delete] webhook error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/* 6-d  upgrade (edit existing app)                                 */
app.post("/api/upgrade", async (req, res) => {
  console.log("[upgrade] Upgrade request body:",
              JSON.stringify(req.body, null, 2));

  try {
    await triggerUpgradeWebhook(req.body);        // helm upgrade
    res.json({ ok: true });
  } catch (e) {
    console.error("[upgrade] webhook error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/* 6-e  download chart (pull only – no Application created)         */
app.post("/api/download", async (req, res) => {
  console.log("[download] Download request body:",
              JSON.stringify(req.body, null, 2));

  try {
    await triggerDownloadWebhook(req.body);       // helm pull
    res.json({ ok: true });
  } catch (e) {
    console.error("[download] webhook error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ────────── go! ──────────────────────────────────────────────── */
app.listen(cfg.port, () => console.log(`✔︎ backend listening on ${cfg.port}`));
