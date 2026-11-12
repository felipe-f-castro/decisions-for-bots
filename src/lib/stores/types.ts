import type { Decision, Mutation, NewDecision, Status } from "../domain";
import type { ImageUpload } from "../images";

export interface DecisionStore {
  list(status?: Status): Promise<Decision[]>;
  get(id: string): Promise<Decision>;
  create(input: NewDecision, uploads?: ImageUpload[]): Promise<Decision>;
  mutate(id: string, mutation: Mutation): Promise<Decision>;
}
