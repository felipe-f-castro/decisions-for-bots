import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/agent/decisions/route";
import { GET as GET_IMAGE } from "@/app/api/demo/images/[id]/route";
import { MockStore } from "@/lib/stores/mock";
import { demoEnv, appwriteEnv, png } from "./fixtures";
import { readJson, readCreation } from "@/lib/http";
import { MAX_UPLOAD_BODY_BYTES } from "@/lib/images";

let store: MockStore;
vi.mock("@/lib/store", () => ({ getAgentStore: () => store, getStore: () => store }));
beforeEach(() => {
  demoEnv();
  vi.stubEnv("AGENT_API_KEY", "fixture-agent-token");
  store = new MockStore([]);
});
afterEach(() => vi.unstubAllEnvs());

function upload(form: FormData, authorized = true) {
  return new NextRequest("http://localhost:3000/api/agent/decisions", {
    method: "POST",
    headers: authorized ? { Authorization: "Bearer fixture-agent-token" } : {},
    body: form,
  });
}
function form() {
  const form = new FormData();
  form.set("decision", JSON.stringify({ question: "Choose an image", area: "Design" }));
  form.append("images", new Blob([png], { type: "image/png" }), "image.png");
  return form;
}

describe("multipart and streamed body boundaries", () => {
  it("disables the public in-memory image endpoint when Appwrite is configured", async () => {
    appwriteEnv();
    const response = await GET_IMAGE(new Request("http://localhost:3000"), {
      params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
    });
    expect(response.status).toBe(404);
  });
  it("allows agents to upload files with a decision and keeps demo bytes in memory", async () => {
    const response = await POST(upload(form()));
    expect(response.status).toBe(201);
    const { decision } = await response.json();
    expect(decision.images[0]).toMatchObject({
      filename: "image.png",
      url: `/api/demo/images/${decision.images[0].id}`,
    });
    const image = await GET_IMAGE(new Request("http://localhost:3000"), {
      params: Promise.resolve({ id: decision.images[0].id }),
    });
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
  });
  it("checks bearer authentication before parsing uploaded content", async () => {
    expect((await POST(upload(form(), false))).status).toBe(401);
    expect(await store.list()).toEqual([]);
  });
  it("rejects spoofed files and a combined count over ten", async () => {
    const invalid = form();
    invalid.set("images", new Blob(["not a png"], { type: "image/png" }), "fake.png");
    expect((await POST(upload(invalid))).status).toBe(415);
    const many = form();
    many.set(
      "decision",
      JSON.stringify({
        question: "A",
        area: "Other",
        imageUrls: Array.from({ length: 10 }, (_, index) => `https://images.example/${index}.png`),
      }),
    );
    expect((await POST(upload(many))).status).toBe(400);
  });
  it("bounds multipart streams without Content-Length before parsing", async () => {
    const request = new NextRequest("http://localhost:3000/api/agent/decisions", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=fixture" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_UPLOAD_BODY_BYTES + 1));
          controller.close();
        },
      }),
    });
    await expect(readCreation(request)).rejects.toMatchObject({ status: 413 });
    const json = new NextRequest("http://localhost:3000/api/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "x".repeat(24001),
    });
    await expect(readJson(json)).rejects.toMatchObject({ status: 413 });
  });
});
