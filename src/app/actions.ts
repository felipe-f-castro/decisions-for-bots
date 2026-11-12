"use server";

import { redirect } from "next/navigation";
import { getConfig } from "@/lib/config";
import { getAccess } from "@/lib/auth";
import { isEmailAllowed, updateWorkspaceSettings } from "@/lib/appwrite/settings";
import { completeSetup, setupIsLocked } from "@/lib/setup";
import {
  clearSessionCookie,
  createProjectAccount,
  createSessionAccount,
  writeSessionCookie,
} from "@/lib/appwrite/session";
import { isAppError, isWebUrl, parseAreas } from "@/lib/domain";
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, passwordBytes } from "@/lib/password";

export type LoginState = { error?: string; sent?: boolean } | null;
export type PasswordState = { error?: string; saved?: boolean } | null;
export type SetupState =
  | { error?: string }
  | { complete: true; agentApiKey: string; webhookSecret: string }
  | null;

const BAD_CREDENTIALS = "Email or password is incorrect.";

function readEmail(formData: FormData) {
  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();
  const valid = email.length <= 254 && /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email);
  return { email, valid };
}

/**
 * Email + password sign-in. There is no public sign-up: the owner is created
 * on the first-run /setup page, and only allowlisted addresses can sign in.
 * Every credential failure, including an email that is not allowlisted,
 * returns the same message.
 */
export async function signInWithPassword(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const config = getConfig();
  if (config.mock) redirect("/");
  const { email, valid } = readEmail(formData);
  const password = String(formData.get("password") || "");
  if (!valid) return { error: "Enter a valid email address." };
  if (!password) return { error: "Enter your password." };
  if (passwordBytes(password) > PASSWORD_MAX_BYTES) return { error: BAD_CREDENTIALS };
  try {
    if (!(await isEmailAllowed(email))) return { error: BAD_CREDENTIALS };
    const account = await createProjectAccount();
    const session = await account.createEmailPasswordSession({ email, password });
    if (!session.secret) {
      return { error: "Sign-in is temporarily unavailable. Please try again shortly." };
    }
    await writeSessionCookie(session.secret);
  } catch (error) {
    const message = String((error as { message?: string }).message || "");
    if (/rate limit|too many/i.test(message))
      return { error: "Too many sign-in attempts. Wait a few minutes and try again." };
    if (isAppError(error) && error.status >= 500)
      return { error: "Sign-in is temporarily unavailable. Please try again shortly." };
    return { error: BAD_CREDENTIALS };
  }
  redirect("/");
}

/** Sets or changes the signed-in person's password. */
export async function setPassword(
  _previous: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  if (getConfig().mock) return { error: "Passwords aren’t used in demo mode." };
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  const current = String(formData.get("current") || "");
  if (!current) return { error: "Enter your current password." };
  if (password.length < PASSWORD_MIN_LENGTH)
    return { error: `Use at least ${PASSWORD_MIN_LENGTH} characters.` };
  if (passwordBytes(password) > PASSWORD_MAX_BYTES)
    return { error: `Use at most ${PASSWORD_MAX_BYTES} characters.` };
  if (password !== confirm) return { error: "The two passwords don’t match." };
  let access;
  try {
    access = await getAccess();
  } catch {
    return { error: "We couldn’t check your session. Please try again shortly." };
  }
  if (access.kind !== "allowed") redirect("/login");
  try {
    const account = await createSessionAccount();
    if (!account) redirect("/login");
    await account.updatePassword({ password, oldPassword: current });
    return { saved: true };
  } catch {
    return { error: "We couldn’t save your password. Please try again." };
  }
}

export async function signOut() {
  if (!getConfig().mock) {
    try {
      const account = await createSessionAccount();
      if (account) await account.deleteSession({ sessionId: "current" });
    } catch {
      /* The cookie is cleared either way. */
    }
    await clearSessionCookie();
  }
  redirect("/login");
}

export async function runSetup(_previous: SetupState, formData: FormData): Promise<SetupState> {
  if (getConfig().mock) redirect("/");
  try {
    if (await setupIsLocked()) return { error: "This workspace already has an owner. Sign in instead." };
    const password = String(formData.get("password") || "");
    const confirm = String(formData.get("confirm") || "");
    if (password !== confirm) return { error: "The two passwords don’t match." };
    const result = await completeSetup({
      email: String(formData.get("email") || ""),
      password,
      areas: String(formData.get("areas") || ""),
      webhookUrl: String(formData.get("webhookUrl") || ""),
    });
    return { complete: true, agentApiKey: result.agentApiKey, webhookSecret: result.webhookSecret };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    return { error: "We couldn’t finish setup. Check your Appwrite configuration and try again." };
  }
}

// Unused by the Appwrite login form; kept so older imports fail clearly if revived.
export async function signIn(): Promise<LoginState> {
  return { error: "Email sign-in links are not used. Sign in with your password." };
}

export async function signInWithGoogle() {
  redirect("/login");
}


export type SettingsState = { error?: string; saved?: boolean } | null;

export async function updateSettings(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  if (getConfig().mock) return { error: "Settings are not used in demo mode." };
  let access;
  try {
    access = await getAccess();
  } catch {
    return { error: "We couldn’t check your session. Please try again shortly." };
  }
  if (access.kind !== "allowed") redirect("/login");
  try {
    const areas = parseAreas(String(formData.get("areas") || ""));
    const webhookUrl = String(formData.get("webhookUrl") || "").trim();
    if (webhookUrl && !isWebUrl(webhookUrl))
      return { error: "Use an HTTP or HTTPS webhook URL without credentials." };
    await updateWorkspaceSettings({ areas, webhookUrl });
    return { saved: true };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    return { error: "We couldn’t save settings. Please try again." };
  }
}
