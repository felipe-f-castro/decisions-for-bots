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

export class MockStore implements DecisionStore {
  private decisions: Map<string, Decision>;
  private images = new Map<string, ImageUpload>();
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
  async mutate(id: string, mutation: Mutation) {
    // No await between the read and write: atomic within this demo process.
    const current = this.decisions.get(id);
    if (!current) throw new AppError("This decision could not be found.", 404);
    const updated = applyMutation(current, mutation);
    this.decisions.set(id, updated);
    return structuredClone(updated);
  }
}
