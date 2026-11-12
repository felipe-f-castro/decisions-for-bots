import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/decisions/route";
import { GET as GET_ONE, PATCH } from "@/app/api/decisions/[id]/route";
import { getAccess } from "@/lib/auth";
import { demoEnv } from "./fixtures";
import { MockStore } from "@/lib/stores/mock";
import { AppError } from "@/lib/domain";
import { apiError } from "@/lib/http";

let store: MockStore;
vi.mock("@/lib/store", () => ({ getStore: () => store }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  getAccess: vi.fn(),
}));

beforeEach(() => {
  demoEnv();
  store = new MockStore();
});
afterEach(() => vi.unstubAllEnvs());

function request(
  method = "GET",
  body?: unknown,
  authorized = true,
  extraHeaders: Record<string, string> = {},
  path = "/api/decisions",
) {
  vi.mocked(getAccess).mockResolvedValue({ kind: authorized ? "demo" : "signed-out" });
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });

describe("authenticated decision API", () => {
  it("requires auth on every route and method", async () => {
    const results = await Promise.all([
      GET(request("GET", undefined, false)),
      POST(request("POST", {}, false)),
      GET_ONE(request("GET", undefined, false), context("11111111-1111-4111-8111-111111111111")),
      PATCH(request("PATCH", {}, false), context("11111111-1111-4111-8111-111111111111")),
    ]);
    expect(results.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    const denied = request();
    vi.mocked(getAccess).mockResolvedValue({ kind: "denied" });
    expect((await GET(denied)).status).toBe(403);
  });
  it("lists the four seeds deadline-first, without caching private data", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const data = await response.json();
    expect(data.mode).toBe("demo");
    expect(data.webhookHealth).toBeNull();
    expect(data.decisions).toHaveLength(4);
    expect(data.decisions[0].question).toBe("When should we schedule the team workshop?");
  });
  it("creates a decision and reads it back", async () => {
    const response = await POST(
      request("POST", { question: "One question", area: "Other", options: ["First", "Second"] }),
    );
    expect(response.status).toBe(201);
    const { decision } = await response.json();
    const read = await GET_ONE(request(), context(decision.id));
    expect((await read.json()).decision).toMatchObject({
      question: "One question",
      options: ["First", "Second"],
      status: "Open",
    });
  });
  it("supports answer, change, undo, and routed locking end to end", async () => {
    const [, decision] = await store.list();
    const patch = async (body: unknown) => PATCH(request("PATCH", body), context(decision.id));
    const first = await patch({
      action: "answer",
      answer: "Approve it",
      custom: false,
      expectedRevision: decision.revision,
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.webhookHealth).toBeNull();
    const saved = firstBody.decision;
    const staleUndo = await patch({ action: "reopen", expectedRevision: decision.revision });
    expect(staleUndo.status).toBe(409);
    const changed = (
      await (
        await patch({
          action: "answer",
          answer: "My own choice",
          custom: true,
          expectedRevision: saved.revision,
        })
      ).json()
    ).decision;
    expect(changed.customAnswer).toBe("My own choice");
    const reopened = (
      await (await patch({ action: "reopen", expectedRevision: changed.revision })).json()
    ).decision;
    expect(reopened).toMatchObject({ status: "Open", answer: "", answeredAt: null });
    const answered = (
      await (
        await patch({
          action: "answer",
          answer: "Revise it",
          custom: false,
          expectedRevision: reopened.revision,
        })
      ).json()
    ).decision;
    const routed = (
      await (await patch({ action: "route", expectedRevision: answered.revision })).json()
    ).decision;
    expect(routed.status).toBe("Routed");
    expect((await patch({ action: "reopen", expectedRevision: routed.revision })).status).toBe(409);
  });
  it("rejects a different question’s options", async () => {
    const [decision] = await store.list();
    expect(
      (
        await PATCH(
          request("PATCH", {
            action: "answer",
            answer: "Approve it",
            custom: false,
            expectedRevision: decision.revision,
          }),
          context(decision.id),
        )
      ).status,
    ).toBe(400);
  });
  it("rejects cross-origin mutations and non-JSON bodies", async () => {
    const input = { question: "Question", area: "Content", options: [] };
    expect(
      (await POST(request("POST", input, true, { Origin: "https://somewhere-else.example" })))
        .status,
    ).toBe(403);
    expect(
      (await POST(request("POST", input, true, { "Sec-Fetch-Site": "cross-site" }))).status,
    ).toBe(403);
    expect(
      (await POST(request("POST", input, true, { "Content-Type": "text/plain" }))).status,
    ).toBe(415);
    expect(
      (await POST(request("POST", input, true, { Origin: "http://localhost:3000" }))).status,
    ).toBe(201);
  });
  it.each([
    { Host: "127.0.0.1:3107", Origin: "http://127.0.0.1:3107" },
    {
      Host: "localhost:3000",
      Origin: "https://decisions.example",
      "X-Forwarded-Host": "decisions.example",
      "X-Forwarded-Proto": "https",
    },
  ])(
    "accepts the actual ingress origin when Next normalizes its internal URL %#",
    async (ingressHeaders) => {
      const input = { question: "An ingress test", area: "Other", options: [] };
      const headers = ingressHeaders as Record<string, string>;
      expect((await POST(request("POST", input, true, headers))).status).toBe(201);
      expect(
        (
          await POST(
            request("POST", input, true, { ...headers, Origin: "https://unrelated.example" }),
          )
        ).status,
      ).toBe(403);
    },
  );
  it("handles malformed, oversized, and invalid bodies", async () => {
    const invalid = new NextRequest("http://localhost:3000/api/decisions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "{invalid",
    });
    expect((await POST(invalid)).status).toBe(400);
    expect(
      (
        await POST(
          request("POST", { question: "Question", area: "Content", context: "x".repeat(25000) }),
        )
      ).status,
    ).toBe(413);
    expect((await POST(request("POST", { question: "", area: "Content" }))).status).toBe(400);
    expect((await GET_ONE(request(), context("invalid"))).status).toBe(404);
    expect((await GET_ONE(request(), context("99999999-9999-4999-8999-999999999999"))).status).toBe(
      404,
    );
  });
  it("does not leak provider error details", async () => {
    vi.spyOn(store, "list").mockRejectedValue(
      new Error("sensitive provider error with a private token"),
    );
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("private token");
  });
  it("preserves safe domain conflicts across different Next route bundle constructors", async () => {
    const conflict = new AppError("This answer is locked.", 409);
    Object.setPrototypeOf(conflict, Error.prototype);
    expect(conflict instanceof AppError).toBe(false);
    const response = apiError(conflict);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This answer is locked." });
  });
  it("does not trust status fields on unbranded provider errors", async () => {
    const response = apiError(
      Object.assign(new Error("sensitive provider metadata"), { status: 409 }),
    );
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("sensitive provider metadata");
  });
});
