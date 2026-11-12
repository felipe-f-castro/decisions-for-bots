import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH, DELETE } from "@/app/api/decisions/[id]/route";
import { GET as MEDIA } from "@/app/api/decisions/[id]/media/[fileId]/route";
import { GET as AGENT_LIST, POST as AGENT_POST } from "@/app/api/agent/decisions/route";
import { GET as AGENT_GET, DELETE as AGENT_DELETE } from "@/app/api/agent/decisions/[id]/route";
import { GET as AGENT_MEDIA } from "@/app/api/agent/decisions/[id]/media/[fileId]/route";
import { getAccess } from "@/lib/auth";
import { applyMutation, answerSummary, recordedDuration } from "@/lib/domain";
import { validateAudio } from "@/lib/media";
import { webhookSetupInstructions } from "@/lib/webhook-instructions";
import { MockStore } from "@/lib/stores/mock";
import { demoEnv, png } from "./fixtures";
import { seedDecisions } from "@/lib/seed";

let store: MockStore;
vi.mock("@/lib/store", () => ({ getStore: () => store, getAgentStore: () => store }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  getAccess: vi.fn(),
}));

const key = "test-agent-token-not-a-credential";
const secret = "test-webhook-secret-value";
const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f]);
const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")]);

beforeEach(() => {
  demoEnv();
  vi.stubEnv("AGENT_API_KEY", key);
  store = new MockStore();
  vi.mocked(getAccess).mockResolvedValue({ kind: "demo" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const context = (id: string) => ({ params: Promise.resolve({ id }) });
const mediaContext = (id: string, fileId: string) => ({ params: Promise.resolve({ id, fileId }) });

function imageFile(name = "shot.png") {
  return new File([png], name, { type: "image/png" });
}
function audioFile(bytes: Uint8Array = webm, name = "reply.webm", type = "audio/webm") {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new File([copy], name, { type });
}

function patch(id: string, form: FormData) {
  return PATCH(
    new NextRequest(`http://localhost:3000/api/decisions/${id}`, { method: "PATCH", body: form }),
    context(id),
  );
}

function mutation(
  decision: { revision: string; options?: string[] },
  extra: Record<string, unknown> = {},
) {
  const form = new FormData();
  form.set(
    "mutation",
    JSON.stringify({
      action: "answer",
      answer: extra.answer ?? "",
      custom: extra.custom ?? true,
      expectedRevision: decision.revision,
    }),
  );
  return form;
}

describe("answer media", () => {
  it("accepts an image, audio, or both, including a media-only reply", async () => {
    const [logo] = await store.list();
    const imageOnly = mutation(logo);
    imageOnly.set("image", imageFile());
    imageOnly.set("imageAlt", "Rounded mark on white");
    const imageResponse = await patch(logo.id, imageOnly);
    expect(imageResponse.status).toBe(200);
    const imageDecision = (await imageResponse.json()).decision;
    expect(imageDecision.answer).toBe("");
    expect(imageDecision.customAnswer).toBe("");
    expect(imageDecision.answerMedia).toEqual([
      expect.objectContaining({
        kind: "image",
        filename: "shot.png",
        contentType: "image/png",
        alt: "Rounded mark on white",
        url: expect.stringMatching(new RegExp(`^/api/decisions/${logo.id}/media/`)),
      }),
    ]);
    expect(answerSummary(imageDecision)).toBe("Image reply");

    const audioForm = mutation(imageDecision, { answer: "Geometric mark", custom: false });
    audioForm.set("audio", audioFile());
    audioForm.set("audioDuration", "12.2");
    const audioResponse = await patch(logo.id, audioForm);
    expect(audioResponse.status).toBe(200);
    const audioDecision = (await audioResponse.json()).decision;
    expect(audioDecision.answer).toBe("Geometric mark");
    expect(audioDecision.customAnswer).toBe("");
    expect(audioDecision.answerMedia).toEqual([
      expect.objectContaining({ kind: "audio", contentType: "audio/webm", durationSeconds: 12.2 }),
    ]);
    expect(answerSummary(audioDecision)).toBe("Geometric mark");

    const both = mutation(audioDecision, { answer: "Use both", custom: true });
    both.set("image", imageFile("both.png"));
    both.set("audio", audioFile(wav, "reply.wav", "audio/wav"));
    both.set("audioDuration", "3");
    const bothResponse = await patch(logo.id, both);
    expect(bothResponse.status).toBe(200);
    const bothDecision = (await bothResponse.json()).decision;
    expect(bothDecision.answerMedia.map((item: { kind: string }) => item.kind)).toEqual([
      "image",
      "audio",
    ]);
    expect(answerSummary({ answer: "", answerMedia: bothDecision.answerMedia })).toBe(
      "Image and audio reply",
    );
  });

  it("rejects the wrong type, a mismatched signature, an oversized file, and an empty reply", async () => {
    const [logo] = await store.list();
    const html = mutation(logo);
    html.set("image", new File(["<html></html>"], "page.html", { type: "text/html" }));
    expect((await patch(logo.id, html)).status).toBe(415);

    const disguised = mutation(logo);
    disguised.set("image", new File([Buffer.from("%PDF-1.7")], "shot.png", { type: "image/png" }));
    expect((await patch(logo.id, disguised)).status).toBe(415);

    const video = mutation(logo);
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypavc1"),
      Buffer.alloc(8),
    ]);
    video.set("audio", new File([mp4], "clip.mp4", { type: "audio/mp4" }));
    expect((await patch(logo.id, video)).status).toBe(415);

    const extra = mutation(logo);
    extra.set("document", new File(["hello"], "notes.txt", { type: "text/plain" }));
    expect((await patch(logo.id, extra)).status).toBe(415);

    const empty = mutation(logo);
    expect((await patch(logo.id, empty)).status).toBe(400);

    expect(() =>
      validateAudio({
        bytes: new Uint8Array(8 * 1024 * 1024 + 1),
        contentType: "audio/webm",
        filename: "long.webm",
      }),
    ).toThrow(/8 MiB/);
    expect(() =>
      validateAudio({
        bytes: webm,
        contentType: "audio/webm",
        filename: "long.webm",
        durationSeconds: 301,
      }),
    ).toThrow(/5 minutes/);
    expect(recordedDuration(300.4)).toBe(300);
    expect(recordedDuration(299.6)).toBe(299.6);
    expect(() =>
      validateAudio({
        bytes: webm,
        contentType: "audio/webm",
        filename: "capped.webm",
        durationSeconds: recordedDuration(300.4),
      }),
    ).not.toThrow();
  });

  it("serves answer media to the signed-in owner and the agent, and includes it on the webhook", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DECISION_WEBHOOK_URL", "https://example.com/hooks/decision-answered");
    vi.stubEnv("DECISION_WEBHOOK_SECRET", secret);
    const [logo, other] = await store.list();
    const form = mutation(logo, { answer: "Rounded mark", custom: false });
    form.set("image", imageFile());
    form.set("imageAlt", "Chosen logo");
    form.set("audio", audioFile());
    form.set("audioDuration", "4");
    const saved = (await (await patch(logo.id, form)).json()).decision;
    expect(fetchMock).toHaveBeenCalledOnce();
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const body = JSON.parse(String(calls[0][1].body));
    expect(body.decision.answer_media).toEqual([
      expect.objectContaining({
        kind: "image",
        alt: "Chosen logo",
        content_type: "image/png",
        url: `http://localhost:3000/api/agent/decisions/${logo.id}/media/${saved.answerMedia[0].id}`,
      }),
      expect.objectContaining({
        kind: "audio",
        duration_seconds: 4,
        url: `http://localhost:3000/api/agent/decisions/${logo.id}/media/${saved.answerMedia[1].id}`,
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain(secret);

    const imageId = saved.answerMedia[0].id;
    const human = await MEDIA(
      new NextRequest(`http://localhost:3000/api/decisions/${logo.id}/media/${imageId}`),
      mediaContext(logo.id, imageId),
    );
    expect(human.status).toBe(200);
    expect(human.headers.get("content-type")).toBe("image/png");
    expect(human.headers.get("x-content-type-options")).toBe("nosniff");
    expect(
      Buffer.from(await human.arrayBuffer())
        .subarray(0, 8)
        .toString("hex"),
    ).toBe("89504e470d0a1a0a");

    const ranged = await MEDIA(
      new NextRequest(
        `http://localhost:3000/api/decisions/${logo.id}/media/${saved.answerMedia[1].id}`,
        {
          headers: { range: "bytes=0-3" },
        },
      ),
      mediaContext(logo.id, saved.answerMedia[1].id),
    );
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toMatch(/^bytes 0-3\//);

    vi.mocked(getAccess).mockResolvedValue({ kind: "signed-out" });
    expect(
      (
        await MEDIA(
          new NextRequest("http://localhost:3000/api/decisions/x"),
          mediaContext(logo.id, imageId),
        )
      ).status,
    ).toBe(401);
    vi.mocked(getAccess).mockResolvedValue({ kind: "demo" });
    expect(
      (
        await MEDIA(
          new NextRequest("http://localhost:3000/api/decisions/x"),
          mediaContext(other.id, imageId),
        )
      ).status,
    ).toBe(404);

    const agentHeaders = { Authorization: `Bearer ${key}` };
    const listed = await AGENT_LIST(
      new NextRequest("http://localhost:3000/api/agent/decisions?status=Answered", {
        headers: agentHeaders,
      }),
    );
    const agentDecision = (await listed.json()).decisions.find(
      (item: { id: string }) => item.id === logo.id,
    );
    expect(agentDecision.answerMedia[0].url).toBe(body.decision.answer_media[0].url);
    const one = await AGENT_GET(
      new NextRequest(`http://localhost:3000/api/agent/decisions/${logo.id}`, {
        headers: agentHeaders,
      }),
      context(logo.id),
    );
    expect((await one.json()).decision.answerMedia[1].url).toBe(body.decision.answer_media[1].url);
    const agentFile = await AGENT_MEDIA(
      new NextRequest(body.decision.answer_media[1].url, { headers: agentHeaders }),
      mediaContext(logo.id, saved.answerMedia[1].id),
    );
    expect(agentFile.status).toBe(200);
    expect(agentFile.headers.get("content-type")).toBe("audio/webm");
    expect(
      (
        await AGENT_MEDIA(
          new NextRequest(body.decision.answer_media[1].url),
          mediaContext(logo.id, saved.answerMedia[1].id),
        )
      ).status,
    ).toBe(401);

    expect(
      (
        await AGENT_DELETE(
          new NextRequest(`http://localhost:3000/api/agent/decisions/${logo.id}`, {
            method: "DELETE",
            headers: agentHeaders,
          }),
          context(logo.id),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await MEDIA(
          new NextRequest("http://localhost:3000/api/decisions/x"),
          mediaContext(logo.id, imageId),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await DELETE(
          new NextRequest(`http://localhost:3000/api/decisions/${other.id}`, { method: "DELETE" }),
          context(other.id),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await AGENT_GET(
          new NextRequest(`http://localhost:3000/api/agent/decisions/${other.id}`, {
            headers: agentHeaders,
          }),
          context(other.id),
        )
      ).status,
    ).toBe(404);
  });

  it("keeps the bot setup copy free of secrets and describes answer media", () => {
    const instructions = webhookSetupInstructions();
    expect(instructions).toContain("answer_media");
    expect(instructions).toContain("X-Decisions-Signature");
    expect(instructions).not.toContain(secret);
    expect(instructions).not.toContain("appwrite.network");
    expect(instructions).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const open = seedDecisions()[0];
    expect(() =>
      applyMutation(open, {
        action: "answer",
        answer: "",
        custom: false,
        expectedRevision: open.revision,
      }),
    ).toThrow(/Choose an option/);
    const media = applyMutation(open, {
      action: "answer",
      answer: "",
      custom: true,
      expectedRevision: open.revision,
      attachments: [
        {
          id: "11111111-1111-4111-8111-111111111112",
          kind: "image",
          filename: "a.png",
          contentType: "image/png",
          alt: "A",
          durationSeconds: null,
        },
        {
          id: "11111111-1111-4111-8111-111111111113",
          kind: "audio",
          filename: "a.webm",
          contentType: "audio/webm",
          alt: "",
          durationSeconds: 2,
        },
      ],
    });
    expect(media.answer).toBe("");
    expect(answerSummary(media)).toBe("Image and audio reply");
    expect(() =>
      applyMutation(open, {
        action: "answer",
        answer: "ok",
        custom: true,
        expectedRevision: open.revision,
        attachments: [
          {
            id: "1",
            kind: "image",
            filename: "a.png",
            contentType: "image/png",
            alt: "",
            durationSeconds: null,
          },
          {
            id: "2",
            kind: "image",
            filename: "b.png",
            contentType: "image/png",
            alt: "",
            durationSeconds: null,
          },
        ],
      }),
    ).toThrow(/at most one image/i);
  });
});

describe("agent create still returns the media field", () => {
  it("includes an empty answerMedia list on a new card", async () => {
    const response = await AGENT_POST(
      new NextRequest("http://localhost:3000/api/agent/decisions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ question: "Any media?", area: "Other" }),
      }),
    );
    expect((await response.json()).decision.answerMedia).toEqual([]);
  });
});
