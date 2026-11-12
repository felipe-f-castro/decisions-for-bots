import "server-only";
import { createHmac } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { getConfig } from "./config";
import { readEnv } from "./env";
import type { Decision } from "./domain";
import { getSettings } from "./appwrite/settings";
import { resolvePublicWebhook, type ResolvedWebhook } from "./webhook-url";

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
  let settings;
  try {
    settings = await getSettings();
  } catch {
    // Do not fall back to environment webhooks when settings cannot be read.
    return { url: "", secret: "" };
  }
  const url = settings?.webhookUrl?.trim() || readEnv("DECISION_WEBHOOK_URL");
  const secret = settings?.webhookSecret?.trim() || readEnv("DECISION_WEBHOOK_SECRET");
  return { url, secret };
}

export async function notifyDecisionAnswered(decision: Decision): Promise<void> {
  try {
    // Demo mode has no outbound integrations. A signed webhook must not leave the process.
    if (getConfig().mock) return;
    const { url, secret } = await webhookConfig();
    if (!url) return;
    if (!secret) {
      console.warn(
        "[Decisions] Answer webhook skipped: configure a public HTTPS URL without credentials and a nonempty secret.",
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

function postWebhook(
  target: ResolvedWebhook,
  body: string,
  headers: Record<string, string>,
  signal: AbortSignal,
) {
  const host = target.url.hostname.replace(/^\[|\]$/g, "");
  return new Promise<number>((resolve, reject) => {
    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: target.address,
        family: target.family,
        port: target.url.port || 443,
        servername: host,
        method: "POST",
        path: `${target.url.pathname}${target.url.search}`,
        headers: {
          ...headers,
          Host: target.url.host,
          "Content-Length": Buffer.byteLength(body),
        },
        signal,
        rejectUnauthorized: true,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode || 0);
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

async function deliverAnswerWebhook(
  webhookUrl: string,
  body: string,
  headers: Record<string, string>,
  decisionId: string,
): Promise<void> {
  // Two attempts. Name lookup and the socket share one three-second deadline,
  // and redirects are not followed. The socket uses an address that passed the check.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    try {
      const target = await resolvePublicWebhook(webhookUrl, undefined, signal);
      const status = await postWebhook(target, body, headers, signal);
      if (status >= 200 && status < 300) return;
      console.warn("[Decisions] Answer webhook returned a non-success status.", {
        decisionId,
        attempt,
        status,
      });
    } catch {
      console.warn("[Decisions] Answer webhook request failed.", { decisionId, attempt });
    }
  }
}
