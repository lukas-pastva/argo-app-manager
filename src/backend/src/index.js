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

app.get("/api/files", async (_req, res) => {
  const full = await listAppFiles();
  res.json(full.map(p => path.resolve(p)));
});

app.get("/api/apps", async (req, res) => {
  const target = req.query.file
    ? [ path.resolve(req.query.file) ]
    : await listAppFiles();

  const flat = [];
  for (const f of target) {
    const txt = await fs.readFile(f, "utf8");
    const y = yaml.load(txt) || {};
    (y.appProjects || []).forEach(proj =>
      (proj.applications || []).forEach(app =>
        flat.push({ project: proj.name, file: f, app })));
  }
  res.json(flat);
});

app.get("/api/search", async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "q required" });
  const { data } = await axios.get(
    "https://artifacthub.io/api/v1/packages/search",
    { params: { kind: 0, limit: 20, ts_query_web: q } }
  );
  res.json(data.packages.map(p => ({
    name: p.name,
    repo: p.repo.url,
    version: p.version,
    displayName: p.displayName,
    logo: p.logoImageId
      ? `https://artifacthub.io/image/${p.logoImageId}`
      : null
  })));
});

app.post("/api/apps", async (req, res) => {
  const { chart, repo, version, release, namespace, userValuesYaml } = req.body;
  if (!chart || !repo || !release || !namespace)
    return res.status(400).json({ error: "missing fields" });

  const helm = spawnSync("helm", [
    "show", "values",
    `${repo.endsWith("/") ? repo : repo + "/"}${chart}`,
    "--version", version
  ]);
  if (helm.status !== 0)
    return res.status(500).send(helm.stderr.toString());

  const delta = deltaYaml(helm.stdout.toString(), userValuesYaml);
  await triggerWebhook({ chart, repo, version, release, namespace,
                         values_yaml: delta });
  res.json({ ok: true });
});

app.post("/api/apps/delete", async (req, res) => {
  const { release, namespace } = req.body || {};
  if (!release || !namespace)
    return res.status(400).json({ error: "release & namespace required" });

  await triggerDeleteWebhook({ release, namespace });
  res.json({ ok: true });
});

app.listen(cfg.port, () =>
  console.log(`✔︎ argo-helm-toggler backend listening on ${cfg.port}`)
);
