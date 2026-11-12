import type { Decision, Mutation, NewDecision, Status } from "../domain";
import type { ImageUpload } from "../images";
import type { AnswerUpload } from "../media";

export interface StoredMedia {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}

export interface DecisionStore {
  list(status?: Status): Promise<Decision[]>;
  get(id: string): Promise<Decision>;
  create(input: NewDecision, uploads?: ImageUpload[]): Promise<Decision>;
  mutate(id: string, mutation: Mutation, uploads?: AnswerUpload[]): Promise<Decision>;
  readAnswerMedia(id: string, fileId: string): Promise<StoredMedia | null>;
  remove(id: string): Promise<void>;
}
