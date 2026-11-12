import "server-only";
import { getConfig } from "./config";
import { checkToken, checkTokenDigest } from "./crypto";
import { isAppError } from "./domain";
import { createSessionAccount } from "./appwrite/session";
import { getSettings, isEmailAllowed } from "./appwrite/settings";

export { checkToken, checkTokenDigest };

export type Access =
  | { kind: "demo" | "signed-out" | "denied" | "needs-setup" }
  | { kind: "allowed"; userId: string; email: string };

export async function getAccess(): Promise<Access> {
  if (getConfig().mock) return { kind: "demo" };
  const account = await createSessionAccount();
  if (!account) {
    const settings = await getSettings();
    return settings?.setupComplete ? { kind: "signed-out" } : { kind: "needs-setup" };
  }
  try {
    const user = await account.get();
    const email = user.email?.toLowerCase() || "";
    if (!email) return { kind: "denied" };
    const settings = await getSettings();
    if (!settings?.setupComplete) return { kind: "needs-setup" };
    if (!(await isEmailAllowed(email))) return { kind: "denied" };
    return { kind: "allowed", userId: user.$id, email };
  } catch (error) {
    if (isAppError(error)) throw error;
    return { kind: "signed-out" };
  }
}
