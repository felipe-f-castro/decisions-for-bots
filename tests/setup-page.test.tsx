import { beforeEach, describe, expect, it, vi } from "vitest";
import { appwriteEnv } from "./fixtures";

const { session, settings } = vi.hoisted(() => ({
  session: { createSessionAccount: vi.fn() },
  settings: { getSettings: vi.fn(), isEmailAllowed: vi.fn() },
}));

vi.mock("@/lib/appwrite/session", () => ({
  createSessionAccount: (...args: unknown[]) => session.createSessionAccount(...args),
}));
vi.mock("@/lib/appwrite/settings", () => ({
  getSettings: (...args: unknown[]) => settings.getSettings(...args),
  isEmailAllowed: (...args: unknown[]) => settings.isEmailAllowed(...args),
  getDecisionAreas: async () => ["Design", "Content", "Other"],
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  unstable_rethrow(error: unknown) {
    if (error instanceof Error && error.message.startsWith("redirect:")) throw error;
  },
}));

import SetupPage from "@/app/setup/page";

beforeEach(() => {
  appwriteEnv();
  session.createSessionAccount.mockReset().mockResolvedValue(null);
  settings.getSettings.mockReset();
  settings.isEmailAllowed.mockReset().mockResolvedValue(true);
});

describe("setup page", () => {
  it("does not show the first-run form after setup is complete", async () => {
    settings.getSettings.mockResolvedValue({
      setupComplete: true,
      ownerEmail: "owner@example.com",
    });
    await expect(SetupPage()).rejects.toThrow("redirect:/login");
  });

  it("shows the form only while setup is still required", async () => {
    settings.getSettings.mockResolvedValue(null);
    const page = await SetupPage();
    expect(page).toBeTruthy();
  });

  it("rethrows a redirect raised while checking access", async () => {
    settings.getSettings.mockRejectedValue(new Error("redirect:/"));
    await expect(SetupPage()).rejects.toThrow("redirect:/");
  });
});
