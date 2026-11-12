import { beforeEach, describe, expect, it } from "vitest";
import { LOGIN_ATTEMPT_LIMIT, reserveAttempt, resetAuthThrottles } from "@/lib/throttle";

beforeEach(() => resetAuthThrottles());

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

  it("releases a cancelled reservation", () => {
    const gate = reserveAttempt("account:owner@example.com", 1, 60_000);
    expect(gate.ok).toBe(true);
    if (gate.ok) gate.cancel();
    expect(reserveAttempt("account:owner@example.com", 1, 60_000).ok).toBe(true);
  });
});
