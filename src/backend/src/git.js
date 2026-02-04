/*  git.js  –  GitLab REST API client
    ─────────────────────────────────────────────────────────────── */

import axios from "axios";
import https from "node:https";
import cfg   from "./config.js";

/* ─── API client ───────────────────────────────────────────── */
const api = axios.create({
  baseURL    : `${cfg.gitlabUrl}/api/v4`,
  headers    : { "PRIVATE-TOKEN": cfg.gitlabToken },
  timeout    : 30_000,
  httpsAgent : new https.Agent({ rejectUnauthorized: false }),
});

const projId = cfg.gitlabProject;   // numeric ID – no encoding needed

/* ─── core helpers ─────────────────────────────────────────── */

/**
 * Read a single file from the repo.  Returns "" if not found.
 */
export async function readFile(filePath) {
  try {
    const enc = encodeURIComponent(filePath);
    const { data } = await api.get(
      `/projects/${projId}/repository/files/${enc}/raw`,
      { params: { ref: cfg.gitBranch }, responseType: "text" },
    );
    return typeof data === "string" ? data : JSON.stringify(data);
  } catch (e) {
    if (e.response?.status === 404) return "";
    console.error(`[gitlab] readFile("${filePath}") error:`, e.message);
    return "";
  }
}

/**
 * List repository tree entries (paginated).
 */
async function listTree(treePath = "", recursive = false) {
  const items = [];
  let page = 1;
  while (true) {
    const { data } = await api.get(
      `/projects/${projId}/repository/tree`,
      {
        params: {
          ref      : cfg.gitBranch,
          path     : treePath || undefined,
          recursive,
          per_page : 100,
          page,
        },
      },
    );
    items.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return items;
}

/* ─── glob matcher ─────────────────────────────────────────── */

/**
 * Tiny glob-to-regex for the patterns this app uses.
 * Supports:  **  *  ?(x)  literal chars
 */
function globToRegex(glob) {
  let re = "";
  let i  = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i += 2;
      if (glob[i] === "/") i++;          // skip trailing / after **
    } else if (c === "*") {
      re += "[^/]*";
      i++;
    } else if (c === "?" && glob[i + 1] === "(") {
      const close = glob.indexOf(")", i + 2);
      const inner = glob.slice(i + 2, close);
      re += "(" + inner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")?";
      i = close + 1;
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return new RegExp("^" + re + "$");
}

/* ─── public API ───────────────────────────────────────────── */

/**
 * List app-of-apps YAML files matching APPS_GLOB.
 * Returns repo-relative paths.
 */
export async function listAppFiles() {
  const tree    = await listTree("", true);
  const pattern = globToRegex(cfg.appsGlob);
  const files   = tree
    .filter(item => item.type === "blob" && pattern.test(item.path))
    .map(item => item.path);

  console.log(`[gitlab] listAppFiles: found ${files.length} matching "${cfg.appsGlob}"`);
  return files;
}

/**
 * Scan  <helmChartsPath>/<publisher>/<chart>/<version>/
 * Returns [ { publisher, chart, versions: ["1.2.3", …] }, … ]
 */
export async function listInstalledCharts() {
  if (!cfg.helmChartsPath) return [];

  try {
    const tree = await listTree(cfg.helmChartsPath, true);
    const prefix = cfg.helmChartsPath + "/";

    // collect 3-level deep directories:  publisher / chart / version
    const map = new Map();                    // "pub/chart" → [versions]
    for (const item of tree) {
      if (item.type !== "tree") continue;
      const rel   = item.path.startsWith(prefix) ? item.path.slice(prefix.length) : item.path;
      const parts = rel.split("/");
      if (parts.length === 3) {
        const key = `${parts[0]}/${parts[1]}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(parts[2]);
      }
    }

    const result = [];
    for (const [key, versions] of map) {
      const [publisher, chart] = key.split("/");
      result.push({ publisher, chart, versions: versions.sort() });
    }

    console.log(`[gitlab] listInstalledCharts: found ${result.length} charts`);
    return result;
  } catch (e) {
    console.error("[gitlab] listInstalledCharts error:", e.message);
    return [];
  }
}
