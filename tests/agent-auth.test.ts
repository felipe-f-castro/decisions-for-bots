import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hashToken } from "@/lib/crypto";
import { appwriteEnv, demoEnv } from "./fixtures";

const { settings } = vi.hoisted(() => ({
  settings: { getSettings: vi.fn() },
}));

vi.mock("@/lib/appwrite/settings", () => ({
  getSettings: (...args: unknown[]) => settings.getSettings(...args),
  getDecisionAreas: async () => ["Design", "Content", "Other"],
}));

import { authorizeAgent } from "@/lib/http";

const stored = "stored-agent-token-not-a-credential";
const fallback = "env-agent-token-not-a-credential";

function request(token: string) {
  return new NextRequest("http://localhost:3000/api/agent/decisions", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  demoEnv();
  settings.getSettings.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("authorizeAgent", () => {
  it("accepts the hashed key from settings and falls back to AGENT_API_KEY", async () => {
    appwriteEnv();
    settings.getSettings.mockResolvedValue({
      setupComplete: true,
      agentApiKeyHash: hashToken(stored),
    });
    await expect(authorizeAgent(request(stored))).resolves.toBeUndefined();
    await expect(authorizeAgent(request("wrong-token"))).rejects.toMatchObject({ status: 401 });
    vi.stubEnv("AGENT_API_KEY", fallback);
    await expect(authorizeAgent(request(fallback))).resolves.toBeUndefined();
  });

  it("uses the environment key in demo mode", async () => {
    vi.stubEnv("AGENT_API_KEY", fallback);
    await expect(authorizeAgent(request(fallback))).resolves.toBeUndefined();
    expect(settings.getSettings).not.toHaveBeenCalled();
    await expect(authorizeAgent(request(""))).rejects.toMatchObject({ status: 401 });
  });
});
