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
import { deltaYaml }                from './diff.js';

/* ────────── constants ─────────────────────────────────────────── */
export const CHARTS_ROOT   = process.env.CHARTS_ROOT   || 'charts';
export const VALUES_SUBDIR = process.env.VALUES_SUBDIR || 'values';
const ARTHUB_BASE          = 'https://artifacthub.io/api/v1';

/* ────────── express bootstrap ────────────────────────────────── */
const app = express();

/* request logger */
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.originalUrl}`);
  next();
});

/* CSP (allow inline data URIs for SVG) */
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
app.get('/favicon.ico', (_, res) => res.status(204).end());

/* remember where the repo is cloned */
let gitRoot = '';
ensureRepo()
  .then(dir => {
    gitRoot = dir;
    console.log('[BOOT] Git repo cloned →', dir);
  })
  .catch(err => console.error('❌  Git clone failed:', err));

/* ════════════════════════════════════════════════════════════════
   1.  List app-of-apps YAML files
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/files', async (_req, res) => {
  const files = await listAppFiles();
  res.json(files.map(p => path.resolve(p)));
});

/* ════════════════════════════════════════════════════════════════
   2.  Flatten appProjects → applications[]
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
   3.  Chart values from cloned repo
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/app/values', async (req, res) => {
  const { name, file: yamlFile, path: chartPath } = req.query;
  if (!name || !yamlFile || !chartPath) {
    return res.status(400).json({ error: 'name, file and path required' });
  }

  const overrideFile = path.join(path.dirname(yamlFile), VALUES_SUBDIR, `${name}.yml`);
  const chartDir     = path.join(gitRoot, CHARTS_ROOT, chartPath);

  const readOpt = p => fs.readFile(p, 'utf8').catch(() => '');
  const defaultVals  = await readOpt(path.join(chartDir, 'values.yaml'));
  const overrideVals = await readOpt(overrideFile);

  let meta = {};
  try {
    const c = yaml.load(await readOpt(path.join(chartDir, 'Chart.yaml'))) || {};
    meta = {
      description : c.description || '',
      home        : c.home || '',
      maintainers : (c.maintainers || []).map(m => m.name).filter(Boolean),
    };
  } catch {/* ignore */}

  console.log(
    `[vals-file] ${name}\n` +
    `           override: ${overrideVals ? '✔︎' : '✖︎'} → ${overrideFile}\n` +
    `           default : ${defaultVals ? '✔︎' : '✖︎'} → ${chartDir}/values.yaml`,
  );

  res.json({ defaultValues: defaultVals, overrideValues: overrideVals, meta });
});

/* ════════════════════════════════════════════════════════════════
   4.  Version list proxy (owner ↔ repo alias)
   ═══════════════════════════════════════════════════════════════ */
async function serveVersions(req, res) {
  const repo  = req.query.owner || req.query.repo;
  const chart = req.query.chart;
  const limit = req.query.limit || 40;

  console.log(`[vers] repo=${repo} chart=${chart} limit=${limit}`);

  if (!repo || !chart) return res.status(400).json({ error: 'repo & chart required' });

  try {
    const { data } = await axios.get(
      `${ARTHUB_BASE}/packages/helm/${encodeURIComponent(repo)}/${encodeURIComponent(chart)}`,
      { timeout: 10_000 },
    );
    res.json((data.available_versions || []).slice(0, +limit).map(v => v.version));
  } catch (e) {
    console.warn('[ArtHub] versions error:', e.message);
    res.status(500).json({ error: e.message });
  }
}
app.get('/api/versions',       serveVersions);   // legacy
app.get('/api/chart/versions', serveVersions);   // new

/* ════════════════════════════════════════════════════════════════
   5.  Chart default values proxy  (CORS-free)
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/chart/values', async (req, res) => {
  const pkgId = req.query.pkgId;
  const ver   = req.query.version;
  if (!pkgId || !ver) return res.status(400).json({ error: 'pkgId & version required' });

  console.log(`[vals-api] pkgId=${pkgId} ver=${ver}`);

  async function fetchText(url) {
    const { data } = await axios.get(url, { timeout: 10_000, responseType: 'text' });
    return data;
  }

  try {                                     // dedicated /values endpoint
    const yml = await fetchText(`${ARTHUB_BASE}/packages/${pkgId}/${ver}/values`);
    return res.type('text/yaml').send(yml);
  } catch {/* fallback below */}

  try {                                     // fallback to /templates
    const { data } = await axios.get(
      `${ARTHUB_BASE}/packages/${pkgId}/${ver}/templates`,
      { timeout: 10_000 },
    );
    return res
      .type('text/yaml')
      .send(yaml.dump(data.values || {}, { lineWidth: 0 }));
  } catch (e) {
    console.error('[ArtHub] values/templates fetch failed:', e.message);
    res.status(500).json({ error: 'Unable to fetch chart values' });
  }
});

/* ════════════════════════════════════════════════════════════════
   6.  YAML delta helper  (override-only preview)
   ═══════════════════════════════════════════════════════════════ */
app.post('/api/delta', (req, res) => {
  const { defaultYaml = '', userYaml = '' } = req.body || {};
  const delta = deltaYaml(defaultYaml, userYaml);
  res.type('text/yaml').send(delta);
});

/* ════════════════════════════════════════════════════════════════
   7.  Deploy request → WF_WEBHOOK_URL  **WITH curl debug**
   ═══════════════════════════════════════════════════════════════ */
app.post('/api/apps', async (req, res) => {
  console.log('[apps] Deploy request body:', JSON.stringify(req.body, null, 2));

  if (!cfg.webhookUrl) {
    console.warn('[apps] WF_WEBHOOK_URL not set – skipping webhook');
    return res.status(500).json({ error: 'WF_WEBHOOK_URL not configured' });
  }

  try {
    await triggerWebhook(req.body);         // prints curl-like line internally
    res.json({ ok: true });
  } catch (e) {
    console.error('[apps] webhook error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   8.  Delete / sync webhooks (unchanged)
   ═══════════════════════════════════════════════════════════════ */
app.post('/api/sync',   async (r, s) => {
  try { await triggerWebhook(r.body);        s.json({ ok: true }); }
  catch (e) { s.status(500).json({ error: e.message }); }
});

app.post('/api/delete', async (r, s) => {
  try { await triggerDeleteWebhook(r.body);  s.json({ ok: true }); }
  catch (e) { s.status(500).json({ error: e.message }); }
});

/* ────────── start server ─────────────────────────────────────── */
app.listen(cfg.port, () => console.log(`✔︎ backend listening on ${cfg.port}`));
