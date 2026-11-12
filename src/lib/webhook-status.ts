import { createHash } from "node:crypto";
import { isWebUrl } from "./domain";

export type WebhookSource = "settings" | "server";
export type WebhookKind = "delivery" | "test";

/** Safe to render. Never includes the webhook secret or the webhook URL. */
export type PublicWebhookHealth =
  | { state: "unconfigured" }
  | { state: "unknown"; source: WebhookSource; detail: string }
  | { state: "ok"; source: WebhookSource; at: string; kind: WebhookKind }
  | {
      state: "failed";
      source: WebhookSource;
      at: string;
      kind: WebhookKind;
      error: string;
    };

export type WebhookSettingsSnapshot = {
  webhookUrl: string;
  webhookSecret: string;
  webhookLastOutcome: string;
  webhookLastAt: string | null;
  webhookLastError: string;
  webhookLastKind: string;
  webhookLastUrlHash: string;
};

const GENERIC_FAILURE = "The last delivery failed.";

export function webhookUrlHash(url: string) {
  return createHash("sha256").update(url).digest("hex");
}

export function safeWebhookError(
  reason: "secret" | "url" | "http" | "timeout" | "network",
  status?: number,
) {
  switch (reason) {
    case "secret":
      return "A webhook secret is required.";
    case "url":
      return "Use an HTTP or HTTPS URL without credentials.";
    case "timeout":
      return "The receiver did not respond in time.";
    case "network":
      return "The receiver could not be reached.";
    case "http": {
      const code = status && status >= 400 && status <= 599 ? String(status) : "error";
      return `The receiver returned HTTP ${code}.`;
    }
  }
}

export function effectiveWebhookTarget(
  settings: { webhookUrl: string; webhookSecret: string } | null,
  env: { url?: string; secret?: string } = {},
) {
  let url = (env.url || "").trim();
  let secret = (env.secret || "").trim();
  const settingsUrl = settings?.webhookUrl?.trim() || "";
  const settingsSecret = settings?.webhookSecret?.trim() || "";
  if (settingsUrl) url = settingsUrl;
  if (settingsSecret) secret = settingsSecret;
  const source: WebhookSource = settingsUrl ? "settings" : "server";
  return { url, secret, source };
}

/** Only fixed sentences are stored. Anything else is replaced so a secret cannot land in the row. */
export function persistableWebhookError(error: string) {
  const cleaned = error
    .replace(/[\r\n]/g, " ")
    .trim()
    .slice(0, 240);
  if (!cleaned) return "";
  if (
    cleaned === safeWebhookError("secret") ||
    cleaned === safeWebhookError("url") ||
    cleaned === safeWebhookError("timeout") ||
    cleaned === safeWebhookError("network") ||
    /^The receiver returned HTTP [45]\d\d\.$/.test(cleaned)
  )
    return cleaned;
  return "The last delivery failed.";
}

/** Drop stored errors that might have picked up a URL, secret, or response body. */
export function sanitizeWebhookError(error: string, secret = "", url = "") {
  const cleaned = error
    .replace(/[\r\n]/g, " ")
    .trim()
    .slice(0, 240);
  if (!cleaned) return GENERIC_FAILURE;
  const lowered = cleaned.toLowerCase();
  if (lowered.includes("bearer ") || /https?:\/\//i.test(cleaned)) return GENERIC_FAILURE;
  if (secret && cleaned.includes(secret)) return GENERIC_FAILURE;
  if (url && url.length > 8 && cleaned.includes(url)) return GENERIC_FAILURE;
  return cleaned;
}

export function publicWebhookHealth(
  settings: WebhookSettingsSnapshot | null,
  env: { url?: string; secret?: string } = {},
): PublicWebhookHealth {
  const target = effectiveWebhookTarget(settings, env);
  if (!target.url) return { state: "unconfigured" };
  if (!isWebUrl(target.url)) {
    return {
      state: "unknown",
      source: target.source,
      detail: "The webhook URL must be HTTP or HTTPS and must not include credentials.",
    };
  }
  if (!target.secret) {
    return {
      state: "unknown",
      source: target.source,
      detail: "A webhook URL is saved, but no secret is set, so delivery cannot succeed.",
    };
  }
  const outcome = settings?.webhookLastOutcome;
  const at = settings?.webhookLastAt || "";
  const kind =
    settings?.webhookLastKind === "test" || settings?.webhookLastKind === "delivery"
      ? settings.webhookLastKind
      : "";
  const sameTarget =
    !!settings &&
    settings.webhookLastUrlHash === webhookUrlHash(target.url) &&
    !!at &&
    (outcome === "succeeded" || outcome === "failed") &&
    !!kind;
  if (!sameTarget) {
    return {
      state: "unknown",
      source: target.source,
      detail:
        "A webhook URL is saved, but Decisions has not confirmed a delivery yet. A saved URL is not a working notification.",
    };
  }
  if (outcome === "succeeded") return { state: "ok", source: target.source, at, kind };
  return {
    state: "failed",
    source: target.source,
    at,
    kind,
    error: sanitizeWebhookError(settings?.webhookLastError || "", target.secret, target.url),
  };
}
