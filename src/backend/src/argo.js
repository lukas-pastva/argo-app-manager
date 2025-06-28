import axios from "axios";
import cfg   from "./config.js";

/* tiny helper that prints a curl-friendly line for every POST */
function post(url, body) {
  console.log(
    `[DEBUG] curl -X POST -H 'Content-Type: application/json' ` +
      (cfg.webhookTok ? "-H 'Authorization: Bearer ***' " : "") +
      `-d '${JSON.stringify(body)}' ${url}`
  );

  const headers = { "Content-Type": "application/json" };
  if (cfg.webhookTok) headers.Authorization = `Bearer ${cfg.webhookTok}`;
  return axios.post(url, body, { headers });
}

export const triggerWebhook         = (b) => post(cfg.webhookUrl,         b);  // install
export const triggerDeleteWebhook   = (b) => post(cfg.deleteWebhookUrl,   b);  // delete
export const triggerUpgradeWebhook  = (b) => post(cfg.upgradeWebhookUrl,  b);  // upgrade
export const triggerDownloadWebhook = (b) => post(cfg.downloadWebhookUrl, b);  // ⬅ NEW
