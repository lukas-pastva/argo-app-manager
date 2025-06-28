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
import { deltaYaml }                from './diff.js';   // ← NEW

/* ────────── constants ─────────────────────────────────────────── */
export const CHARTS_ROOT   = process.env.CHARTS_ROOT   || 'charts';
export const VALUES_SUBDIR = process.env.VALUES_SUBDIR || 'values';
const ARTHUB_BASE          = 'https://artifacthub.io/api/v1';

/* ────────── express bootstrap ────────────────────────────────── */
const app = express();

/* ── 1) request logger ─────────────────────────────────────────── */
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.originalUrl}`);
  next();
});

/* ── 2) CSP (now allows data: URIs for SVG) ────────────────────── */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc : ["'self'"],
        scriptSrc  : ["'self'"],
        styleSrc   : ["'self'", "'unsafe-inline'"],
        imgSrc     : ["'self'", 'https://artifacthub.io', 'data:'],
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
   3.  Chart values  (local path lookup)
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
    `${name}.yml`,
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
    `[vals-file] ${name}\n` +
    `           override: ${overrideVals ? '✔︎' : '✖︎'} → ${overrideFile}\n` +
    `           default : ${defaultVals ? '✔︎' : '✖︎'} → ${chartDir}/values.yaml`,
  );

  res.json({
    defaultValues  : defaultVals,
    overrideValues : overrideVals,
    meta,
  });
});

/* ════════════════════════════════════════════════════════════════
   4.  Version list  (owner / repo alias)
   ═══════════════════════════════════════════════════════════════ */
async function serveVersions(req, res) {
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

app.get('/api/versions',        serveVersions);   // legacy
app.get('/api/chart/versions',  serveVersions);   // new

/* ════════════════════════════════════════════════════════════════
   5.  **NEW**  Chart default values proxy  (CORS-free)
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/chart/values', async (req, res) => {
  const pkgId   = req.query.pkgId;
  const version = req.query.version;

  if (!pkgId || !version) {
    return res.status(400).json({ error: 'pkgId & version required' });
  }

  console.log(`[vals-api] pkgId=${pkgId} ver=${version}`);

  /* helper to fetch plain text (YAML) */
  async function fetchText(url) {
    const { data } = await axios.get(url, { timeout: 10_000, responseType: 'text' });
    return data;
  }

  /* ① try the dedicated /values endpoint … */
  try {
    const yml = await fetchText(
      `${ARTHUB_BASE}/packages/${encodeURIComponent(pkgId)}/${encodeURIComponent(version)}/values`,
    );
    return res.type('text/yaml').send(yml);
  } catch (e) {
    console.warn('[ArtHub] /values failed – will try /templates:', e.message);
  }

  /* ② …fallback to /templates and stringify                             */
  try {
    const tpl = await axios.get(
      `${ARTHUB_BASE}/packages/${encodeURIComponent(pkgId)}/${encodeURIComponent(version)}/templates`,
      { timeout: 10_000 },
    );
    const yml = yaml.dump(tpl.data.values || {}, { lineWidth: 0 });
    return res.type('text/yaml').send(yml);
  } catch (e) {
    console.error('[ArtHub] templates fallback failed:', e.message);
    return res.status(500).json({ error: 'Unable to fetch chart values' });
  }
});

/* ════════════════════════════════════════════════════════════════
   6.  Proxy deploy / delete webhooks
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
/* ════════════════════════════════════════════════════════════════
   7.  YAML delta API  (override-only YAML preview)
   ═══════════════════════════════════════════════════════════════ */
app.post('/api/delta', (req, res) => {
  const { defaultYaml = '', userYaml = '' } = req.body || {};
  const delta = deltaYaml(defaultYaml, userYaml);
  res.type('text/yaml').send(delta);
});