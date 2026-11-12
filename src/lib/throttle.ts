import "server-only";
import { AppError } from "./domain";

/**
 * Process-local attempt limiter. It runs before admin-key session and account
 * calls so those calls stay bounded even when the upstream rate limit does not
 * apply. Check and record happen synchronously, before the first await.
 */
type Hit = { at: number };
type Reservation = { ok: true; cancel: () => void } | { ok: false };

const buckets = new Map<string, Hit[]>();

export const LOGIN_ATTEMPT_LIMIT = 5;
export const LOGIN_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
export const LOGIN_IP_LIMIT = 30;
export const ACCOUNT_CREATE_LIMIT = 3;
export const ACCOUNT_CREATE_WINDOW_MS = 60 * 60 * 1000;
export const ACCOUNT_CREATE_IP_LIMIT = 8;
export const SETUP_TOKEN_LIMIT = 5;
export const SETUP_TOKEN_WINDOW_MS = 15 * 60 * 1000;

const WAIT = "Too many sign-in attempts. Wait a few minutes and try again.";

export function resetAuthThrottles() {
  buckets.clear();
}

export function reserveAttempt(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Reservation {
  const hits = (buckets.get(key) ?? []).filter((hit) => now - hit.at < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { ok: false };
  }
  const hit = { at: now };
  hits.push(hit);
  buckets.set(key, hits);
  return {
    ok: true,
    cancel() {
      const current = buckets.get(key);
      if (!current) return;
      const index = current.indexOf(hit);
      if (index >= 0) current.splice(index, 1);
      if (!current.length) buckets.delete(key);
    },
  };
}

export async function clientAddress() {
  try {
    const { headers } = await import("next/headers");
    const list = await headers();
    for (const name of ["cf-connecting-ip", "x-real-ip"]) {
      const value = list.get(name)?.split(",")[0]?.trim();
      if (value) return value.slice(0, 80);
    }
    const forwarded = list.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded.slice(0, 80);
  } catch {
    /* Outside a request, attempts share one bucket. */
  }
  return "unknown";
}

function reservePair(
  emailKey: string,
  ipKey: string,
  emailLimit: number,
  ipLimit: number,
  windowMs: number,
) {
  const byEmail = reserveAttempt(emailKey, emailLimit, windowMs);
  if (!byEmail.ok) return { ok: false as const };
  const byIp = reserveAttempt(ipKey, ipLimit, windowMs);
  if (!byIp.ok) {
    byEmail.cancel();
    return { ok: false as const };
  }
  return {
    ok: true as const,
    cancel() {
      byEmail.cancel();
      byIp.cancel();
    },
  };
}

export async function assertLoginAllowed(email: string) {
  const ip = await clientAddress();
  const gate = reservePair(
    `login:email:${email}`,
    `login:ip:${ip}`,
    LOGIN_ATTEMPT_LIMIT,
    LOGIN_IP_LIMIT,
    LOGIN_ATTEMPT_WINDOW_MS,
  );
  if (!gate.ok) throw new AppError(WAIT, 429);
  return gate;
}

export async function assertAccountCreationAllowed(email: string) {
  const ip = await clientAddress();
  const gate = reservePair(
    `account:${email}`,
    `account-ip:${ip}`,
    ACCOUNT_CREATE_LIMIT,
    ACCOUNT_CREATE_IP_LIMIT,
    ACCOUNT_CREATE_WINDOW_MS,
  );
  if (!gate.ok)
    throw new AppError("Too many account creation attempts. Wait a while and try again.", 429);
}

export async function assertSetupTokenAttemptAllowed() {
  const ip = await clientAddress();
  const gate = reserveAttempt(`setup-token:${ip}`, SETUP_TOKEN_LIMIT, SETUP_TOKEN_WINDOW_MS);
  if (!gate.ok)
    throw new AppError("Too many setup attempts. Wait a few minutes and try again.", 429);
  return gate;
}
