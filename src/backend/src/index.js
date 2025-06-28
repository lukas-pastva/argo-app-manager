/*  index.js  – Argo-Helm-Toggler backend
    ═══════════════════════════════════════════════════════════════
    * pure Git-based read-only clone (no K8s creds needed)
    * REST endpoints consumed by the tiny React UI
    * 2025-06-28  – @luke
*/
import express       from "express";
import helmet        from "helmet";
import axios         from "axios";
import yaml          from "js-yaml";
import fs            from "fs/promises";
import path          from "node:path";
import { spawnSync } from "node:child_process";

import cfg                       from "./config.js";
import { ensureRepo, listAppFiles } from "./git.js";
import { deltaYaml }             from "./diff.js";
import { triggerWebhook,
         triggerDeleteWebhook }   from "./argo.js";

/* ────────── constants ────────────────────────────────────────── */
export const CHARTS_ROOT   = process.env.CHARTS_ROOT   || "charts";   // inside repo
export const VALUES_SUBDIR = process.env.VALUES_SUBDIR || "values";

/* ────────── app setup ────────────────────────────────────────── */
const app = express();
app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

/* Sanity-clone once at boot so the first UI load is faster —— */
ensureRepo()
  .then(dir => console.log("[BOOT] Git repo cloned →", dir))
  .catch(e  => console.error("❌  Git clone failed:", e));

/* ═══════════════════════════════════════════════════════════════
   1.  List YAML files (app-of-apps*)
   ═════════════════════════════════════════════════════════════ */
app.get("/api/files", async (_req, res) => {
  const full = await listAppFiles();
  res.json(full.map(p=>path.resolve(p)));
});

/* ═══════════════════════════════════════════════════════════════
   2.  Flatten appProjects → apps[]
   ═════════════════════════════════════════════════════════════ */
app.get("/api/apps", async (req, res) => {
  const targets = req.query.file
    ? [path.resolve(req.query.file)]
    : await listAppFiles();

  const flat = [];
  for (const f of targets) {
    const txt = await fs.readFile(f,"utf8");
    const y   = yaml.load(txt) || {};
    (y.appProjects||[]).forEach(proj =>
      (proj.applications||[]).forEach(app =>
        flat.push({ project:proj.name, file:f, app })));
  }
  res.json(flat);
});

/* ═══════════════════════════════════════════════════════════════
   3.  ArtifactHub search (≥4 chars, 1-h cache, name-only list)
   ═════════════════════════════════════════════════════════════ */
const searchCache = new Map(); const TTL = 60*60*1000;
app.get("/api/search", async (req,res)=>{
  const q=(req.query.q||"").trim();
  if (q.length<4) return res.status(400).json({error:"≥4 chars"});

  const cached=searchCache.get(q);
  if (cached && Date.now()-cached.t<TTL) return res.json(cached.d);

  const url=`https://artifacthub.io/api/v1/packages/search?kind=0&limit=20&ts_query_web=${encodeURIComponent(q)}`;
  console.log("[ArtHub] GET",url);
  try{
    const { data } = await axios.get(url,{timeout:10000});
    const out=(data.packages||[]).map(p=>({
      name        : p.name,
      repo        : p.repository?.url || "",
      version     : p.version,
      description : p.description,
      displayName : p.display_name || p.displayName,
      logo        : p.logo_image_id
        ? `https://artifacthub.io/image/${p.logo_image_id}`
        : null
    }));
    searchCache.set(q,{t:Date.now(),d:out});
    res.json(out);
  }catch(e){
    console.error("[ArtHub]",e.message);
    res.status(e.response?.status||502).json({error:"ArtifactHub error"});
  }
});

/* ═══════════════════════════════════════════════════════════════
   4.  Chart default & override values  (App-details modal)
       - repoURL is IGNORED – we only use the path:
   ═════════════════════════════════════════════════════════════ */
app.get("/api/app/values", async (req,res)=>{
  const { project,name,path:chartPath,file } = req.query;
  if(!project||!name) return res.status(400).json({error:"params missing"});

  /* ── resolve paths inside the local Git clone ─────────────── */
  const repoRoot = await ensureRepo();

  /* Application path is e.g. external/OWNER/CHART/VERSION */
  const seg = (chartPath||"").split("/").filter(Boolean);
  const version = seg.at(-1);
  const chart   = seg.at(-2);
  const owner   = seg.at(-3) || "unknown";

  /* values override (either .yaml or .yml) is next to the YAML file */
  const fileDir   = path.dirname(file);
  const valYAML   = path.join(fileDir, VALUES_SUBDIR, `${name}.yaml`);
  const valYML    = path.join(fileDir, VALUES_SUBDIR, `${name}.yml`);
  const chartFile = path.join(repoRoot, CHARTS_ROOT, owner, chart, version, "values.yaml");

  let overrideY="", defaultY="";
  try{ overrideY = await fs.readFile(valYAML,"utf8"); }
  catch{ try{ overrideY = await fs.readFile(valYML,"utf8"); }catch{} }
  try{ defaultY  = await fs.readFile(chartFile,"utf8"); }catch{}

  console.log(`[vals] ${project}/${name}`);
  console.log("       override:", overrideY? "✔︎" : "✖︎", "→", overrideY? (valYAML.includes(".yaml")?valYAML:valYML):"—");
  console.log("       default :", defaultY ? "✔︎" : "✖︎", "→", chartFile);

  res.json({ defaultValues: defaultY, overrideValues: overrideY });
});

/* ═══════════════════════════════════════════════════════════════
   5.  Versions available for a chart
       • first list local dirs
       • if none found, FALL BACK to ArtifactHub
   ═════════════════════════════════════════════════════════════ */
app.get("/api/chart/versions", async (req,res)=>{
  const { owner="unknown", chart } = req.query;
  if(!chart) return res.status(400).json({error:"chart required"});

  const repoRoot = await ensureRepo();
  const baseDir  = path.join(repoRoot, CHARTS_ROOT, owner, chart);

  let versions=[];
  try{
    const dirents = await fs.readdir(baseDir,{withFileTypes:true});
    versions = dirents.filter(d=>d.isDirectory()).map(d=>d.name);
    console.log(`[ver] Local dir ${baseDir} → ${versions.length} hits`);
  }catch{
    console.log(`[ver] Local dir ${baseDir} missing`);
  }

  /* if local clone has no versions → remote query (best-effort) */
  if (versions.length===0){
    try{
      const url=`https://artifacthub.io/api/v1/packages/helm/${owner}/${chart}/versions?limit=40`;
      console.log("[ArtHub] versions",url);
      const { data } = await axios.get(url,{timeout:8000});
      versions = (data||[]).map(v=>v.version);
    }catch(e){
      console.error("[ArtHub] versions error:",e.message);
    }
  }

  res.json(versions.sort().reverse());
});

/* ═══════════════════════════════════════════════════════════════
   6.  Get chart’s default values.yaml (from repo)
        – EXTERNAL CHARTS ONLY (no network)
   ═════════════════════════════════════════════════════════════ */
app.get("/api/chart/values", async (req,res)=>{
  const { owner="unknown", chart, ver } = req.query;
  if(!chart||!ver) return res.status(400).json({error:"missing fields"});

  try{
    const p = path.join(await ensureRepo(), CHARTS_ROOT, owner, chart, ver, "values.yaml");
    const txt = await fs.readFile(p,"utf8");
    res.type("text/plain").send(txt);
  }catch{
    res.type("text/plain").send("# (no default values.yaml)");
  }
});

/* ═══════════════════════════════════════════════════════════════
   7.  Create / update  (webhook → CI job)
   ═════════════════════════════════════════════════════════════ */
app.post("/api/apps", async (req,res)=>{
  const { chart, repo, version, release, namespace,
          userValuesYaml, project=namespace } = req.body;
  if(!chart||!repo||!release||!namespace)
    return res.status(400).json({error:"missing fields"});

  const helm = spawnSync("helm",[
    "show","values", `${repo.endsWith("/")?repo:repo+"/"}${chart}`,
    "--version",version
  ]);
  if(helm.status!==0){
    console.error("[helm show] failed",helm.stderr.toString());
    return res.status(500).send(helm.stderr.toString());
  }

  const delta=deltaYaml(helm.stdout.toString(),userValuesYaml);
  await triggerWebhook({ chart, repo, version, release,
                         namespace, project, values_yaml:delta });
  res.json({ok:true});
});

/* ═══════════════════════════════════════════════════════════════
   8.  Delete
   ═════════════════════════════════════════════════════════════ */
app.post("/api/apps/delete", async (req,res)=>{
  const { release, namespace } = req.body||{};
  if(!release||!namespace)
    return res.status(400).json({error:"release & namespace required"});
  await triggerDeleteWebhook({release,namespace});
  res.json({ok:true});
});

/* ─────────────────────────────────────────────────────────────── */
app.listen(cfg.port,()=>console.log(`✔︎ backend listening on ${cfg.port}`));
