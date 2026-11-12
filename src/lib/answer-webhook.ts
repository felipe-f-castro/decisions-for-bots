import "server-only";
import { createHmac } from "node:crypto";
import { getConfig } from "./config";
import { isWebUrl, type Decision } from "./domain";
import { getSettings, recordWebhookAttempt } from "./appwrite/settings";
import { effectiveWebhookTarget, safeWebhookError, type WebhookKind } from "./webhook-status";

const EVENT = "decision.answered";
const TEST_EVENT = "webhook.test";
const TIMEOUT_MS = 3_000;
const TEST_DECISION_ID = "00000000-0000-4000-8000-000000000000";

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

export function webhookTestBody(at = new Date().toISOString()) {
  return JSON.stringify({
    event: TEST_EVENT,
    test: true,
    decision: {
      id: TEST_DECISION_ID,
      question: "Webhook connectivity test",
      area: "Other",
      waiting_on: "",
      answer: "This is a test notification from Decisions. It is not a real decision.",
      custom_answer: "",
      answered_at: at,
    },
  });
}

async function webhookConfig() {
  const env = {
    url: process.env.DECISION_WEBHOOK_URL || "",
    secret: process.env.DECISION_WEBHOOK_SECRET || "",
  };
  if (getConfig().mock) {
    return { url: env.url.trim(), secret: env.secret.trim() };
  }
  const settings = await getSettings().catch(() => null);
  const target = effectiveWebhookTarget(
    settings ? { webhookUrl: settings.webhookUrl, webhookSecret: settings.webhookSecret } : null,
    env,
  );
  return { url: target.url, secret: target.secret };
}

type DeliveryReport = {
  outcome: "skipped" | "succeeded" | "failed";
  error: string;
  url: string;
};

async function remember(
  report: { outcome: "succeeded" | "failed"; error: string; url: string },
  kind: WebhookKind,
) {
  try {
    if (getConfig().mock || !report.url || !isWebUrl(report.url)) return;
    await recordWebhookAttempt({
      url: report.url,
      outcome: report.outcome,
      error: report.outcome === "succeeded" ? "" : report.error,
      kind,
      at: new Date().toISOString(),
    });
  } catch {
    // Status bookkeeping must not turn a saved answer into an API error.
  }
}

export async function notifyDecisionAnswered(decision: Decision): Promise<void> {
  const report: DeliveryReport = { outcome: "skipped", error: "", url: "" };
  try {
    const { url, secret } = await webhookConfig();
    report.url = url;
    if (!url) return;
    if (!secret || !isWebUrl(url)) {
      report.outcome = "failed";
      report.error = !isWebUrl(url) ? safeWebhookError("url") : safeWebhookError("secret");
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
    const result = await deliverAnswerWebhook(url, body, headers, decision.id);
    report.outcome = result.ok ? "succeeded" : "failed";
    report.error = result.error;
  } catch {
    if (report.url && report.outcome === "skipped") {
      report.outcome = "failed";
      report.error = safeWebhookError("network");
    }
    console.warn("[Decisions] Answer webhook could not be delivered.");
  } finally {
    if (report.outcome !== "skipped") {
      await remember({ outcome: report.outcome, error: report.error, url: report.url }, "delivery");
    }
  }
}

/** POST a labeled connectivity check. Does not create a decision. */
export async function probeAnswerWebhook(): Promise<{ ok: boolean; error: string }> {
  const { url, secret } = await webhookConfig();
  if (!url) return { ok: false, error: "Add a webhook URL before sending a test." };
  if (!isWebUrl(url)) return { ok: false, error: safeWebhookError("url") };
  if (!secret) {
    const error = safeWebhookError("secret");
    await remember({ outcome: "failed", error, url }, "test");
    return { ok: false, error };
  }
  const body = webhookTestBody();
  const headers = {
    "Content-Type": "application/json",
    "X-Decisions-Event": TEST_EVENT,
    "X-Decisions-Signature": signAnswerWebhook(body, secret),
    Authorization: `Bearer ${secret}`,
  };
  const result = await deliverAnswerWebhook(url, body, headers, "webhook-test");
  await remember({ outcome: result.ok ? "succeeded" : "failed", error: result.error, url }, "test");
  return { ok: result.ok, error: result.ok ? "" : result.error };
}

async function deliverAnswerWebhook(
  url: string,
  body: string,
  headers: Record<string, string>,
  decisionId: string,
): Promise<{ ok: true; error: "" } | { ok: false; error: string }> {
  let last: { ok: false; error: string } = { ok: false, error: safeWebhookError("network") };
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
      if (response.ok) return { ok: true, error: "" };
      last = { ok: false, error: safeWebhookError("http", response.status) };
      console.warn("[Decisions] Answer webhook returned a non-success status.", {
        decisionId,
        attempt,
        status: response.status,
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      const timedOut = name === "TimeoutError" || name === "AbortError";
      last = { ok: false, error: safeWebhookError(timedOut ? "timeout" : "network") };
      console.warn("[Decisions] Answer webhook request failed.", { decisionId, attempt });
    }
  }
  return last;
}
