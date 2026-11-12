import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyDecisionAnswered, probeAnswerWebhook } from "@/lib/answer-webhook";
import { recordWebhookAttempt } from "@/lib/appwrite/settings";
import { seedDecisions } from "@/lib/seed";
import { webhookSetupInstructions } from "@/lib/webhook-instructions";
import {
  publicWebhookHealth,
  safeWebhookError,
  webhookUrlHash,
  type WebhookSettingsSnapshot,
} from "@/lib/webhook-status";
import { appwriteEnv, demoEnv } from "./fixtures";

vi.mock("@/lib/appwrite/settings", () => ({
  getSettings: vi.fn(async () => null),
  recordWebhookAttempt: vi.fn(async () => {}),
}));

const url = "https://receiver.example/hooks/decisions?token=hidden-query";
const secret = "fixture-webhook-secret-value";
const fetchMock = vi.fn<typeof fetch>();

function snapshot(overrides: Partial<WebhookSettingsSnapshot> = {}): WebhookSettingsSnapshot {
  return {
    webhookUrl: url,
    webhookSecret: secret,
    webhookLastOutcome: "",
    webhookLastAt: null,
    webhookLastError: "",
    webhookLastKind: "",
    webhookLastUrlHash: "",
    ...overrides,
  };
}

function answered() {
  return {
    ...seedDecisions()[0],
    status: "Answered" as const,
    answer: "Rounded mark",
    customAnswer: "",
    answeredAt: "2026-11-12T12:00:00.000Z",
  };
}

beforeEach(() => {
  demoEnv();
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(recordWebhookAttempt).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("webhook health", () => {
  it("is unconfigured when no URL is saved", () => {
    expect(publicWebhookHealth(snapshot({ webhookUrl: "", webhookSecret: "" })).state).toBe(
      "unconfigured",
    );
    expect(publicWebhookHealth(null).state).toBe("unconfigured");
  });

  it("stays unverified when a URL is saved but never tested", () => {
    const health = publicWebhookHealth(snapshot());
    expect(health).toMatchObject({
      state: "unknown",
      source: "settings",
    });
    expect(JSON.stringify(health)).not.toContain(secret);
    expect(JSON.stringify(health)).not.toContain("hidden-query");
    expect(JSON.stringify(health)).not.toContain(url);
  });

  it("reports success only for a delivery that matches the current URL", () => {
    const health = publicWebhookHealth(
      snapshot({
        webhookLastOutcome: "succeeded",
        webhookLastAt: "2026-11-12T12:00:00.000Z",
        webhookLastKind: "test",
        webhookLastUrlHash: webhookUrlHash(url),
      }),
    );
    expect(health).toMatchObject({ state: "ok", kind: "test", at: "2026-11-12T12:00:00.000Z" });
    expect(JSON.stringify(health)).not.toContain(secret);
    const moved = publicWebhookHealth(
      snapshot({
        webhookUrl: "https://other.example/hook",
        webhookLastOutcome: "succeeded",
        webhookLastAt: "2026-11-12T12:00:00.000Z",
        webhookLastKind: "delivery",
        webhookLastUrlHash: webhookUrlHash(url),
      }),
    );
    expect(moved.state).toBe("unknown");
  });

  it("reports a failed delivery with a safe error and drops leaked secrets", () => {
    const safe = publicWebhookHealth(
      snapshot({
        webhookLastOutcome: "failed",
        webhookLastAt: "2026-11-12T12:04:00.000Z",
        webhookLastKind: "delivery",
        webhookLastError: safeWebhookError("http", 502),
        webhookLastUrlHash: webhookUrlHash(url),
      }),
    );
    expect(safe).toMatchObject({
      state: "failed",
      error: "The receiver returned HTTP 502.",
    });
    const leaked = publicWebhookHealth(
      snapshot({
        webhookLastOutcome: "failed",
        webhookLastAt: "2026-11-12T12:04:00.000Z",
        webhookLastKind: "delivery",
        webhookLastError: `failed ${secret} ${url}`,
        webhookLastUrlHash: webhookUrlHash(url),
      }),
    );
    expect(leaked).toMatchObject({ state: "failed", error: "The last delivery failed." });
    expect(JSON.stringify(leaked)).not.toContain(secret);
    expect(JSON.stringify(leaked)).not.toContain("hidden-query");
  });

  it("uses the server URL when settings have none, without echoing it", () => {
    const envUrl = "https://env.example/hooks/answers";
    const envSecret = "env-secret-value-123456";
    const health = publicWebhookHealth(snapshot({ webhookUrl: "", webhookSecret: "" }), {
      url: envUrl,
      secret: envSecret,
    });
    expect(health).toMatchObject({ state: "unknown", source: "server" });
    expect(JSON.stringify(health)).not.toContain(envSecret);
    expect(JSON.stringify(health)).not.toContain(envUrl);
    const checked = publicWebhookHealth(
      snapshot({
        webhookUrl: "",
        webhookSecret: "",
        webhookLastOutcome: "succeeded",
        webhookLastAt: "2026-11-12T12:00:00.000Z",
        webhookLastKind: "delivery",
        webhookLastUrlHash: webhookUrlHash(envUrl),
      }),
      { url: envUrl, secret: envSecret },
    );
    expect(checked).toMatchObject({ state: "ok", source: "server" });
  });
});

describe("webhook setup instructions", () => {
  it("tells a bot how to configure HMAC delivery without leaking secrets", () => {
    const text = webhookSetupInstructions();
    for (const phrase of [
      "X-Decisions-Signature",
      "DECISION_WEBHOOK_URL",
      "DECISION_WEBHOOK_SECRET",
      "webhookUrl",
      "webhookSecret",
      "webhook.test",
      "decision.answered",
      "Send test notification",
      "Working",
    ]) {
      expect(text).toContain(phrase);
    }
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(text).not.toContain(secret);
    expect(text).not.toContain("hidden-query");
    expect(text).not.toMatch(/Bearer [A-Za-z0-9_-]{12,}/);
    expect(text).not.toMatch(/https:\/\/[a-z0-9-]+\.appwrite\.network/i);
  });
});

describe("delivery bookkeeping", () => {
  it("does not record anything in demo mode", async () => {
    vi.stubEnv("DECISION_WEBHOOK_URL", url);
    vi.stubEnv("DECISION_WEBHOOK_SECRET", secret);
    await notifyDecisionAnswered(answered());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(recordWebhookAttempt).not.toHaveBeenCalled();
  });

  it("records a successful delivery without the secret or response body", async () => {
    appwriteEnv();
    vi.stubEnv("DECISION_WEBHOOK_URL", url);
    vi.stubEnv("DECISION_WEBHOOK_SECRET", secret);
    await notifyDecisionAnswered(answered());
    expect(recordWebhookAttempt).toHaveBeenCalledOnce();
    const attempt = vi.mocked(recordWebhookAttempt).mock.calls[0][0];
    expect(attempt).toMatchObject({ outcome: "succeeded", error: "", kind: "delivery", url });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(secret);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("hidden-query");
  });

  it("records a failed delivery with a safe HTTP error", async () => {
    appwriteEnv();
    vi.stubEnv("DECISION_WEBHOOK_URL", url);
    vi.stubEnv("DECISION_WEBHOOK_SECRET", secret);
    fetchMock.mockResolvedValue(new Response(`private ${secret} ${url}`, { status: 500 }));
    await notifyDecisionAnswered(answered());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const attempt = vi.mocked(recordWebhookAttempt).mock.calls[0][0];
    expect(attempt).toMatchObject({
      outcome: "failed",
      error: "The receiver returned HTTP 500.",
      kind: "delivery",
    });
    expect(attempt.error).not.toContain(secret);
    expect(attempt.error).not.toContain(url);
    const logs = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logs).not.toContain(secret);
    expect(logs).not.toContain("hidden-query");
    expect(logs).not.toContain("private ");
  });

  it("sends a labeled test and does not pretend a missing URL works", async () => {
    appwriteEnv();
    vi.stubEnv("DECISION_WEBHOOK_URL", url);
    vi.stubEnv("DECISION_WEBHOOK_SECRET", secret);
    const result = await probeAnswerWebhook();
    expect(result).toEqual({ ok: true, error: "" });
    const [destination, init] = fetchMock.mock.calls[0];
    expect(destination).toBe(url);
    expect(JSON.parse(init!.body as string)).toMatchObject({
      event: "webhook.test",
      test: true,
      decision: { id: "00000000-0000-4000-8000-000000000000" },
    });
    expect(new Headers(init!.headers).get("X-Decisions-Event")).toBe("webhook.test");
    expect(new Headers(init!.headers).get("X-Decisions-Signature")).toMatch(
      /^sha256=[0-9a-f]{64}$/,
    );
    expect(vi.mocked(recordWebhookAttempt).mock.calls[0][0].kind).toBe("test");

    fetchMock.mockClear();
    vi.stubEnv("DECISION_WEBHOOK_URL", "");
    vi.mocked(recordWebhookAttempt).mockClear();
    const missing = await probeAnswerWebhook();
    expect(missing.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(missing.error).not.toContain(secret);
  });
});
