import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/agent/decisions/route";
import { POST as ROUTE } from "@/app/api/agent/decisions/[id]/route/route";
import { GET as GET_ONE } from "@/app/api/agent/decisions/[id]/route";
import { GET as HUMAN_GET } from "@/app/api/decisions/route";
import { getAccess } from "@/lib/auth";
import { demoEnv } from "./fixtures";
import { MockStore } from "@/lib/stores/mock";

let store: MockStore;
vi.mock("@/lib/store", () => ({ getStore: () => store, getAgentStore: () => store }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  getAccess: vi.fn(),
}));
const key = "test-agent-token-not-a-credential";
beforeEach(() => {
  demoEnv();
  vi.mocked(getAccess).mockResolvedValue({ kind: "signed-out" });
  vi.stubEnv("AGENT_API_KEY", key);
  store = new MockStore();
});
afterEach(() => vi.unstubAllEnvs());
const context = (id: string) => ({ params: Promise.resolve({ id }) });
function request(method = "GET", body?: unknown, headers: Record<string, string> = {}, query = "") {
  return new NextRequest(`http://localhost:3000/api/agent/decisions${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("agent REST API", () => {
  it("requires the separate bearer token for every endpoint, even with a human session", async () => {
    const [decision] = await store.list();
    for (const authorization of [
      "",
      "Bearer wrong",
      "Bearer demo",
      "Basic test",
      `Bearer ${key} extra`,
    ]) {
      const headers = {
        Authorization: authorization,
        Cookie: "sb-test-auth-token=fixture-session",
      };
      expect((await GET(request("GET", undefined, headers))).status).toBe(401);
      expect((await GET_ONE(request("GET", undefined, headers), context(decision.id))).status).toBe(
        401,
      );
      expect((await POST(request("POST", {}, headers))).status).toBe(401);
      expect((await ROUTE(request("POST", {}, headers), context(decision.id))).status).toBe(401);
    }
    // An agent token grants no access to the human answer/edit API.
    expect((await HUMAN_GET(request())).status).toBe(401);
    vi.stubEnv("AGENT_API_KEY", "");
    expect((await GET(request())).status).toBe(401);
  });
  it("creates with all supported fields and filters by status", async () => {
    const input = {
      question: "Which illustration?",
      context: "Two sketches are ready.",
      options: ["A", "B"],
      area: "Design",
      waitingOn: "Art assistant",
      deadline: "2026-12-01T10:00:00-03:00",
      imageUrls: ["https://example.com/sketch.png"],
    };
    const created = await POST(request("POST", input));
    expect(created.status).toBe(201);
    const { decision } = await created.json();
    const single = await GET_ONE(request(), context(decision.id));
    expect(single.status).toBe(200);
    expect((await single.json()).decision.id).toBe(decision.id);
    expect(decision).toMatchObject({
      question: input.question,
      context: input.context,
      options: input.options,
      area: "Design",
      waitingOn: "Art assistant",
      deadline: "2026-12-01T13:00:00.000Z",
      status: "Open",
      images: [expect.objectContaining({ url: input.imageUrls[0] })],
    });
    const answered = await store.mutate(decision.id, {
      action: "answer",
      answer: "A",
      custom: false,
      expectedRevision: decision.revision,
    });
    const response = await GET(request("GET", undefined, {}, "?status=Answered"));
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toContain("Authorization");
    expect((await response.json()).decisions.map((d: { id: string }) => d.id)).toEqual([
      answered.id,
    ]);
    expect((await GET(request("GET", undefined, {}, "?status=Routed"))).status).toBe(200);
    expect(
      (await (await GET(request("GET", undefined, {}, "?status=Routed"))).json()).decisions,
    ).toEqual([]);
    expect((await GET(request("GET", undefined, {}, "?status=Answered%27%20OR%201"))).status).toBe(
      400,
    );
  });
  it("routes only the observed answered revision and leaves Routed records locked", async () => {
    const [decision] = await store.list();
    expect(
      (await ROUTE(request("POST", { expectedRevision: decision.revision }), context(decision.id)))
        .status,
    ).toBe(409);
    const answered = await store.mutate(decision.id, {
      action: "answer",
      answer: decision.options[0],
      custom: false,
      expectedRevision: decision.revision,
    });
    expect(
      (await ROUTE(request("POST", { expectedRevision: decision.revision }), context(decision.id)))
        .status,
    ).toBe(409);
    const response = await ROUTE(
      request("POST", { expectedRevision: answered.revision }),
      context(decision.id),
    );
    const routed = (await response.json()).decision;
    expect(response.status).toBe(200);
    expect(routed).toMatchObject({ status: "Routed", answer: answered.answer });
    expect(
      (await ROUTE(request("POST", { expectedRevision: routed.revision }), context(decision.id)))
        .status,
    ).toBe(409);
    expect(
      (await (await GET(request("GET", undefined, {}, "?status=Routed"))).json()).decisions,
    ).toHaveLength(1);
  });
  it("rejects bad image URLs, media types, bodies, missing revisions, and invalid IDs", async () => {
    expect(
      (
        await POST(
          request("POST", { question: "A", area: "Other", imageUrls: ["javascript:alert(1)"] }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request("POST", { question: "A", area: "Other" }, { "Content-Type": "text/plain" }),
        )
      ).status,
    ).toBe(415);
    expect(
      (await POST(request("POST", { question: "x".repeat(25000), area: "Other" }))).status,
    ).toBe(413);
    expect(
      (await ROUTE(request("POST", {}), context("11111111-1111-4111-8111-111111111111"))).status,
    ).toBe(400);
    expect((await ROUTE(request("POST", {}), context("../../other"))).status).toBe(404);
    expect(
      (await ROUTE(request("POST", { expectedRevision: "missing" }), context("rec12345678901234")))
        .status,
    ).toBe(404);
  });
});
