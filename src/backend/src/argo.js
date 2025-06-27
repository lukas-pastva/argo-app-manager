import axios from "axios";
import cfg   from "./config.js";

function post(url, body) {
  const headers = { "Content-Type": "application/json" };
  if (cfg.webhookTok) headers.Authorization = `Bearer ${cfg.webhookTok}`;
  return axios.post(url, body, { headers });
}

export const triggerWebhook       = body => post(cfg.webhookUrl,       body);
export const triggerDeleteWebhook = body => post(cfg.deleteWebhookUrl, body);
