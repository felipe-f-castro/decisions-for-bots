import "server-only";
import { AppError } from "./domain";
import { envFlag, readEnv } from "./env";

export function getConfig() {
  const endpoint =
    readEnv("NEXT_PUBLIC_APPWRITE_ENDPOINT") || readEnv("APPWRITE_SITE_API_ENDPOINT");
  const projectId =
    readEnv("NEXT_PUBLIC_APPWRITE_PROJECT_ID") || readEnv("APPWRITE_SITE_PROJECT_ID");
  const apiKey = readEnv("APPWRITE_API_KEY");
  const configured = Boolean(endpoint || projectId || apiKey);
  // Demo is opt-in and never a production fallback. A production process with
  // no Appwrite configuration fails closed instead of serving the in-memory inbox.
  const mock = !configured && process.env.NODE_ENV !== "production" && envFlag("DECISIONS_DEMO");
  if (!configured && !mock)
    throw new AppError("Complete the Appwrite configuration. See README.md.", 503);
  if (!mock) {
    if (!endpoint || !projectId)
      throw new AppError("Complete the Appwrite configuration. See README.md.", 503);
    try {
      const parsed = new URL(endpoint);
      if (
        !["https:", "http:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.hash ||
        (parsed.protocol !== "https:" &&
          !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
      )
        throw new Error("Invalid URL");
    } catch {
      throw new AppError(
        "Use an HTTPS Appwrite endpoint (HTTP is allowed for local Appwrite).",
        503,
      );
    }
  }
  return { mock, endpoint, projectId, apiKey };
}
