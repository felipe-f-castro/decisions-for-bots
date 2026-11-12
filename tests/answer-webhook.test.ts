import { webcrypto } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/decisions/route";
import { PATCH } from "@/app/api/decisions/[id]/route";
import { notifyDecisionAnswered } from "@/lib/answer-webhook";
import { MockStore } from "@/lib/stores/mock";
import { appwriteEnv, demoEnv } from "./fixtures";

let store: MockStore;
const url = "https://receiver.example/answer?token=fixture-url-token";
const secret = "fixture-webhook-secret";
const fetchMock = vi.fn<typeof fetch>();

const { settings } = vi.hoisted(() => ({
  settings: { getSettings: vi.fn() },
}));

vi.mock("@/lib/store", () => ({ getStore: () => store }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  getAccess: vi.fn(async () => ({ kind: "demo" as const })),
}));
vi.mock("@/lib/appwrite/settings", () => ({
  getSettings: (...args: unknown[]) => settings.getSettings(...args),
  getDecisionAreas: async () => ["Design", "Content", "Other"],
}));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));

beforeEach(() => {
  appwriteEnv();
  vi.stubEnv("DECISION_WEBHOOK_URL", url);
  vi.stubEnv("DECISION_WEBHOOK_SECRET", secret);
  settings.getSettings.mockReset().mockResolvedValue({
    setupComplete: true,
    webhookUrl: "",
    webhookSecret: "",
  });
  vi.mocked(lookup).mockReset();
  vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
  store = new MockStore();
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  vi.mocked(httpsRequest).mockReset();
  vi.mocked(httpsRequest).mockImplementation(((
    options: { servername?: string; path?: string; signal?: AbortSignal; hostname?: string },
    callback: (response: PassThrough & { statusCode?: number }) => void,
  ) => {
    const req = new EventEmitter();
    return Object.assign(req, {
      end(body?: string) {
        Promise.resolve(
          fetchMock(`https://${options.servername}${options.path}`, {
            method: "POST",
            body,
            headers: (options as { headers?: HeadersInit }).headers,
            signal: options.signal,
          }),
        )
          .then((response) => {
            const stream = Object.assign(new PassThrough(), {
              statusCode: response.status,
              headers: {},
            });
            callback(stream);
            stream.end();
          })
          .catch((error: unknown) => req.emit("error", error));
      },
    });
  }) as never);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function request(method = "GET", body?: unknown) {
  return new NextRequest("http://localhost:3000/api/decisions", {
    method,
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function patch(id: string, body: unknown) {
  return PATCH(request("PATCH", body), { params: Promise.resolve({ id }) });
}

async function answer(custom = false) {
  const [decision] = await store.list();
  return patch(decision.id, {
    action: "answer",
    answer: custom ? "Lançar amanhã 🚀" : decision.options[0],
    custom,
    expectedRevision: decision.revision,
  });
}

describe("outbound answer webhook", () => {
  it.each([false, true])(
    "delivers the exact saved payload for custom=%s after the answer is saved",
    async (custom) => {
      const response = await answer(custom);
      expect(response.status).toBe(200);
      const { decision } = await response.json();
      expect(await store.get(decision.id)).toEqual(decision);
      expect(fetchMock).toHaveBeenCalledOnce();
      const [destination, init] = fetchMock.mock.calls[0];
      expect(destination).toBe(url);
      expect(init).toMatchObject({ method: "POST" });
      expect(vi.mocked(httpsRequest).mock.calls[0][0]).toMatchObject({
        hostname: "93.184.216.34",
        servername: "receiver.example",
        method: "POST",
      });
      expect(JSON.parse(init!.body as string)).toEqual({
        event: "decision.answered",
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
      const headers = new Headers(init!.headers);
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.get("X-Decisions-Event")).toBe("decision.answered");
      expect(headers.get("Authorization")).toBe(`Bearer ${secret}`);
      expect(console.warn).not.toHaveBeenCalled();
    },
  );

  it("signs the immutable raw UTF-8 body with HMAC-SHA256, independently verified with Web Crypto", async () => {
    const [decision] = await store.list();
    Object.assign(decision, {
      question: 'Café: "lançar" ou esperar?',
      answer: "Lançar amanhã 🚀",
      customAnswer: "Lançar amanhã 🚀",
      status: "Answered",
      answeredAt: "2026-11-10T18:00:00.000Z",
    });
    await notifyDecisionAnswered(decision);
    decision.answer = "A later edit";
    decision.customAnswer = "A later edit";
    vi.stubEnv("DECISION_WEBHOOK_SECRET", "a-later-secret");

    const init = fetchMock.mock.calls[0][1]!;
    const rawBody = init.body as string;
    expect(JSON.parse(rawBody).decision).toMatchObject({
      question: 'Café: "lançar" ou esperar?',
      answer: "Lançar amanhã 🚀",
      custom_answer: "Lançar amanhã 🚀",
      answered_at: "2026-11-10T18:00:00.000Z",
    });
    const key = await webcrypto.subtle.importKey(
      "raw",
      Buffer.from(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = await webcrypto.subtle.sign("HMAC", key, Buffer.from(rawBody));
    const headers = new Headers(init.headers);
    expect(headers.get("X-Decisions-Signature")).toBe(
      `sha256=${Buffer.from(digest).toString("hex")}`,
    );
    expect(headers.get("Authorization")).toBe(`Bearer ${secret}`);
  });

  it("does not follow redirects or contact a private location", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://127.0.0.1/latest" } }),
    );
    expect((await answer()).status).toBe(200);
    expect(httpsRequest).toHaveBeenCalledTimes(2);
    for (const [options] of vi.mocked(httpsRequest).mock.calls) {
      expect(options).toMatchObject({ hostname: "93.184.216.34", servername: "receiver.example" });
    }
  });

  it("does not deliver in demo mode", async () => {
    demoEnv();
    vi.stubEnv("DECISION_WEBHOOK_URL", url);
    vi.stubEnv("DECISION_WEBHOOK_SECRET", secret);
    expect((await answer()).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it("does not fall back to an environment webhook when settings cannot be read", async () => {
    settings.getSettings.mockRejectedValue(new Error("settings unavailable"));
    expect((await answer()).status).toBe(200);
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "   "])("is off when the URL is %j", async (value) => {
    vi.stubEnv("DECISION_WEBHOOK_URL", value);
    expect((await answer()).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "   "])("skips delivery safely when the secret is %j", async (value) => {
    vi.stubEnv("DECISION_WEBHOOK_SECRET", value);
    expect((await answer()).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it.each(["invalid-url", "file:///tmp/answers", "https://user:private@receiver.example"])(
    "does not break answering for an invalid webhook URL: %s",
    async (value) => {
      vi.stubEnv("DECISION_WEBHOOK_URL", value);
      expect((await answer()).status).toBe(200);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(value);
    },
  );

  it("retries a transport failure once with the identical signed request", async () => {
    fetchMock.mockRejectedValueOnce(new Error(`${url} ${secret} private transport details`));
    const response = await answer();
    const { decision } = await response.json();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = fetchMock.mock.calls[0][1]!;
    const retry = fetchMock.mock.calls[1][1]!;
    expect(retry.body).toBe(first.body);
    expect(retry.headers).toEqual(first.headers);
    expect(retry.signal).not.toBe(first.signal);
    expect(console.warn).toHaveBeenCalledOnce();
    expect(await store.get(decision.id)).toEqual(decision);
    const logs = JSON.stringify(vi.mocked(console.warn).mock.calls);
    for (const privateValue of [url, secret, "private transport details", decision.question])
      expect(logs).not.toContain(privateValue);
  });

  it.each([400, 503])(
    "logs HTTP %s and stops after one retry without rejecting",
    async (status) => {
      fetchMock.mockImplementation(async () => new Response(`${secret} private body`, { status }));
      const response = await answer();
      expect(response.status).toBe(200);
      const { decision } = await response.json();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(console.warn).toHaveBeenCalledTimes(2);
      expect(console.warn).toHaveBeenLastCalledWith(expect.any(String), {
        decisionId: decision.id,
        attempt: 2,
        status,
      });
      const logs = JSON.stringify(vi.mocked(console.warn).mock.calls);
      for (const privateValue of [url, secret, "private body"])
        expect(logs).not.toContain(privateValue);
      expect(await store.get(decision.id)).toEqual(decision);
    },
  );

  it("uses a fresh three-second abort signal for each attempt and tolerates both timeouts", async () => {
    const controllers: AbortController[] = [];
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      controllers.push(controller);
      return controller.signal;
    });
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), {
            once: true,
          });
        }),
    );
    const pending = answer();
    await vi.waitFor(() => expect(controllers).toHaveLength(1));
    controllers[0].abort(new DOMException("Fixture timeout", "TimeoutError"));
    await vi.waitFor(() => expect(controllers).toHaveLength(2));
    controllers[1].abort(new DOMException("Fixture timeout", "TimeoutError"));
    expect((await pending).status).toBe(200);
    expect(timeout.mock.calls).toEqual([[3_000], [3_000]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it("keeps the answer saved and readable when delivery throws", async () => {
    fetchMock.mockImplementation(() => {
      throw new Error(`${url} ${secret} private scheduling details`);
    });
    const response = await answer();
    expect(response.status).toBe(200);
    const { decision } = await response.json();
    expect(await store.get(decision.id)).toEqual(decision);
    const poll = await GET(request());
    expect((await poll.json()).decisions).toContainEqual(decision);
    expect(console.warn).toHaveBeenCalled();
    const logs = JSON.stringify(vi.mocked(console.warn).mock.calls);
    for (const privateValue of [url, secret, "private scheduling details"])
      expect(logs).not.toContain(privateValue);
  });

  it("notifies again for a successful answer edit with its new saved timestamp", async () => {
    const { decision: first } = await (await answer()).json();
    const response = await patch(first.id, {
      action: "answer",
      answer: "An edited answer",
      custom: true,
      expectedRevision: first.revision,
    });
    const { decision: edited } = await response.json();
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const events = fetchMock.mock.calls.map(([, init]) => JSON.parse(init!.body as string));
    expect(events[0].decision.answered_at).toBe(first.answeredAt);
    expect(events[1].decision).toMatchObject({
      answer: "An edited answer",
      custom_answer: "An edited answer",
      answered_at: edited.answeredAt,
    });
    expect(edited.answeredAt).not.toBe(first.answeredAt);
  });

  it("does not notify for reads, creation, reopen, or routing", async () => {
    expect((await GET(request())).status).toBe(200);
    expect((await POST(request("POST", { question: "New question", area: "Other" }))).status).toBe(
      201,
    );
    const [decision] = await store.list();
    const mutation = { action: "answer" as const, answer: decision.options[0], custom: false };
    const saved = await store.mutate(decision.id, {
      ...mutation,
      expectedRevision: decision.revision,
    });
    const reopened = await patch(decision.id, {
      action: "reopen",
      expectedRevision: saved.revision,
    });
    expect(reopened.status).toBe(200);
    const { decision: open } = await reopened.json();
    const savedAgain = await store.mutate(open.id, {
      ...mutation,
      expectedRevision: open.revision,
    });
    expect(
      (await patch(open.id, { action: "route", expectedRevision: savedAgain.revision })).status,
    ).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not notify when validation, a version check, or persistence fails", async () => {
    const [decision] = await store.list();
    const mutation = {
      action: "answer",
      answer: decision.options[0],
      custom: false,
      expectedRevision: decision.revision,
    };
    expect((await patch(decision.id, { ...mutation, answer: "Not an option" })).status).toBe(400);
    expect((await patch(decision.id, { ...mutation, expectedRevision: "stale" })).status).toBe(409);
    vi.spyOn(store, "mutate").mockRejectedValueOnce(new Error("Fixture persistence failure"));
    expect((await patch(decision.id, mutation)).status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await store.get(decision.id)).toEqual(decision);
  });
});
