import { AUDIO_BUCKET } from "./appwrite/ids";
import { AppError, type AnswerAttachment, type AnswerMedia, type Decision } from "./domain";
import { validateImage, type ImageUpload } from "./images";

export { AUDIO_BUCKET };
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 300;
export const MAX_ANSWER_BODY_BYTES = 12 * 1024 * 1024;

export interface AnswerUpload {
  kind: "image" | "audio";
  bytes: Uint8Array;
  contentType: string;
  filename: string;
  alt: string;
  durationSeconds: number | null;
}

const AUDIO_EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
};

const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

function named(filename: string, ext: string) {
  const clean = filename
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .replace(/^\.+/, "")
    .slice(-100);
  const base = (clean.replace(/\.[a-z0-9]+$/i, "") || "reply").slice(0, 80);
  return `${base}.${ext}`;
}

export function cleanAlt(value: string) {
  const alt = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 200);
  return alt;
}

function isWebm(bytes: Buffer) {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  );
}

function isOgg(bytes: Buffer) {
  return bytes.subarray(0, 4).toString() === "OggS";
}

function isWav(bytes: Buffer) {
  return bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WAVE";
}

function isMp3(bytes: Buffer) {
  return (
    bytes.subarray(0, 3).toString() === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  );
}

function isAudioMp4(bytes: Buffer) {
  if (bytes.length < 12 || bytes.subarray(4, 8).toString() !== "ftyp") return false;
  const brand = bytes.subarray(8, 12).toString();
  const head = bytes.subarray(8, Math.min(bytes.length, 64)).toString("latin1");
  if (["avc1", "hev1", "hvc1"].some((video) => brand === video || head.includes(video)))
    return false;
  return brand === "M4A " || brand === "M4B " || head.includes("M4A");
}

export function validateAudio(upload: {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
  durationSeconds?: number | null;
}): AnswerUpload {
  if (!upload.bytes.length) throw new AppError("The audio file is empty.");
  if (upload.bytes.length > MAX_AUDIO_BYTES)
    throw new AppError("Audio must be 8 MiB or smaller.", 413);
  const duration = upload.durationSeconds ?? null;
  if (
    duration !== null &&
    (!Number.isFinite(duration) || duration < 0 || duration > MAX_AUDIO_SECONDS)
  )
    throw new AppError("Audio must be 5 minutes or shorter.");
  const mime = upload.contentType.toLowerCase().split(";")[0].trim();
  const normalized =
    mime === "audio/x-m4a" || mime === "audio/m4a" || mime === "audio/wave"
      ? mime === "audio/wave"
        ? "audio/wav"
        : "audio/mp4"
      : mime;
  const bytes = Buffer.from(upload.bytes);
  const matches =
    (normalized === "audio/webm" && isWebm(bytes)) ||
    (normalized === "audio/ogg" && isOgg(bytes)) ||
    (normalized === "audio/wav" && isWav(bytes)) ||
    (normalized === "audio/mpeg" && isMp3(bytes)) ||
    (normalized === "audio/mp4" && isAudioMp4(bytes));
  if (!matches)
    throw new AppError(
      "Use a WebM, MP3, M4A, WAV, or Ogg audio file with a matching content type.",
      415,
    );
  const ext = AUDIO_EXT[mime] || AUDIO_EXT[normalized];
  return {
    kind: "audio",
    bytes: upload.bytes,
    contentType: normalized,
    filename: named(upload.filename, ext),
    alt: "",
    durationSeconds: duration,
  };
}

function validateAnswerImage(upload: AnswerUpload): AnswerUpload {
  const image: ImageUpload = validateImage(upload);
  const ext = IMAGE_EXT[image.contentType];
  const alt = cleanAlt(upload.alt) || image.filename;
  return {
    kind: "image",
    bytes: image.bytes,
    contentType: image.contentType,
    filename: named(image.filename, ext),
    alt: cleanAlt(alt).slice(0, 200) || "Answer image",
    durationSeconds: null,
  };
}

export function validateAnswerUploads(uploads: AnswerUpload[]): AnswerUpload[] {
  if (uploads.length > 2) throw new AppError("Attach at most one image and one audio file.");
  const images = uploads.filter((item) => item.kind === "image");
  const audios = uploads.filter((item) => item.kind === "audio");
  if (images.length > 1 || audios.length > 1 || images.length + audios.length !== uploads.length)
    throw new AppError("Attach at most one image and one audio file.");
  return [...images.map(validateAnswerImage), ...audios.map(validateAudio)];
}

export function withAgentMediaUrls(decision: Decision, origin: string): Decision {
  if (!decision.answerMedia.length) return decision;
  const base = origin.replace(/\/$/, "");
  return {
    ...decision,
    answerMedia: decision.answerMedia.map((item) => {
      const url = `${base}/api/agent/decisions/${decision.id}/media/${item.id}`;
      return { ...item, url, thumbnailUrl: item.kind === "image" ? url : "" };
    }),
  };
}

export function webhookMedia(decision: Decision, origin: string) {
  const view = origin ? withAgentMediaUrls(decision, origin) : decision;
  return view.answerMedia.map((item: AnswerMedia) => ({
    id: item.id,
    kind: item.kind,
    url: item.url,
    content_type: item.contentType,
    filename: item.filename,
    alt: item.alt,
    duration_seconds: item.durationSeconds,
  }));
}

export function attachmentFromUpload(id: string, upload: AnswerUpload): AnswerAttachment {
  return {
    id,
    kind: upload.kind,
    filename: upload.filename,
    contentType: upload.contentType,
    alt: upload.alt,
    durationSeconds: upload.durationSeconds,
  };
}

export function mediaResponse(
  file: { bytes: Uint8Array; contentType: string; filename: string },
  request: Request,
) {
  const ascii =
    file.filename
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/["\\]/g, "")
      .slice(0, 120) || "file";
  const headers = new Headers({
    "Content-Type": file.contentType,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
    "Content-Disposition": `inline; filename="${ascii}"`,
  });
  const total = file.bytes.byteLength;
  const range = request.headers.get("range");
  if (!range) {
    headers.set("Content-Length", String(total));
    return new Response(Buffer.from(file.bytes), { status: 200, headers });
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(range.trim());
  const start = match ? Number(match[1]) : NaN;
  const end = match && match[2] ? Number(match[2]) : total - 1;
  if (!match || !Number.isInteger(start) || start >= total || end < start || end >= total) {
    headers.set("Content-Range", `bytes */${total}`);
    return new Response(null, { status: 416, headers });
  }
  const slice = file.bytes.slice(start, end + 1);
  headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
  headers.set("Content-Length", String(slice.byteLength));
  return new Response(Buffer.from(slice), { status: 206, headers });
}
