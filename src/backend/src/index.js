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
  triggerWebhook,          // helm install
  triggerDeleteWebhook,    // helm uninstall
  triggerUpgradeWebhook,   // helm upgrade
  triggerDownloadWebhook   // helm pull-only
}                           from "./argo.js";

/* ───────── constants ─────────────────────────────────────────── */
export const CHARTS_ROOT   = process.env.CHARTS_ROOT   || "charts";
export const VALUES_SUBDIR = process.env.VALUES_SUBDIR || "values";
const ARTHUB_BASE          = "https://artifacthub.io/api/v1";

/* ───────── express bootstrap ────────────────────────────────── */
const app = express();

/* tiny console log for every request */
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

/* CSP tweaks: allow `data:` URLs (Monaco select chevron) */
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
app.get("/favicon.ico", (_q, r) => r.status(204).end());          // silence 404s

/* ────────── clone (or pull) repo once on boot ────────────────── */
let gitRoot = "";
ensureRepo()
  .then(dir => {
    gitRoot = dir;
    console.log("[BOOT] Git repo cloned →", dir);
  })
  .catch(err => console.error("❌  Git clone failed:", err));

/* ════════════════════════════════════════════════════════════════
   6.  Webhook proxies  (install / delete / upgrade / download)

   (other endpoints unchanged for brevity)
   ═══════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════
   1.  List app-of-apps YAML files (for the sidebar)
   ═══════════════════════════════════════════════════════════════ */
app.get("/api/files", async (_req, res) => {
  const files = await listAppFiles();
  res.json(files.map(p => path.resolve(p)));
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
        flat.push({ project: p.name, file: f, app: a })),
    );
  }
  res.json(flat);
});

/* ════════════════════════════════════════════════════════════════
   3.  Read chart defaults + override values from the repo
   (unchanged)
   ═══════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════
   4.  Artifact Hub helpers (versions & default values)
   ═══════════════════════════════════════════════════════════════ */

/* 4-a  list chart versions **with release dates** */
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
    /*  Each entry →  { version, date }  */
    res.json(
      (data.available_versions || [])
        .slice(0, +limit)
        .map(v => ({
          version: v.version,
          date   : v.created_at || null,
        })),
    );
  } catch (e) {
    console.warn("[ArtHub] versions error:", e.message);
    res.json([]);
  }
});

/* 4-b  fetch raw values.yaml
   (unchanged)
   ═══════════════════════════════════════════════════════════════ */

/* 5. YAML-Δ preview
   (unchanged)
   ═══════════════════════════════════════════════════════════════ */

/* 6. Webhook proxies
   (unchanged)
   ═══════════════════════════════════════════════════════════════ */

/* ────────── go! ──────────────────────────────────────────────── */
app.listen(cfg.port, () => console.log(`✔︎ backend listening on ${cfg.port}`));
