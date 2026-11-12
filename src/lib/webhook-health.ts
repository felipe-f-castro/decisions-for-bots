import "server-only";
import { getConfig } from "./config";
import { getSettings } from "./appwrite/settings";
import { publicWebhookHealth, type PublicWebhookHealth } from "./webhook-status";

export async function readPublicWebhookHealth(): Promise<PublicWebhookHealth | null> {
  if (getConfig().mock) return null;
  try {
    const settings = await getSettings();
    return publicWebhookHealth(settings, {
      url: process.env.DECISION_WEBHOOK_URL || "",
      secret: process.env.DECISION_WEBHOOK_SECRET || "",
    });
  } catch {
    return {
      state: "unknown",
      source: "settings",
      detail: "Webhook status could not be loaded.",
    };
  }
}
