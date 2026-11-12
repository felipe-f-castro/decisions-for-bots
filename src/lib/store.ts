import "server-only";
import { getConfig } from "./config";
import { MockStore } from "./stores/mock";
import { AppwriteStore } from "./stores/appwrite";
import type { DecisionStore } from "./stores/types";

const globalStores = globalThis as typeof globalThis & { decisionsDemoStore?: DecisionStore };

export function getStore(): DecisionStore {
  if (getConfig().mock) {
    globalStores.decisionsDemoStore ??= new MockStore();
    return globalStores.decisionsDemoStore;
  }
  return new AppwriteStore();
}

// Only call after authorizeAgent. The Appwrite store always uses the server key.
export function getAgentStore(): DecisionStore {
  return getStore();
}
