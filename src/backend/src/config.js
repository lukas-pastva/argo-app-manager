/*  config.js  –  zero-fallback version
    ─────────────────────────────────────────────────────────────── */

const repo = process.env.GIT_REPO_SSH;
if (!repo) {
  console.error("❌  GIT_REPO_SSH required");
  process.exit(1);
}

export default {
  /* ── Git repo / clone settings ─────────────────────────────── */
  gitRepo  : repo,
  gitBranch: process.env.GIT_BRANCH || "main",
  gitKey   : process.env.GIT_SSH_KEY || process.env.GIT_SSH_KEY_B64,

  /* ── Backend behaviour ─────────────────────────────────────── */
  appsGlob : process.env.APPS_GLOB || "app-of-apps*.y?(a)ml",

  /* all webhook URLs **must** be set explicitly */
  webhookUrl       : process.env.WF_WEBHOOK_URL,         // install
  deleteWebhookUrl : process.env.WF_DELETE_WEBHOOK_URL,  // delete
  upgradeWebhookUrl: process.env.WF_UPGRADE_WEBHOOK_URL, // upgrade
  downloadWebhookUrl: process.env.WF_DOWNLOAD_WEBHOOK_URL, // download

  webhookTok: process.env.WF_TOKEN || "",

  /* misc */
  chartCacheDir: "/tmp/chart-cache",
  port: Number(process.env.PORT) || 8080
};
