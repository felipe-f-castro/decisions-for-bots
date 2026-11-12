import { AppError } from "./domain";

export function requestOrigin(headers: Headers, fallback: string) {
  const host = (headers.get("x-forwarded-host") || headers.get("host"))?.split(",")[0].trim();
  const protocol = (headers.get("x-forwarded-proto") || new URL(fallback).protocol.replace(":", ""))
    .split(",")[0]
    .trim();
  const url = new URL(host ? `${protocol}://${host}` : fallback);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new AppError("Could not determine this workspace's URL.");
  return url.origin;
}
