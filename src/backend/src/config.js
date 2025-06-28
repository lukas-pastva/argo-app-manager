const repo = process.env.GIT_REPO_SSH;
if (!repo) { console.error("❌  GIT_REPO_SSH required"); process.exit(1); }

export default {
  gitRepo:   repo,
  gitBranch: process.env.GIT_BRANCH || "main",
  gitKey:    process.env.GIT_SSH_KEY || process.env.GIT_SSH_KEY_B64,

  /* override with APPS_GLOB – e.g. "my-cluster*.yaml" */
  appsGlob:  process.env.APPS_GLOB || "app-of-apps*.y?(a)ml",

  webhookUrl:        process.env.WF_WEBHOOK_URL,                         // install
  deleteWebhookUrl:  process.env.WF_DELETE_WEBHOOK_URL  ||
                     (process.env.WF_WEBHOOK_URL ? process.env.WF_WEBHOOK_URL + "/action-delete"   : ""),
  upgradeWebhookUrl: process.env.WF_UPGRADE_WEBHOOK_URL ||
                     (process.env.WF_WEBHOOK_URL ? process.env.WF_WEBHOOK_URL + "/action-upgrade"  : ""),
  downloadWebhookUrl: process.env.WF_DOWNLOAD_WEBHOOK_URL ||             // ⬅ NEW
                      (process.env.WF_WEBHOOK_URL ? process.env.WF_WEBHOOK_URL + "/action-download" : ""),

  webhookTok: process.env.WF_TOKEN || "",

  chartCacheDir: "/tmp/chart-cache",
  port: Number(process.env.PORT) || 8080
};
