import { vi } from "vitest";

export function demoEnv() {
  for (const name of [
    "NEXT_PUBLIC_APPWRITE_ENDPOINT",
    "NEXT_PUBLIC_APPWRITE_PROJECT_ID",
    "APPWRITE_API_KEY",
    "APPWRITE_SITE_API_ENDPOINT",
    "APPWRITE_SITE_PROJECT_ID",
    "AGENT_API_KEY",
    "DECISION_WEBHOOK_URL",
    "DECISION_WEBHOOK_SECRET",
    "SETUP_TOKEN",
    "AGENT_API_KEY_FALLBACK",
    "DECISIONS_DEMO",
  ])
    vi.stubEnv(name, "");
  vi.stubEnv("DECISIONS_DEMO", "1");
}

export function appwriteEnv() {
  demoEnv();
  vi.stubEnv("NEXT_PUBLIC_APPWRITE_ENDPOINT", "https://nyc.cloud.appwrite.io/v1");
  vi.stubEnv("NEXT_PUBLIC_APPWRITE_PROJECT_ID", "decisions");
  vi.stubEnv("APPWRITE_API_KEY", "fixture-server-key");
}

export function user(overrides: { $id?: string; email?: string } = {}) {
  return {
    $id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.com",
    ...overrides,
  };
}

export const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aUn8AAAAASUVORK5CYII=",
  "base64",
);
