/*  ────────────────────────────────────────────────────────────────
    Argo-Helm-Toggler  ─ backend entry point
    © 2025-06-28  |  MIT  |  @lukas
    ──────────────────────────────────────────────────────────────── */

import express       from 'express';
import helmet        from 'helmet';
import axios         from 'axios';
import yaml          from 'js-yaml';
import fs            from 'fs/promises';
import path          from 'node:path';
import { spawnSync } from 'node:child_process';

import cfg                          from './config.js';
import { ensureRepo, listAppFiles } from './git.js';
import { deltaYaml }                from './diff.js';
import {
  triggerWebhook,
  triggerDeleteWebhook,
}                                   from './argo.js';

/* ────────── constants ─────────────────────────────────────────── */

export const CHARTS_ROOT   = process.env.CHARTS_ROOT   || 'charts';
export const VALUES_SUBDIR = process.env.VALUES_SUBDIR || 'values';

const ARTHUB_BASE = 'https://artifacthub.io/api/v1';

/* ────────── Express app setup ────────────────────────────────── */
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

/* quick 204 for favicon requests so browsers stop complaining */
app.get('/favicon.ico', (_req,res)=>res.status(204).end());

/* clone once at start so first request is fast */
ensureRepo()
  .then(dir => console.log('[BOOT] Git repo cloned →', dir))
  .catch(err => console.error('❌  Git clone failed:', err));

/* ════════════════════════════════════════════════════════════════
   1.  List all app-of-apps YAMLs found in the repo
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/files', async (_req, res) => {
  const files = await listAppFiles();
  res.json(files.map(p => path.resolve(p)));
});

/* ════════════════════════════════════════════════════════════════
   2.  Flatten appProjects → applications[] (include `file` path)
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/apps', async (req, res) => {
  const targets = req.query.file ? [req.query.file] : await listAppFiles();
  const apps = [];
  for (const f of targets) {
    const raw = await fs.readFile(f, 'utf8');
    const doc = yaml.load(raw) ?? {};
    (doc.appProjects || []).forEach(p =>
      (p.applications || []).forEach(a => apps.push({ project: p.name, file: f, app: a }))
    );
  }
  res.json(apps);
});

/* ════════════════════════════════════════════════════════════════
   3.  Simplified values fetch (legacy)                           
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/values', async (req, res) => {
  const { chartPath, valueFile } = req.query;
  if (!chartPath) return res.status(400).json({ error: 'chartPath query param required' });

  const overrideFile = valueFile || path.join(ensureRoot(chartPath), VALUES_SUBDIR, `${path.basename(chartPath)}.yaml`);
  try {
    const raw = await fs.readFile(overrideFile, 'utf8');
    res.json({ values: yaml.load(raw) ?? {}, from: overrideFile });
  } catch {
    res.status(404).json({ error: 'values file not found', path: overrideFile });
  }
});

/* ════════════════════════════════════════════════════════════════
   3b.  Detailed values endpoint used by the React UI              
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/app/values', async (req, res) => {
  const { name, chart, version = '', repoURL = '', path: chartPath = '', file = '' } = req.query;
  if (!name || !chart) return res.status(400).json({ error: 'name and chart are required' });

  /* 1️⃣  override YAML (may be absent) */
  let overrideValues = '';
  if (file) {
    try {
      const valuesFile = path.join(path.dirname(file), VALUES_SUBDIR, `${name}.yaml`);
      overrideValues = await fs.readFile(valuesFile, 'utf8');
    } catch {/* ignore */}
  }

  /* 2️⃣  default values from Artifact Hub  */
  let defaultValues = '';
  const encodedRepo = encodeURIComponent(repoURL);
  const encodedChart = encodeURIComponent(chart);
  if (version) {
    try {
      const vURL = `${ARTHUB_BASE}/packages/helm/${encodedRepo}/${encodedChart}/${version}/values`;
      defaultValues = await axios.get(vURL, { timeout: 10000 }).then(r => r.data);
    } catch {/* ignore */}
    if (!defaultValues) {
      try {
        const tURL = `${ARTHUB_BASE}/packages/helm/${encodedRepo}/${encodedChart}/${version}/templates`;
        const tpl = await axios.get(tURL, { timeout: 10000 }).then(r => r.data);
        defaultValues = yaml.dump(tpl.values || {}, { lineWidth: 0 });
      } catch {/* ignore */}
    }
  }

  /* 3️⃣  metadata (description, home, maintainers) */
  let meta = {};
  try {
    const pURL = `${ARTHUB_BASE}/packages/helm/${encodedRepo}/${encodedChart}`;
    const pkg = await axios.get(pURL, { timeout: 10000 }).then(r => r.data);
    meta = {
      description : pkg.description,
      home        : pkg.home_url,
      maintainers : (pkg.maintainers || []).map(m => m.name),
    };
  } catch {/* ignore */}

  res.json({ defaultValues, overrideValues, meta });
});

/* ════════════════════════════════════════════════════════════════
   4.  Chart version list (proxy to AH)                            
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/versions', async (req, res) => {
  const { repo, chart, limit = 40 } = req.query;
  if (!repo || !chart) return res.status(400).json({ error: 'repo and chart required' });

  try {
    const url = `${ARTHUB_BASE}/packages/helm/${encodeURIComponent(repo)}/${encodeURIComponent(chart)}`;
    const { data } = await axios.get(url, { timeout: 10000 });
    const versions = (data.available_versions || []).slice(0, +limit).map(v => v.version);
    res.json(versions);
  } catch (err) {
    console.warn('[ArtifactHub] version lookup failed:', err.message);
    res.json([]);
  }
});

/* ════════════════════════════════════════════════════════════════
   5.  Trigger sync / delete webhooks                              
   ═══════════════════════════════════════════════════════════════ */
app.post('/api/sync', async (req, res) => {
  const { name, namespace } = req.body;
  try { await triggerWebhook(name, namespace); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/delete', async (req, res) => {
  const { name, namespace } = req.body;
  try { await triggerDeleteWebhook(name, namespace); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

/* ═══════════════════════════════════════════════════════════════ */
app.listen(cfg.port, () => console.log(`✔︎ backend listening on ${cfg.port}`));

/* ───────── helpers ────────────────────────────────────────────── */
function ensureRoot(p) {
  const segs = p.split(path.sep);
  return segs.length && ['external', 'internal'].includes(segs[0]) ? segs[0] : '.';
}