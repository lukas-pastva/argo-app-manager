import express       from "express";
import helmet        from "helmet";
import axios         from "axios";
import yaml          from "js-yaml";
import fs            from "fs/promises";
import { spawnSync } from "node:child_process";
import path          from "node:path";

import cfg                     from "./config.js";
import { listAppFiles }        from "./git.js";
import { deltaYaml }           from "./diff.js";
import { triggerWebhook,
         triggerDeleteWebhook } from "./argo.js";

const app = express();
app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

/* ────────────────────────────────────────────────────────── */
/* 1.  List YAML files                                        */
/* ────────────────────────────────────────────────────────── */
app.get("/api/files", async (_req, res) => {
  const full = await listAppFiles();
  res.json(full.map((p) => path.resolve(p)));
});

/* ────────────────────────────────────────────────────────── */
/* 2.  Flatten appProjects → applications[]                   */
/* ────────────────────────────────────────────────────────── */
app.get("/api/apps", async (req, res) => {
  const targets = req.query.file
    ? [path.resolve(req.query.file)]
    : await listAppFiles();

  const flat = [];
  for (const f of targets) {
    const txt = await fs.readFile(f, "utf8");
    const y   = yaml.load(txt) || {};
    (y.appProjects || []).forEach((proj) =>
      (proj.applications || []).forEach((app) =>
        flat.push({ project: proj.name, file: f, app }))
    );
  }
  res.json(flat);
});

/* ────────────────────────────────────────────────────────── */
/* 3.  ArtifactHub search (≥ 4 chars, safe mapping)           */
/* ────────────────────────────────────────────────────────── */
app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 4)
    return res.status(400).json({ error: "query must be ≥ 4 characters" });

  const url =
    "https://artifacthub.io/api/v1/packages/search?kind=0&limit=20" +
    `&ts_query_web=${encodeURIComponent(q)}`;

  /* ---- DEBUG curl ---- */
  console.log(`[DEBUG] curl -s "${url}"`);

  try {
    const { data } = await axios.get(url);
    const pkgs = data.packages || [];

    res.json(
      pkgs.map((p) => ({
        name       : p.name,
        repo       : p.repo?.url || p.repository?.url || "",   // ← guard
        version    : p.version,
        displayName: p.displayName,
        logo       : p.logoImageId
          ? `https://artifacthub.io/image/${p.logoImageId}`
          : null,
      }))
    );
  } catch (e) {
    console.error("[ArtifactHub]", e.message);
    res.status(e.response?.status || 500).json({ error: "ArtifactHub error" });
  }
});

/* ────────────────────────────────────────────────────────── */
/* 4.  Create / update app via webhook                        */
/* ────────────────────────────────────────────────────────── */
app.post("/api/apps", async (req, res) => {
  const {
    chart,
    repo,
    version,
    release,
    namespace,
    userValuesYaml,
    project = namespace,
  } = req.body;

  if (!chart || !repo || !release || !namespace)
    return res.status(400).json({ error: "missing fields" });

  const helm = spawnSync("helm", [
    "show",
    "values",
    `${repo.endsWith("/") ? repo : repo + "/"}${chart}`,
    "--version",
    version,
  ]);
  if (helm.status !== 0)
    return res.status(500).send(helm.stderr.toString());

  const delta = deltaYaml(helm.stdout.toString(), userValuesYaml);
  await triggerWebhook({
    chart,
    repo,
    version,
    release,
    namespace,
    project,
    values_yaml: delta,
  });
  res.json({ ok: true });
});

/* ────────────────────────────────────────────────────────── */
/* 5.  Delete                                                 */
/* ────────────────────────────────────────────────────────── */
app.post("/api/apps/delete", async (req, res) => {
  const { release, namespace } = req.body || {};
  if (!release || !namespace)
    return res
      .status(400)
      .json({ error: "release & namespace required" });

  await triggerDeleteWebhook({ release, namespace });
  res.json({ ok: true });
});

/* ────────────────────────────────────────────────────────── */
app.listen(cfg.port, () =>
  console.log(`✔︎ argo-helm-toggler backend listening on ${cfg.port}`)
);
