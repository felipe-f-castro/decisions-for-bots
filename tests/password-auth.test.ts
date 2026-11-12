import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPassword, signInWithPassword, signOut } from "@/app/actions";
import { demoEnv, appwriteEnv, user } from "./fixtures";

const { account, session, allow } = vi.hoisted(() => ({
  account: {
    createEmailPasswordSession: vi.fn(),
    updatePassword: vi.fn(),
    deleteSession: vi.fn(),
    get: vi.fn(),
  },
  session: {
    createProjectAccount: vi.fn(),
    createSessionAccount: vi.fn(),
    writeSessionCookie: vi.fn(),
    clearSessionCookie: vi.fn(),
  },
  allow: { isEmailAllowed: vi.fn() },
}));

vi.mock("@/lib/appwrite/session", () => ({
  createProjectAccount: () => session.createProjectAccount(),
  createSessionAccount: (...args: unknown[]) => session.createSessionAccount(...args),
  writeSessionCookie: (...args: unknown[]) => session.writeSessionCookie(...args),
  clearSessionCookie: (...args: unknown[]) => session.clearSessionCookie(...args),
}));
vi.mock("@/lib/appwrite/settings", () => ({
  isEmailAllowed: (...args: unknown[]) => allow.isEmailAllowed(...args),
  getSettings: async () => ({ setupComplete: true }),
  updateWorkspaceSettings: vi.fn(),
}));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  getAccess: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

import { getAccess } from "@/lib/auth";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const BAD = { error: "Email or password is incorrect." };

beforeEach(() => {
  appwriteEnv();
  session.createProjectAccount.mockReturnValue(account);
  session.createSessionAccount.mockResolvedValue(account);
  session.writeSessionCookie.mockResolvedValue(undefined);
  session.clearSessionCookie.mockResolvedValue(undefined);
  account.createEmailPasswordSession.mockReset().mockResolvedValue({ secret: "fixture-session" });
  account.updatePassword.mockReset().mockResolvedValue({});
  account.deleteSession.mockReset().mockResolvedValue({});
  account.get.mockReset().mockResolvedValue(user());
  allow.isEmailAllowed.mockReset().mockResolvedValue(true);
  vi.mocked(getAccess).mockReset().mockResolvedValue({
    kind: "allowed",
    userId: user().$id,
    email: "owner@example.com",
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("password sign-in", () => {
  it("signs in an allowed account and stores the session cookie", async () => {
    await expect(
      signInWithPassword(null, form({ email: " Owner@Example.com ", password: "correct horse" })),
    ).rejects.toThrow("redirect:/");
    expect(allow.isEmailAllowed).toHaveBeenCalledWith("owner@example.com");
    expect(account.createEmailPasswordSession).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "correct horse",
    });
    expect(session.writeSessionCookie).toHaveBeenCalledWith("fixture-session");
  });

  it("does not sign in when Appwrite omits the session secret", async () => {
    account.createEmailPasswordSession.mockResolvedValue({ secret: "" });
    expect(
      await signInWithPassword(null, form({ email: "owner@example.com", password: "correct horse" })),
    ).toEqual({ error: "Sign-in is temporarily unavailable. Please try again shortly." });
    expect(session.writeSessionCookie).not.toHaveBeenCalled();
  });

  it("returns one generic error for a wrong password or an unlisted email", async () => {
    account.createEmailPasswordSession.mockRejectedValue(new Error("Invalid credentials"));
    expect(
      await signInWithPassword(null, form({ email: "owner@example.com", password: "wrong" })),
    ).toEqual(BAD);
    expect(account.createEmailPasswordSession).toHaveBeenCalledOnce();
    allow.isEmailAllowed.mockResolvedValue(false);
    expect(
      await signInWithPassword(null, form({ email: "stranger@example.com", password: "whatever" })),
    ).toEqual(BAD);
    expect(account.createEmailPasswordSession).toHaveBeenCalledOnce();
  });

  it("does not contact Appwrite Auth for an unlisted email", async () => {
    allow.isEmailAllowed.mockResolvedValue(false);
    expect(
      await signInWithPassword(null, form({ email: "stranger@example.com", password: "whatever" })),
    ).toEqual(BAD);
    expect(account.createEmailPasswordSession).not.toHaveBeenCalled();
  });

  it("validates input without contacting Appwrite", async () => {
    expect(await signInWithPassword(null, form({ email: "nope", password: "x" }))).toEqual({
      error: "Enter a valid email address.",
    });
    expect(
      await signInWithPassword(null, form({ email: "owner@example.com", password: "" })),
    ).toEqual({ error: "Enter your password." });
    expect(allow.isEmailAllowed).not.toHaveBeenCalled();
  });

  it("maps a rate-limit failure to a friendly wait message", async () => {
    account.createEmailPasswordSession.mockRejectedValue(new Error("Rate limit exceeded"));
    expect(
      await signInWithPassword(null, form({ email: "owner@example.com", password: "correct horse" })),
    ).toEqual({ error: "Too many sign-in attempts. Wait a few minutes and try again." });
  });
});

describe("set password", () => {
  it("requires the current password and matching copies of the new one", async () => {
    expect(await setPassword(null, form({ password: "new password", confirm: "new password" }))).toEqual({
      error: "Enter your current password.",
    });
    expect(
      await setPassword(
        null,
        form({ current: "old password", password: "short", confirm: "short" }),
      ),
    ).toEqual({ error: "Use at least 10 characters." });
    expect(
      await setPassword(
        null,
        form({ current: "old password", password: "new password", confirm: "other password" }),
      ),
    ).toEqual({ error: "The two passwords don’t match." });
    expect(account.updatePassword).not.toHaveBeenCalled();
  });

  it("updates the password for a signed-in owner", async () => {
    expect(
      await setPassword(
        null,
        form({ current: "old password", password: "new password", confirm: "new password" }),
      ),
    ).toEqual({ saved: true });
    expect(account.updatePassword).toHaveBeenCalledWith({
      password: "new password",
      oldPassword: "old password",
    });
  });

  it("skips passwords in demo mode", async () => {
    demoEnv();
    expect(
      await setPassword(
        null,
        form({ current: "old password", password: "new password", confirm: "new password" }),
      ),
    ).toEqual({ error: "Passwords aren’t used in demo mode." });
  });
});

describe("sign out", () => {
  it("clears the current Appwrite session and cookie", async () => {
    await expect(signOut()).rejects.toThrow("redirect:/login");
    expect(account.deleteSession).toHaveBeenCalledWith({ sessionId: "current" });
    expect(session.clearSessionCookie).toHaveBeenCalledOnce();
  });
});
