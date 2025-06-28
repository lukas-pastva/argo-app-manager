/*  ────────────────────────────────────────────────────────────────
    Argo-Helm-Toggler  — backend entry point
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

/* clone once at start so first request is fast */
ensureRepo()
  .then((dir) => console.log('[BOOT] Git repo cloned →', dir))
  .catch((err) => console.error('❌  Git clone failed:', err));

/* ════════════════════════════════════════════════════════════════
   1.  List all app-of-apps YAMLs found in the repo
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/files', async (_req, res) => {
  const files = await listAppFiles();
  res.json(files.map((p) => path.resolve(p)));
});

/* ════════════════════════════════════════════════════════════════
   2.  Flatten appProjects → applications[]
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/apps', async (req, res) => {
  const targets = req.query.file
    ? [req.query.file] // single file supplied by UI
    : await listAppFiles(); // otherwise use them all

  const apps = [];
  for (const f of targets) {
    const raw = await fs.readFile(f, 'utf8');
    const doc = yaml.load(raw) ?? {};
    (doc.appProjects || []).forEach((p) =>
      (p.applications || []).forEach((a) => apps.push({ project: p.name, ...a })),
    );
  }
  res.json(apps);
});

/* ════════════════════════════════════════════════════════════════
   3.  Current chart values  (override  *and*  chart defaults)
       — override:  <values>/<name>.yaml  *or*  <values>/<name>.yml
       — defaults:  <charts>/…/values.yaml
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/values', async (req, res) => {
  const { chartPath } = req.query;
  if (!chartPath) {
    return res.status(400).json({ error: 'chartPath query param required' });
  }

  const name      = path.basename(chartPath);
  const chartDir  = path.join(ensureRoot(chartPath), CHARTS_ROOT, chartPath);
  const overrideBase = path.join(
    ensureRoot(chartPath),
    VALUES_SUBDIR,
    name,
  );

  /* ── try <name>.yaml first, then <name>.yml ─────────────────── */
  let overrideVals = '';
  let overridePath = '';
  for (const p of [`${overrideBase}.yaml`, `${overrideBase}.yml`]) {
    try {
      overrideVals = await fs.readFile(p, 'utf8');
      overridePath = p;
      break;
    } catch {
      /* keep looking */
    }
  }

  /* ── chart defaults (if any) ────────────────────────────────── */
  let defaultVals = '';
  try {
    defaultVals = await fs.readFile(path.join(chartDir, 'values.yaml'), 'utf8');
  } catch {
    /* ignore */
  }

  console.log(
    `[vals] ${name}\n` +
      `       override: ${overrideVals ? '✔︎' : '✖︎'} → ${overridePath || '(none)'}\n` +
      `       default : ${defaultVals ? '✔︎' : '✖︎'} → ${chartDir}/values.yaml`,
  );

  if (!overrideVals && !defaultVals) {
    return res.status(404).json({ error: 'no values found' });
  }

  res.json({
    overrideValues: overrideVals || '',
    defaultValues : defaultVals  || '',
  });
});

/* ════════════════════════════════════════════════════════════════
   4.  Chart versions (Artifact Hub)
       NOTE: ArtifactHub dropped the old /versions?limit=N endpoint.
             We fetch the package once and read .available_versions.
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/versions', async (req, res) => {
  const { repo, chart, limit = 40 } = req.query;
  if (!repo || !chart) {
    return res
      .status(400)
      .json({ error: 'repo and chart query params are required' });
  }

  const url = `${ARTHUB_BASE}/packages/helm/${encodeURIComponent(
    repo,
  )}/${encodeURIComponent(chart)}`;

  try {
    const { data } = await axios.get(url, { timeout: 10_000 });
    const versions =
      (data.available_versions || []).slice(0, +limit).map((v) => v.version) ||
      [];
    res.json(versions);
  } catch (err) {
    console.warn('[ArtHub] versions error:', err.message);
    res.json([]); // keep the UI responsive even if Artifact Hub fails
  }
});

/* ════════════════════════════════════════════════════════════════
   5.  Apply / delete webhooks (Argo CD)
   ═══════════════════════════════════════════════════════════════ */
app.post('/api/sync', async (req, res) => {
  const { name, namespace } = req.body;
  try {
    await triggerWebhook(name, namespace);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/delete', async (req, res) => {
  const { name, namespace } = req.body;
  try {
    await triggerDeleteWebhook(name, namespace);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════ */

app.listen(cfg.port, () => console.log(`✔︎ backend listening on ${cfg.port}`));

/* ────────── helpers ───────────────────────────────────────────── */

function ensureRoot(p) {
  // Grab the first folder (external/, internal/, …) so that both styles work
  const segs = p.split(path.sep);
  return segs.length && ['external', 'internal'].includes(segs[0]) ? segs[0] : '.';
}
