import "server-only";
import { cookies } from "next/headers";
import { Client, Account } from "node-appwrite";
import { getConfig } from "../config";
import { createAdminClient } from "./admin";
import { SESSION_COOKIE } from "./ids";

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export async function readSessionSecret() {
  return (await cookies()).get(SESSION_COOKIE)?.value || "";
}

export async function writeSessionCookie(secret: string, maxAge = 60 * 60 * 24 * 30) {
  (await cookies()).set(SESSION_COOKIE, secret, { ...sessionCookieOptions, maxAge });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function createSessionAccount() {
  const secret = await readSessionSecret();
  if (!secret) return null;
  const config = getConfig();
  const client = new Client()
    .setEndpoint(config.endpoint)
    .setProject(config.projectId)
    .setSession(secret);
  return new Account(client);
}

/**
 * Account client with a server API key so `session.secret` is included.
 * Appwrite only returns the secret when the request uses an API key; without
 * it the cookie would be empty and sign-in would bounce back to /login.
 */
export async function createProjectAccount() {
  return new Account(await createAdminClient());
}
