import fg            from "fast-glob";
import { spawnSync } from "node:child_process";
import fs            from "fs/promises";
import os            from "node:os";
import path          from "node:path";
import cfg           from "./config.js";

const DIR    = path.join(os.tmpdir(), "gitops-readonly");
const branch = cfg.gitBranch;

export async function ensureRepo() {
  if (await exists(path.join(DIR, ".git"))) {
    spawnSync("git", ["-C", DIR, "fetch", "--quiet"]);
    spawnSync("git", ["-C", DIR, "reset", "--hard", `origin/${branch}`]);
    return DIR;
  }

  await fs.mkdir(DIR, { recursive: true });

  const keyPath = path.join(os.tmpdir(), "git_key");
  const pem = cfg.gitKey?.includes("BEGIN")
    ? cfg.gitKey
    : Buffer.from(cfg.gitKey || "", "base64").toString("utf8");
  await fs.writeFile(keyPath, pem.replace(/\\n/g, "\n"), { mode: 0o600 });

  process.env.GIT_SSH_COMMAND =
    `ssh -i ${keyPath} -o StrictHostKeyChecking=accept-new`;

  spawnSync("git", ["clone", "--depth", "1", "--branch", branch,
    cfg.gitRepo, DIR], { stdio: "inherit" });
    
  console.log("[DEBUG] Git repo cloned to", DIR);

  return DIR;
}

export async function listAppFiles() {
  const dir = await ensureRepo();
  console.log(`[DEBUG] Using APPS_GLOB="${cfg.appsGlob}" in ${dir}`);
  const files = await fg(cfg.appsGlob, { cwd: dir, absolute: true });
  console.log(`[DEBUG] listAppFiles() found ${files.length} files:`, files);
  return files;
}

async function exists(p) {
  try { await fs.stat(p); return true; } catch { return false; }
}
