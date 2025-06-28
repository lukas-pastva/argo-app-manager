/*  ────────────────────────────────────────────────────────────────
    Argo-Helm-Toggler – backend
    © 2025  |  MIT  |  @lukas
    ──────────────────────────────────────────────────────────────── */

import express       from 'express';
import helmet        from 'helmet';
import axios         from 'axios';
import yaml          from 'js-yaml';
import fs            from 'fs/promises';
import path          from 'node:path';

import cfg                          from './config.js';
import { ensureRepo, listAppFiles } from './git.js';
import { triggerWebhook,
         triggerDeleteWebhook }     from './argo.js';

/* ────────── constants ─────────────────────────────────────────── */
export const CHARTS_ROOT   = process.env.CHARTS_ROOT   || 'charts';
export const VALUES_SUBDIR = process.env.VALUES_SUBDIR || 'values';
const ARTHUB_BASE          = 'https://artifacthub.io/api/v1';

/* ────────── express bootstrap ────────────────────────────────── */
const app = express();

/* ❶ – request logger (good for live debugging) */
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.originalUrl}`);
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc : ["'self'"],
        scriptSrc  : ["'self'"],
        styleSrc   : ["'self'", "'unsafe-inline'"],
        imgSrc     : ["'self'", 'https://artifacthub.io'],
        connectSrc : ["'self'", 'https://artifacthub.io'],
        objectSrc  : ["'none'"],
      },
    },
  }),
);
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));
app.get('/favicon.ico', (_, res) => res.status(204).end());   // avoid 404 noise

/* ────────── remember where the repo is cloned ────────────────── */
let gitRoot = '';
ensureRepo()
  .then(dir => {
    gitRoot = dir;
    console.log('[BOOT] Git repo cloned →', dir);
  })
  .catch(err => console.error('❌  Git clone failed:', err));

/* ════════════════════════════════════════════════════════════════
   1.  List app-of-apps files
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/files', async (_req, res) => {
  const files = await listAppFiles();
  res.json(files.map(p => path.resolve(p)));
});

/* ════════════════════════════════════════════════════════════════
   2.  Flatten “appProjects → applications[]”
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/apps', async (req, res) => {
  const targets = req.query.file ? [req.query.file] : await listAppFiles();
  const flat = [];

  for (const f of targets) {
    const doc = yaml.load(await fs.readFile(f, 'utf8')) ?? {};
    (doc.appProjects || []).forEach(p =>
      (p.applications || []).forEach(a =>
        flat.push({ project: p.name, file: f, app: a }),
      ),
    );
  }
  res.json(flat);
});

/* ════════════════════════════════════════════════════════════════
   3.  Chart values  – **path-only** (unchanged since last fix)
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/app/values', async (req, res) => {
  const { name, file: yamlFile, path: chartPath } = req.query;

  if (!name || !yamlFile || !chartPath) {
    return res
      .status(400)
      .json({ error: 'name, file and path query params are required' });
  }

  /* absolute locations inside the cloned repo */
  const overrideFile = path.join(
    path.dirname(yamlFile),
    VALUES_SUBDIR,
    `${name}.yml`,          //  switched to .yml in previous patch
  );
  const chartDir = path.join(gitRoot, CHARTS_ROOT, chartPath);

  const safeRead = async p => fs.readFile(p, 'utf8').catch(() => '');

  const defaultVals  = await safeRead(path.join(chartDir, 'values.yaml'));
  const overrideVals = await safeRead(overrideFile);

  /* lightweight meta from Chart.yaml (optional) */
  let meta = {};
  try {
    const c = yaml.load(await safeRead(path.join(chartDir, 'Chart.yaml'))) || {};
    meta = {
      description : c.description || '',
      home        : c.home        || '',
      maintainers : (c.maintainers || []).map(m => m.name).filter(Boolean),
    };
  } catch {/* ignore */ }

  console.log(
    `[vals] ${name}\n` +
    `       override: ${overrideVals ? '✔︎' : '✖︎'} → ${overrideFile}\n` +
    `       default : ${defaultVals ? '✔︎' : '✖︎'} → ${chartDir}/values.yaml`,
  );

  res.json({
    defaultValues  : defaultVals,
    overrideValues : overrideVals,
    meta,
  });
});

/* ════════════════════════════════════════════════════════════════
   4.  Version list — shared handler
   ═══════════════════════════════════════════════════════════════ */
async function serveVersions(req, res) {
  /* UI sends owner=… while old API used repo=…              */
  const repo  = req.query.owner || req.query.repo;
  const chart = req.query.chart;
  const limit = req.query.limit || 40;

  console.log(`[vers] repo=${repo} chart=${chart} limit=${limit}`);

  if (!repo || !chart) {
    return res.status(400).json({ error: 'repo/owner & chart required' });
  }

  try {
    const { data } = await axios.get(
      `${ARTHUB_BASE}/packages/helm/${encodeURIComponent(repo)}/${encodeURIComponent(chart)}`,
      { timeout: 10_000 },
    );
    res.json(
      (data.available_versions || []).slice(0, +limit).map(v => v.version),
    );
  } catch (e) {
    console.warn('[ArtHub] versions error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

/* ❷ – original path (kept for backward compatibility) */
app.get('/api/versions', serveVersions);

/* ❸ – new alias path that the React UI is calling */
app.get('/api/chart/versions', serveVersions);

/* ════════════════════════════════════════════════════════════════
   5.  Proxy deploy / delete webhooks
   ═══════════════════════════════════════════════════════════════ */
app.post('/api/sync',   async (r, s) => {
  try { await triggerWebhook(r.body.name,  r.body.namespace);   s.json({ ok:true }); }
  catch (e) { s.status(500).json({ error: e.message }); }
});

app.post('/api/delete', async (r, s) => {
  try { await triggerDeleteWebhook(r.body.name, r.body.namespace); s.json({ ok:true }); }
  catch (e) { s.status(500).json({ error: e.message }); }
});

/* ────────── go! ───────────────────────────────────────────────── */
app.listen(cfg.port, () => console.log(`✔︎ backend listening on ${cfg.port}`));
