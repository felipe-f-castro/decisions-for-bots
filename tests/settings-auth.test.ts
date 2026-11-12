import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateSettings } from "@/app/actions";
import { resetAuthThrottles } from "@/lib/throttle";
import { appwriteEnv, user } from "./fixtures";

const { settings, access } = vi.hoisted(() => ({
  settings: {
    getSettings: vi.fn(),
    updateWorkspaceSettings: vi.fn(),
    isEmailAllowed: vi.fn(),
  },
  access: { getAccess: vi.fn() },
}));

vi.mock("@/lib/appwrite/settings", async (original) => ({
  ...(await original<typeof import("@/lib/appwrite/settings")>()),
  getSettings: (...args: unknown[]) => settings.getSettings(...args),
  updateWorkspaceSettings: (...args: unknown[]) => settings.updateWorkspaceSettings(...args),
  isEmailAllowed: (...args: unknown[]) => settings.isEmailAllowed(...args),
}));
vi.mock("@/lib/auth", () => ({
  getAccess: (...args: unknown[]) => access.getAccess(...args),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

const owner = { kind: "allowed" as const, userId: user().$id, email: "owner@example.com" };
const member = { kind: "allowed" as const, userId: "member-user", email: "member@example.com" };
const stored = {
  setupComplete: true,
  ownerUserId: user().$id,
  ownerEmail: "owner@example.com",
  areas: ["Design"],
  webhookUrl: "https://hooks.example/old",
  webhookSecret: "stored-webhook-secret",
};

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  appwriteEnv();
  resetAuthThrottles();
  settings.getSettings.mockReset().mockResolvedValue(stored);
  settings.updateWorkspaceSettings.mockReset().mockResolvedValue(stored);
  access.getAccess.mockReset().mockResolvedValue(owner);
});
afterEach(() => vi.unstubAllEnvs());

describe("owner settings", () => {
  it("lets the owner save a public webhook and does not return the signing secret", async () => {
    const result = await updateSettings(
      null,
      form({ areas: "Design, Content", webhookUrl: "https://hooks.example/decisions" }),
    );
    expect(result).toEqual({ saved: true });
    expect(JSON.stringify(result)).not.toContain("stored-webhook-secret");
    expect(settings.updateWorkspaceSettings).toHaveBeenCalledWith(owner, {
      areas: ["Design", "Content"],
      webhookUrl: "https://hooks.example/decisions",
    });
  });

  it("refuses integration changes from another allowlisted member", async () => {
    access.getAccess.mockResolvedValue(member);
    const result = await updateSettings(
      null,
      form({ areas: "Design", webhookUrl: "https://member.example/capture" }),
    );
    expect(result).toEqual({ error: "Only the workspace owner can change these settings." });
    expect(settings.updateWorkspaceSettings).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("stored-webhook-secret");
  });

  it("rejects a private webhook URL before saving", async () => {
    const result = await updateSettings(
      null,
      form({ areas: "Design", webhookUrl: "https://127.0.0.1/hook" }),
    );
    expect(result?.error).toMatch(/public internet/);
    expect(settings.updateWorkspaceSettings).not.toHaveBeenCalled();
  });
});
