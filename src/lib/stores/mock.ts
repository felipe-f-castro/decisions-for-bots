import { randomUUID } from "node:crypto";
import {
  AppError,
  applyMutation,
  type Decision,
  type Mutation,
  type NewDecision,
  type Status,
} from "../domain";
import { seedDecisions } from "../seed";
import type { DecisionStore } from "./types";
import { validateImage, type ImageUpload } from "../images";
import { attachmentFromUpload, validateAnswerUploads, type AnswerUpload } from "../media";

export class MockStore implements DecisionStore {
  private decisions: Map<string, Decision>;
  private images = new Map<string, ImageUpload>();
  private answerFiles = new Map<string, AnswerUpload>();
  constructor(seed = seedDecisions()) {
    this.decisions = new Map(seed.map((decision) => [decision.id, structuredClone(decision)]));
  }
  async list(status?: Status) {
    return structuredClone(
      [...this.decisions.values()].filter((decision) => !status || decision.status === status),
    );
  }
  async get(id: string) {
    const decision = this.decisions.get(id);
    if (!decision) throw new AppError("This decision could not be found.", 404);
    return structuredClone(decision);
  }
  async create(input: NewDecision, uploads: ImageUpload[] = []) {
    if (input.imageUrls.length + uploads.length > 10)
      throw new AppError("Add up to 10 images in total.");
    const now = new Date().toISOString();
    const { imageUrls, ...fields } = structuredClone(input);
    const cleanUploads = uploads.map(validateImage);
    const decision: Decision = {
      ...fields,
      images: [
        ...imageUrls.map((url) => ({
          id: randomUUID(),
          url,
          thumbnailUrl: url,
          filename: "Decision image",
        })),
        ...cleanUploads.map((image) => {
          const imageId = randomUUID();
          this.images.set(imageId, structuredClone(image));
          const url = `/api/demo/images/${imageId}`;
          return { id: imageId, url, thumbnailUrl: url, filename: image.filename };
        }),
      ],
      id: randomUUID(),
      status: "Open",
      answer: "",
      customAnswer: "",
      answerMedia: [],
      answeredAt: null,
      createdAt: now,
      updatedAt: now,
      revision: randomUUID(),
    };
    this.decisions.set(decision.id, decision);
    return structuredClone(decision);
  }
  getImage(id: string): ImageUpload | undefined {
    const image = this.images.get(id);
    return image ? structuredClone(image) : undefined;
  }
  async mutate(id: string, mutation: Mutation, uploads: AnswerUpload[] = []) {
    if (mutation.action !== "answer" && uploads.length)
      throw new AppError("Only an answer can include an image or audio file.");
    const validated = mutation.action === "answer" ? validateAnswerUploads(uploads) : [];
    // No await between the read and write: atomic within this demo process.
    const current = this.decisions.get(id);
    if (!current) throw new AppError("This decision could not be found.", 404);
    const created: string[] = [];
    const attachments = validated.map((upload) => {
      const fileId = randomUUID();
      this.answerFiles.set(fileId, structuredClone(upload));
      created.push(fileId);
      return attachmentFromUpload(fileId, upload);
    });
    try {
      const updated = applyMutation(
        current,
        mutation.action === "answer" ? { ...mutation, attachments } : mutation,
      );
      updated.answerMedia = updated.answerMedia.map((item) => {
        const url = `/api/decisions/${updated.id}/media/${item.id}`;
        return { ...item, url, thumbnailUrl: item.kind === "image" ? url : "" };
      });
      const keep = new Set(updated.answerMedia.map((item) => item.id));
      for (const previous of current.answerMedia) {
        if (!keep.has(previous.id)) this.answerFiles.delete(previous.id);
      }
      this.decisions.set(id, updated);
      return structuredClone(updated);
    } catch (error) {
      for (const fileId of created) this.answerFiles.delete(fileId);
      throw error;
    }
  }
  async readAnswerMedia(id: string, fileId: string) {
    const decision = this.decisions.get(id);
    if (!decision) throw new AppError("This decision could not be found.", 404);
    if (!decision.answerMedia.some((item) => item.id === fileId)) return null;
    const file = this.answerFiles.get(fileId);
    if (!file) return null;
    return {
      bytes: new Uint8Array(file.bytes),
      contentType: file.contentType,
      filename: file.filename,
    };
  }
  async remove(id: string) {
    const decision = this.decisions.get(id);
    if (!decision) throw new AppError("This decision could not be found.", 404);
    for (const image of decision.images) this.images.delete(image.id);
    for (const media of decision.answerMedia) this.answerFiles.delete(media.id);
    this.decisions.delete(id);
  }
}
