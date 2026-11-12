import "server-only";
import { AppError } from "./domain";

function trim(value: string | undefined) {
  return value?.trim() || "";
}

export function getConfig() {
  const endpoint =
    trim(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT) ||
    trim(process.env.APPWRITE_SITE_API_ENDPOINT);
  const projectId =
    trim(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID) ||
    trim(process.env.APPWRITE_SITE_PROJECT_ID);
  const apiKey = trim(process.env.APPWRITE_API_KEY);
  const mock = !endpoint && !projectId && !apiKey;
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
