/*  config.js  –  GitLab API configuration
    ─────────────────────────────────────────────────────────────── */

const required = (name) => {
  const v = process.env[name];
  if (!v) { console.error(`❌  ${name} required`); process.exit(1); }
  return v;
};

export default {
  /* ── GitLab API ──────────────────────────────────────────────── */
  gitlabUrl    : required("GITLAB_URL"),           // e.g. https://gitlab.example.com
  gitlabProject: required("GITLAB_PROJECT_ID"),     // numeric project ID
  gitlabToken  : process.env.GITLAB_TOKEN || "",
  gitBranch    : process.env.GIT_BRANCH || "main",

  /* ── Backend behaviour ─────────────────────────────────────── */
  appsGlob : process.env.APPS_GLOB || "app-of-apps*.y?(a)ml",

  /* all webhook URLs **must** be set explicitly */
  webhookUrl       : process.env.WF_WEBHOOK_URL,         // install
  deleteWebhookUrl : process.env.WF_DELETE_WEBHOOK_URL,  // delete
  upgradeWebhookUrl: process.env.WF_UPGRADE_WEBHOOK_URL, // upgrade
  downloadWebhookUrl: process.env.WF_DOWNLOAD_WEBHOOK_URL, // download

  webhookTok: process.env.WF_TOKEN || "",

  /* Installed charts (optional – shows existing charts on main page) */
  helmChartsPath  : process.env.HELM_CHARTS_PATH || "",  // e.g. "external/charts"

  /* UI customisation */
  appTitle      : process.env.APP_TITLE       || "",
  appDescription: process.env.APP_DESCRIPTION || "",
  downloadOnly  : (process.env.DOWNLOAD_ONLY || "").toLowerCase() === "true",

  /* misc */
  port: Number(process.env.PORT) || 8080
};
