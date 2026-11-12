import { NextRequest, NextResponse } from "next/server";
import { checkToken, checkTokenDigest, getAccess } from "./auth";
import { getConfig } from "./config";
import { AppError, AREAS, isAppError, parseMutation, parseNewDecision } from "./domain";
import { MAX_IMAGE_BYTES, MAX_UPLOAD_BODY_BYTES, validateImage } from "./images";
import { MAX_ANSWER_BODY_BYTES, MAX_AUDIO_BYTES, type AnswerUpload } from "./media";
import { getDecisionAreas, getSettings } from "./appwrite/settings";

export async function authorize(request: NextRequest) {
  const access = await getAccess();
  if (access.kind === "signed-out")
    throw new AppError("Your session has ended. Please sign in again.", 401);
  if (access.kind === "denied")
    throw new AppError("This account is not authorized to use this inbox.", 403);
  if (access.kind === "needs-setup")
    throw new AppError("Finish first-run setup before using this inbox.", 403);
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    // Next may normalize nextUrl to localhost behind a proxy or custom hostname.
    // Match the actual ingress host, as Next's Server Actions also do.
    const host = (
      request.headers.get("x-forwarded-host") ||
      request.headers.get("host") ||
      request.nextUrl.host
    )
      .split(",")[0]
      .trim();
    const protocol = (
      request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "")
    )
      .split(",")[0]
      .trim();
    const expectedOrigin = `${protocol}://${host}`;
    // Non-browser assistants may omit Origin; a browser must match the app origin.
    if (
      (origin && origin !== expectedOrigin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      throw new AppError("This request must come from Decisions.", 403);
  }
  return access;
}

export function requireJson(request: NextRequest) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
  )
    throw new AppError("Send JSON with Content-Type: application/json.", 415);
}

export async function authorizeAgent(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  const candidate = match?.[1] || "";
  if (!candidate || candidate.length > 1024)
    throw new AppError("A valid agent bearer token is required.", 401);
  if (!getConfig().mock) {
    const settings = await getSettings().catch(() => null);
    if (settings?.agentApiKeyHash && checkTokenDigest(candidate, settings.agentApiKeyHash)) return;
  }
  const expected = process.env.AGENT_API_KEY?.trim();
  if (expected && checkToken(candidate, expected)) return;
  throw new AppError("A valid agent bearer token is required.", 401);
}

async function readBody(request: NextRequest, max: number) {
  if (Number(request.headers.get("content-length")) > max)
    throw new AppError("This decision is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("A JSON body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new AppError("This decision is too large.", 413);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    reader.releaseLock();
  }
}

export async function readJson(request: NextRequest): Promise<unknown> {
  requireJson(request);
  const bytes = await readBody(request, 24_000);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new AppError("Please send valid JSON.");
  }
}

export async function resolveDecisionAreas() {
  if (getConfig().mock) return [...AREAS];
  try {
    return await getDecisionAreas();
  } catch {
    return [...AREAS];
  }
}

export async function readCreation(request: NextRequest, areas?: readonly string[]) {
  const allowed = areas ?? (await resolveDecisionAreas());
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;"))
    return { input: parseNewDecision(await readJson(request), allowed), uploads: [] };
  const bytes = await readBody(request, MAX_UPLOAD_BODY_BYTES);
  let form: FormData;
  try {
    form = await new Response(bytes, {
      headers: { "Content-Type": request.headers.get("content-type")! },
    }).formData();
  } catch {
    throw new AppError("Send a valid multipart form.");
  }
  const decision = form.get("decision");
  if (typeof decision !== "string" || Buffer.byteLength(decision) > 24_000)
    throw new AppError("Include a decision JSON field of at most 24 KB.");
  let data: unknown;
  try {
    data = JSON.parse(decision);
  } catch {
    throw new AppError("The decision field must contain valid JSON.");
  }
  const input = parseNewDecision(data, allowed);
  const files = form.getAll("images");
  if (files.length + input.imageUrls.length > 10)
    throw new AppError("Add up to 10 images in total.");
  const uploads = await Promise.all(
    files.map(async (file) => {
      if (typeof file === "string") throw new AppError("Send image files in the images fields.");
      if (file.size > MAX_IMAGE_BYTES)
        throw new AppError("Each image must be 3 MiB or smaller.", 413);
      return validateImage({
        filename: file.name,
        contentType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
    }),
  );
  return { input, uploads };
}

function fileBytes(file: File, max: number, label: string) {
  if (file.size > max) throw new AppError(`${label} is too large.`, 413);
  return file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

/** JSON answers stay as they were. Multipart adds at most one image and one audio file. */
export async function readAnswerMutation(request: NextRequest) {
  const type = request.headers.get("content-type")?.toLowerCase() || "";
  if (!type.startsWith("multipart/form-data;")) {
    return { mutation: parseMutation(await readJson(request)), uploads: [] as AnswerUpload[] };
  }
  const bytes = await readBody(request, MAX_ANSWER_BODY_BYTES);
  let form: FormData;
  try {
    form = await new Response(bytes, {
      headers: { "Content-Type": request.headers.get("content-type")! },
    }).formData();
  } catch {
    throw new AppError("Send a valid multipart form.");
  }
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string" && value.size > 0 && key !== "image" && key !== "audio")
      throw new AppError("Attach an image or an audio file only.", 415);
  }
  const raw = form.get("mutation");
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 24_000)
    throw new AppError("Include a mutation JSON field of at most 24 KB.");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AppError("The mutation field must contain valid JSON.");
  }
  const image = form.get("image");
  const audio = form.get("audio");
  const uploads: AnswerUpload[] = [];
  if (image && typeof image !== "string" && image.size > 0) {
    uploads.push({
      kind: "image",
      bytes: await fileBytes(image, MAX_IMAGE_BYTES, "Each image"),
      contentType: image.type,
      filename: image.name,
      alt: String(form.get("imageAlt") || ""),
      durationSeconds: null,
    });
  }
  if (audio && typeof audio !== "string" && audio.size > 0) {
    const durationRaw = String(form.get("audioDuration") || "").trim();
    let durationSeconds: number | null = null;
    if (durationRaw) {
      durationSeconds = Number(durationRaw);
      if (!Number.isFinite(durationSeconds))
        throw new AppError("Audio duration must be a number of seconds.");
    }
    uploads.push({
      kind: "audio",
      bytes: await fileBytes(audio, MAX_AUDIO_BYTES, "Audio"),
      contentType: audio.type,
      filename: audio.name,
      alt: "",
      durationSeconds,
    });
  }
  return {
    mutation: parseMutation(data, { allowEmptyAnswer: uploads.length > 0 }),
    uploads,
  };
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" },
  });
}

export function apiError(error: unknown) {
  if (isAppError(error)) return json({ error: error.message }, error.status);
  // Do not return SDK errors, headers, tokens, or private store content.
  return json(
    { error: "We couldn’t reach your decision store. Please try again in a moment." },
    502,
  );
}
