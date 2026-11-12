import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkToken, checkTokenDigest, getAccess } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { hashToken } from "@/lib/crypto";
import { demoEnv, appwriteEnv, user } from "./fixtures";

const { session, settings } = vi.hoisted(() => ({
  session: { createSessionAccount: vi.fn() },
  settings: {
    getSettings: vi.fn(),
    isEmailAllowed: vi.fn(),
  },
}));

vi.mock("@/lib/appwrite/session", () => ({
  createSessionAccount: (...args: unknown[]) => session.createSessionAccount(...args),
}));
vi.mock("@/lib/appwrite/settings", () => ({
  getSettings: (...args: unknown[]) => settings.getSettings(...args),
  isEmailAllowed: (...args: unknown[]) => settings.isEmailAllowed(...args),
  getDecisionAreas: async () => ["Design", "Content", "Other"],
}));

beforeEach(() => {
  demoEnv();
  session.createSessionAccount.mockReset();
  settings.getSettings.mockReset();
  settings.isEmailAllowed.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("Appwrite configuration", () => {
  it("enters demo mode only with an explicit opt-in when Appwrite is unset", async () => {
    expect(getConfig().mock).toBe(true);
    expect(await getAccess()).toEqual({ kind: "demo" });
    expect(session.createSessionAccount).not.toHaveBeenCalled();
    vi.stubEnv("DECISIONS_DEMO", "");
    expect(() => getConfig()).toThrow("Complete the Appwrite configuration");
    vi.stubEnv("DECISIONS_DEMO", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getConfig()).toThrow("Complete the Appwrite configuration");
  });

  it("does not treat a partial Appwrite configuration as demo mode", () => {
    vi.stubEnv("APPWRITE_API_KEY", "fixture");
    expect(() => getConfig()).toThrow("Complete the Appwrite configuration");
  });

  it.each(["NEXT_PUBLIC_APPWRITE_ENDPOINT", "NEXT_PUBLIC_APPWRITE_PROJECT_ID"])(
    "fails closed if %s is missing when the other is set",
    (name) => {
      appwriteEnv();
      vi.stubEnv(name, "");
      expect(() => getConfig()).toThrow("Complete the Appwrite configuration");
    },
  );

  it("accepts a project endpoint over HTTPS and rejects remote HTTP", () => {
    appwriteEnv();
    expect(getConfig()).toMatchObject({
      mock: false,
      endpoint: "https://nyc.cloud.appwrite.io/v1",
      projectId: "decisions",
    });
    vi.stubEnv("NEXT_PUBLIC_APPWRITE_ENDPOINT", "http://remote.example.com/v1");
    expect(() => getConfig()).toThrow("HTTPS");
  });
});

describe("human authentication", () => {
  beforeEach(() => {
    appwriteEnv();
    settings.getSettings.mockResolvedValue({ setupComplete: true });
    settings.isEmailAllowed.mockResolvedValue(true);
  });

  it("compares tokens in constant time and checks a SHA-256 digest", () => {
    expect(checkToken("right", "right")).toBe(true);
    expect(checkToken("wrong", "right")).toBe(false);
    const digest = hashToken("agent-token");
    expect(checkTokenDigest("agent-token", digest)).toBe(true);
    expect(checkTokenDigest("other-token", digest)).toBe(false);
    expect(checkTokenDigest("agent-token", "not-a-hex-digest")).toBe(false);
  });

  it("treats a settings outage as unavailable instead of a fresh install", async () => {
    session.createSessionAccount.mockResolvedValue(null);
    settings.getSettings.mockRejectedValue(new Error("database unavailable"));
    await expect(getAccess()).rejects.toThrow("database unavailable");
  });

  it("sends visitors to setup until an owner exists", async () => {
    session.createSessionAccount.mockResolvedValue(null);
    settings.getSettings.mockResolvedValue(null);
    expect(await getAccess()).toEqual({ kind: "needs-setup" });
    settings.getSettings.mockResolvedValue({ setupComplete: false });
    expect(await getAccess()).toEqual({ kind: "needs-setup" });
    settings.getSettings.mockResolvedValue({ setupComplete: true });
    expect(await getAccess()).toEqual({ kind: "signed-out" });
  });

  it("allows a session only when setup is complete and the email is allowlisted", async () => {
    const account = { get: vi.fn().mockResolvedValue(user()) };
    session.createSessionAccount.mockResolvedValue(account);
    expect(await getAccess()).toEqual({
      kind: "allowed",
      userId: user().$id,
      email: "owner@example.com",
    });
    settings.isEmailAllowed.mockResolvedValue(false);
    expect(await getAccess()).toEqual({ kind: "denied" });
  });

  it("treats a missing or invalid session as signed out", async () => {
    session.createSessionAccount.mockResolvedValue(null);
    expect(await getAccess()).toEqual({ kind: "signed-out" });
    session.createSessionAccount.mockResolvedValue({
      get: vi.fn().mockRejectedValue(new Error("invalid session")),
    });
    expect(await getAccess()).toEqual({ kind: "signed-out" });
  });

  it("denies a session with no email", async () => {
    session.createSessionAccount.mockResolvedValue({
      get: vi.fn().mockResolvedValue(user({ email: "" })),
    });
    expect(await getAccess()).toEqual({ kind: "denied" });
    expect(settings.isEmailAllowed).not.toHaveBeenCalled();
  });
});
