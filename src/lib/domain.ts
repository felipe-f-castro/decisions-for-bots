export const DEFAULT_AREAS = ["Design", "Content", "Other"] as const;
export const MAX_AREAS = 12;
export const MAX_AREA_LENGTH = 40;

/**
 * Parses NEXT_PUBLIC_DECISION_AREAS: a comma-separated list of area names.
 * Names are trimmed and deduplicated (case-insensitively); empty entries are
 * skipped. Throws when a name is longer than 40 characters or there are more
 * than 12 areas. An unset or empty value falls back to Design, Content, Other.
 */
export function parseAreas(value: string | undefined | null): string[] {
  const seen = new Set<string>();
  const areas: string[] = [];
  for (const raw of (value ?? "").split(",")) {
    const area = raw.trim();
    if (!area) continue;
    if (area.length > MAX_AREA_LENGTH)
      throw new Error(
        `NEXT_PUBLIC_DECISION_AREAS: "${area}" is longer than ${MAX_AREA_LENGTH} characters.`,
      );
    const key = area.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    areas.push(area);
  }
  if (areas.length > MAX_AREAS)
    throw new Error(`NEXT_PUBLIC_DECISION_AREAS: use at most ${MAX_AREAS} areas.`);
  return areas.length ? areas : [...DEFAULT_AREAS];
}

// Read through the full process.env.NEXT_PUBLIC_* expression so Next inlines
// the value into client bundles at build time.
export const AREAS: readonly string[] = parseAreas(process.env.NEXT_PUBLIC_DECISION_AREAS);
export const STATUSES = ["Open", "Answered", "Routed"] as const;
export type Area = string;
export type Status = (typeof STATUSES)[number];

export interface DecisionImage {
  id: string;
  url: string;
  thumbnailUrl: string;
  filename: string;
}

/** One image and/or one audio clip attached to an answer. */
export interface AnswerMedia {
  id: string;
  kind: "image" | "audio";
  url: string;
  thumbnailUrl: string;
  filename: string;
  contentType: string;
  alt: string;
  durationSeconds: number | null;
}

/** File metadata after the bytes have been stored. URLs are added by the store. */
export interface AnswerAttachment {
  id: string;
  kind: "image" | "audio";
  filename: string;
  contentType: string;
  alt: string;
  durationSeconds: number | null;
}

export interface Decision {
  id: string;
  question: string;
  context: string;
  options: string[];
  images: DecisionImage[];
  area: Area;
  waitingOn: string;
  deadline: string | null;
  status: Status;
  /** Empty when the reply is media only. The display label is `answerSummary`. */
  answer: string;
  customAnswer: string;
  answerMedia: AnswerMedia[];
  answeredAt: string | null;
  createdAt: string;
  updatedAt: string;
  revision: string;
}

export type NewDecision = Pick<
  Decision,
  "question" | "context" | "options" | "area" | "waitingOn" | "deadline"
> & { imageUrls: string[] };
export type Mutation =
  | {
      action: "answer";
      answer: string;
      custom: boolean;
      expectedRevision: string;
      /**
       * Stored files for this answer. Omitted or empty means the saved answer
       * has no media. Callers that accept HTTP input must not trust client-supplied ids.
       */
      attachments?: AnswerAttachment[];
    }
  | { action: "reopen"; expectedRevision: string }
  | { action: "route"; expectedRevision: string };

const APP_ERROR = Symbol.for("decisions.app-error");

export class AppError extends Error {
  readonly [APP_ERROR] = true;
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function isAppError(error: unknown): error is AppError {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Partial<AppError>;
  // A cached store can originate in a different Next route bundle, with a
  // different constructor identity. The global symbol survives that boundary.
  return (
    candidate[APP_ERROR] === true &&
    typeof candidate.message === "string" &&
    Number.isInteger(candidate.status) &&
    candidate.status! >= 400 &&
    candidate.status! <= 599
  );
}

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new AppError("Please send a valid JSON object.");
  return input as Record<string, unknown>;
}

function string(value: unknown, label: string, max: number, required = false): string {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") throw new AppError(`${label} must be text.`);
  const result = value.trim();
  if (required && !result) throw new AppError(`${label} is required.`);
  if (result.length > max) throw new AppError(`${label} must be ${max} characters or fewer.`);
  return result;
}

export function listChoices(values: readonly string[]): string {
  if (values.length <= 1) return values.join("");
  if (values.length === 2) return `${values[0]} or ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, or ${values[values.length - 1]}`;
}

/** CSS tone for an area: built-in colors for the defaults, a stable hashed tone otherwise. */
export function areaTone(area: string): string {
  const key = area.trim().toLowerCase();
  if (key === "design" || key === "content" || key === "other") return key;
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `tone-${hash % 4}`;
}

export function parseNewDecision(input: unknown, areas: readonly string[] = AREAS): NewDecision {
  const data = record(input);
  const question = string(data.question, "Question", 240, true);
  const context = string(data.context, "Context", 4000);
  const waitingOn = string(data.waitingOn, "Waiting on", 100);
  const area = typeof data.area === "string" ? data.area.trim() : "";
  if (!areas.includes(area)) throw new AppError(`Choose ${listChoices(areas)}.`);
  const options = data.options ?? [];
  if (!Array.isArray(options) || options.length > 20)
    throw new AppError("Add up to 20 answer options.");
  const cleanOptions = options.map((value) => string(value, "Each option", 200, true));
  if (cleanOptions.some((option) => /[\r\n]/.test(option)))
    throw new AppError("Put each option on its own line.");
  if (new Set(cleanOptions).size !== cleanOptions.length)
    throw new AppError("Each answer option must be different.");
  let deadline: string | null = null;
  if (data.deadline !== null && data.deadline !== undefined && data.deadline !== "") {
    if (
      typeof data.deadline !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(data.deadline) ||
      !Number.isFinite(Date.parse(data.deadline))
    ) {
      throw new AppError("Use a valid deadline with a timezone.");
    }
    deadline = new Date(data.deadline).toISOString();
  }
  const urls = data.imageUrls ?? [];
  if (!Array.isArray(urls) || urls.length > 10) throw new AppError("Add up to 10 image URLs.");
  const imageUrls = urls.map((value) => {
    const url = string(value, "Image URL", 2048, true);
    if (!isWebUrl(url)) throw new AppError("Use an HTTP or HTTPS image URL without credentials.");
    return url;
  });
  return {
    question,
    context,
    options: cleanOptions,
    area,
    waitingOn,
    deadline,
    imageUrls: [...new Set(imageUrls)],
  };
}

export function parseMutation(input: unknown, options?: { allowEmptyAnswer?: boolean }): Mutation {
  const data = record(input);
  const expectedRevision = string(data.expectedRevision, "Decision version", 100, true);
  if (data.action === "reopen" || data.action === "route")
    return { action: data.action, expectedRevision };
  if (data.action !== "answer") throw new AppError("Choose answer, reopen, or route.");
  if (typeof data.custom !== "boolean")
    throw new AppError("Specify whether this is a custom answer.");
  return {
    action: "answer",
    answer: string(data.answer, "Answer", 2000, !options?.allowEmptyAnswer),
    custom: data.custom,
    expectedRevision,
  };
}

export function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

export function answerSummary(decision: Pick<Decision, "answer" | "answerMedia">) {
  if (decision.answer.trim()) return decision.answer;
  const kinds = new Set(decision.answerMedia.map((item) => item.kind));
  if (kinds.has("image") && kinds.has("audio")) return "Image and audio reply";
  if (kinds.has("image")) return "Image reply";
  if (kinds.has("audio")) return "Audio reply";
  return "";
}

function asMedia(attachments: AnswerAttachment[] | undefined): AnswerMedia[] {
  const items = attachments ?? [];
  const images = items.filter((item) => item.kind === "image");
  const audios = items.filter((item) => item.kind === "audio");
  if (
    items.length > 2 ||
    images.length > 1 ||
    audios.length > 1 ||
    images.length + audios.length !== items.length
  )
    throw new AppError("Attach at most one image and one audio file.");
  return items.map((item) => ({
    id: item.id,
    kind: item.kind,
    url: "",
    thumbnailUrl: "",
    filename: item.filename,
    contentType: item.contentType,
    alt: item.alt,
    durationSeconds: item.kind === "audio" ? item.durationSeconds : null,
  }));
}

export function applyMutation(decision: Decision, mutation: Mutation, now = new Date()): Decision {
  if (decision.status === "Routed")
    throw new AppError("This answer has been picked up by your assistant and is locked.", 409);
  if (mutation.expectedRevision !== decision.revision)
    throw new AppError("This decision changed. We refreshed it; please try again.", 409);
  const revision = crypto.randomUUID();
  const updatedAt = new Date(
    Math.max(now.getTime(), Date.parse(decision.updatedAt) + 1),
  ).toISOString();
  if (mutation.action === "route") {
    if (decision.status !== "Answered")
      throw new AppError("Only an answered decision can be routed.", 409);
    return { ...decision, status: "Routed", revision, updatedAt };
  }
  if (mutation.action === "reopen") {
    if (decision.status !== "Answered")
      throw new AppError("Only an answered decision can be reopened.", 409);
    return {
      ...decision,
      status: "Open",
      answer: "",
      customAnswer: "",
      answerMedia: [],
      answeredAt: null,
      revision,
      updatedAt,
    };
  }
  const answerMedia = asMedia(mutation.attachments);
  if (!mutation.answer && answerMedia.length === 0)
    throw new AppError(
      mutation.custom ? "Enter an answer or attach an image or audio file." : "Choose an option.",
    );
  if (!mutation.custom && !decision.options.includes(mutation.answer))
    throw new AppError("That option does not belong to this question.");
  return {
    ...decision,
    status: "Answered",
    answer: mutation.answer,
    customAnswer: mutation.custom ? mutation.answer : "",
    answerMedia,
    answeredAt: new Date(
      Math.max(now.getTime(), decision.answeredAt ? Date.parse(decision.answeredAt) + 1 : 0),
    ).toISOString(),
    revision,
    updatedAt,
  };
}

export function sortOpen(decisions: Decision[]): Decision[] {
  return [...decisions].sort((a, b) => {
    const deadlineA = a.deadline ? Date.parse(a.deadline) : Infinity;
    const deadlineB = b.deadline ? Date.parse(b.deadline) : Infinity;
    return (
      (deadlineA === deadlineB ? 0 : deadlineA - deadlineB) ||
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      a.id.localeCompare(b.id)
    );
  });
}

export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function parseStatus(value: string | null): Status | undefined {
  if (value === null) return undefined;
  if (!STATUSES.includes(value as Status)) throw new AppError("Choose Open, Answered, or Routed.");
  return value as Status;
}

export function validateDecisionId(id: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))
    throw new AppError("This decision could not be found.", 404);
  return id;
}
