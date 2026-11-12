import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertSetupTokenAttemptAllowed,
  LOGIN_ATTEMPT_LIMIT,
  reserveAttempt,
  resetAuthThrottles,
  SETUP_TOKEN_AGGREGATE_LIMIT,
  SETUP_TOKEN_LIMIT,
} from "@/lib/throttle";

const headers = vi.hoisted(() => ({ current: new Headers() }));

vi.mock("next/headers", () => ({
  headers: async () => headers.current,
}));

beforeEach(() => {
  resetAuthThrottles();
  headers.current = new Headers();
});
afterEach(() => vi.unstubAllEnvs());

describe("attempt limiter", () => {
  it("caps concurrent reservations at the limit", async () => {
    let entered = 0;
    const results = await Promise.all(
      Array.from({ length: 12 }, async () => {
        const gate = reserveAttempt("login:email:owner@example.com", LOGIN_ATTEMPT_LIMIT, 60_000);
        if (!gate.ok) return "limited";
        entered += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return "sent";
      }),
    );
    expect(entered).toBe(LOGIN_ATTEMPT_LIMIT);
    expect(results.filter((result) => result === "limited")).toHaveLength(12 - LOGIN_ATTEMPT_LIMIT);
  });

  it("ignores forwarded addresses outside the Sites runtime", async () => {
    headers.current = new Headers({
      "cf-connecting-ip": "203.0.113.8",
      "x-real-ip": "203.0.113.9",
      "x-forwarded-for": "203.0.113.10",
      "x-appwrite-client-ip": "203.0.113.11",
    });
    for (let attempt = 0; attempt < SETUP_TOKEN_LIMIT; attempt++)
      await assertSetupTokenAttemptAllowed();
    await expect(assertSetupTokenAttemptAllowed()).rejects.toMatchObject({ status: 429 });
    headers.current = new Headers({ "x-forwarded-for": "198.51.100.20" });
    await expect(assertSetupTokenAttemptAllowed()).rejects.toMatchObject({ status: 429 });
  });

  it("counts setup-token failures per Sites client address and across addresses", async () => {
    vi.stubEnv("APPWRITE_SITE_API_ENDPOINT", "https://example.invalid/v1");
    vi.stubEnv("APPWRITE_SITE_PROJECT_ID", "fixture-project");
    headers.current = new Headers({
      "cf-connecting-ip": "198.51.100.8",
      "x-forwarded-for": "198.51.100.9",
      "x-appwrite-client-ip": "203.0.113.10",
    });
    for (let attempt = 0; attempt < SETUP_TOKEN_LIMIT; attempt++)
      await assertSetupTokenAttemptAllowed();
    await expect(assertSetupTokenAttemptAllowed()).rejects.toMatchObject({ status: 429 });

    headers.current = new Headers({ "x-appwrite-client-ip": "203.0.113.11" });
    await assertSetupTokenAttemptAllowed();

    resetAuthThrottles();
    for (let address = 1; address <= SETUP_TOKEN_AGGREGATE_LIMIT / SETUP_TOKEN_LIMIT; address++) {
      headers.current = new Headers({ "x-appwrite-client-ip": `203.0.113.${address}` });
      for (let attempt = 0; attempt < SETUP_TOKEN_LIMIT; attempt++)
        await assertSetupTokenAttemptAllowed();
    }
    headers.current = new Headers({ "x-appwrite-client-ip": "203.0.113.40" });
    await expect(assertSetupTokenAttemptAllowed()).rejects.toMatchObject({ status: 429 });
  });

  it("releases a cancelled reservation", () => {
    const gate = reserveAttempt("account:owner@example.com", 1, 60_000);
    expect(gate.ok).toBe(true);
    if (gate.ok) gate.cancel();
    expect(reserveAttempt("account:owner@example.com", 1, 60_000).ok).toBe(true);
  });
});
