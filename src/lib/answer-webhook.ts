import "server-only";
import { createHmac } from "node:crypto";
import { getConfig } from "./config";
import { isWebUrl, type Decision } from "./domain";
import { getSettings } from "./appwrite/settings";

const EVENT = "decision.answered";
const TIMEOUT_MS = 3_000;

export function signAnswerWebhook(body: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export function answerWebhookPayload(decision: Decision) {
  return JSON.stringify({
    event: EVENT,
    decision: {
      id: decision.id,
      question: decision.question,
      area: decision.area,
      waiting_on: decision.waitingOn,
      answer: decision.answer,
      custom_answer: decision.customAnswer,
      answered_at: decision.answeredAt,
    },
  });
}

async function webhookConfig() {
  let url = process.env.DECISION_WEBHOOK_URL?.trim() || "";
  let secret = process.env.DECISION_WEBHOOK_SECRET?.trim() || "";
  if (!getConfig().mock) {
    const settings = await getSettings().catch(() => null);
    if (settings?.webhookUrl?.trim()) url = settings.webhookUrl.trim();
    if (settings?.webhookSecret?.trim()) secret = settings.webhookSecret.trim();
  }
  return { url, secret };
}

export async function notifyDecisionAnswered(decision: Decision): Promise<void> {
  try {
    const { url, secret } = await webhookConfig();
    if (!url) return;
    if (!secret || !isWebUrl(url)) {
      console.warn(
        "[Decisions] Answer webhook skipped: configure an HTTP(S) URL without credentials and a nonempty secret.",
      );
      return;
    }
    const body = answerWebhookPayload(decision);
    const headers = {
      "Content-Type": "application/json",
      "X-Decisions-Event": EVENT,
      "X-Decisions-Signature": signAnswerWebhook(body, secret),
      Authorization: `Bearer ${secret}`,
    };
    await deliverAnswerWebhook(url, body, headers, decision.id);
  } catch {
    // Configuration or delivery errors must not turn a saved answer into an API error.
    console.warn("[Decisions] Answer webhook could not be delivered.");
  }
}

async function deliverAnswerWebhook(
  url: string,
  body: string,
  headers: Record<string, string>,
  decisionId: string,
): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "error",
        cache: "no-store",
      });
      await response.body?.cancel();
      if (response.ok) return;
      console.warn("[Decisions] Answer webhook returned a non-success status.", {
        decisionId,
        attempt,
        status: response.status,
      });
    } catch {
      console.warn("[Decisions] Answer webhook request failed.", { decisionId, attempt });
    }
  }
}
