/*  ────────────────────────────────────────────────────────────────
    Argo-Helm-Toggler – backend
    © 2025-06-28  |  MIT  |  @lukas
    ──────────────────────────────────────────────────────────────── */

import express       from 'express';
import helmet        from 'helmet';
import axios         from 'axios';
import yaml          from 'js-yaml';
import fs            from 'fs/promises';
import path          from 'node:path';

import cfg                          from './config.js';
import { ensureRepo, listAppFiles } from './git.js';

export const CHARTS_ROOT   = process.env.CHARTS_ROOT   || 'charts';
export const VALUES_SUBDIR = process.env.VALUES_SUBDIR || 'values';
const ARTHUB_BASE = 'https://artifacthub.io/api/v1';

/* ────────── express + boiler-plate ────────────────────────────── */
const app = express();
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc : ["'self'"],
        styleSrc  : ["'self'", "'unsafe-inline'"],
        imgSrc    : ["'self'", "https://artifacthub.io"],
        connectSrc: ["'self'", "https://artifacthub.io"],
        objectSrc : ["'none'"],
      },
    },
  }),
);
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));
app.get('/favicon.ico', (_req, res) => res.status(204).end());

ensureRepo()
  .then(dir => console.log('[BOOT] Git repo cloned →', dir))
  .catch(err => console.error('❌  Git clone failed:', err));

/* ────────── helper ────────────────────────────────────────────── */
function ensureRoot(p) {
  const seg = p.split(path.sep)[0];
  return ['external', 'internal'].includes(seg) ? seg : '.';
}

/* ════════════════════════════════════════════════════════════════
   YAML-file list + flattened apps (unchanged)
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/files', async (_req, res) => {
  const files = await listAppFiles();
  res.json(files.map(p => path.resolve(p)));
});

app.get('/api/apps', async (req, res) => {
  const targets = req.query.file ? [req.query.file] : await listAppFiles();
  const apps = [];
  for (const f of targets) {
    const doc = yaml.load(await fs.readFile(f, 'utf8')) ?? {};
    (doc.appProjects || []).forEach(p =>
      (p.applications || []).forEach(a =>
        apps.push({ project: p.name, file: f, app: a }),
      ),
    );
  }
  res.json(apps);
});

/* ════════════════════════════════════════════════════════════════
   NEW: values-fetcher that **solely** trusts “path”.
   (repoURL / chart / version are ignored from now on)
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/app/values', async (req, res) => {
  const { name, project, path: chartPath, file: yamlFile } = req.query;

  if (!name || !yamlFile || !chartPath) {
    return res
      .status(400)
      .json({ error: 'name, file and path query params are required' });
  }

  /* where overrides live (same folder tree as the YAML) */
  const aoaDir       = path.dirname(yamlFile);
  const overrideFile = path.join(aoaDir, VALUES_SUBDIR, `${name}.yaml`);

  /* chart root = external/…/chart/ver  (always) */
  const chartDir = path.join(ensureRoot(chartPath), CHARTS_ROOT, chartPath);

  /* read files – silently ignore missing ones */
  const readSafe = async p => fs.readFile(p, 'utf8').catch(() => '');

  const defaultVals  = await readSafe(path.join(chartDir, 'values.yaml'));
  const overrideVals = await readSafe(overrideFile);

  /* optional metadata from Chart.yaml */
  let meta = {};
  try {
    const c = yaml.load(await readSafe(path.join(chartDir, 'Chart.yaml'))) || {};
    meta = {
      description : c.description || '',
      home        : c.home        || '',
      maintainers : (c.maintainers || []).map(m => m.name || '').filter(Boolean),
    };
  } catch {/* ignore */ }

  console.log(
    `[vals] ${project}/${name}\n` +
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
   Chart version list (untouched)
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/versions', async (req, res) => {
  const { repo, chart, limit = 40 } = req.query;
  if (!repo || !chart) return res.status(400).json({ error: 'repo & chart required' });

  try {
    const { data } = await axios.get(
      `${ARTHUB_BASE}/packages/helm/${encodeURIComponent(repo)}/${encodeURIComponent(chart)}`,
      { timeout: 10_000 },
    );
    res.json(
      (data.available_versions || []).slice(0, +limit).map(v => v.version),
    );
  } catch (e) {
    console.warn('[ArtHub] versions error:', e.message); res.json([]);
  }
});

/* ════════════════════════════════════════════════════════════════
   webhook proxies (unchanged)
   ═══════════════════════════════════════════════════════════════ */
import { triggerWebhook, triggerDeleteWebhook } from './argo.js';

app.post('/api/sync',   async (r, s) => {
  try { await triggerWebhook(r.body.name,  r.body.namespace);   s.json({ ok:true }); }
  catch(e){ s.status(500).json({ error:e.message }); }
});
app.post('/api/delete', async (r, s) => {
  try { await triggerDeleteWebhook(r.body.name, r.body.namespace); s.json({ ok:true }); }
  catch(e){ s.status(500).json({ error:e.message }); }
});

/* ─────────────────────────────────────────────────────────────── */
app.listen(cfg.port, () => console.log(`✔︎ backend on ${cfg.port}`));
