import "server-only";
import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "./domain";
import { isPublicAddress } from "./images";

export const WEBHOOK_URL_ERROR =
  "Use an HTTPS webhook URL on the public internet, without credentials.";

export type ResolvedWebhook = {
  url: URL;
  address: string;
  family: 4 | 6;
};

function hostName(url: URL) {
  return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function blockedName(hostname: string) {
  const name = hostname.toLowerCase();
  if (!name || name === "localhost" || name.endsWith(".localhost")) return true;
  if (name.endsWith(".local") || name.endsWith(".localdomain") || name.endsWith(".internal"))
    return true;
  return name === "metadata.google.internal";
}

/** Syntactic gate. DNS and address checks happen in resolvePublicWebhook. */
export function webhookUrlError(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return WEBHOOK_URL_ERROR;
  }
  if (url.protocol !== "https:" || url.username || url.password) return WEBHOOK_URL_ERROR;
  const host = hostName(url);
  if (blockedName(host)) return WEBHOOK_URL_ERROR;
  if (isIP(host) && !isPublicAddress(host)) return WEBHOOK_URL_ERROR;
  return null;
}

export async function resolvePublicWebhook(
  value: string,
  resolver: typeof lookup = lookup,
): Promise<ResolvedWebhook> {
  if (webhookUrlError(value)) throw new AppError(WEBHOOK_URL_ERROR);
  const url = new URL(value);
  const host = hostName(url);
  let addresses: LookupAddress[];
  if (isIP(host)) addresses = [{ address: host, family: isIP(host) as 4 | 6 }];
  else {
    try {
      addresses = await resolver(host, { all: true, verbatim: true });
    } catch {
      throw new AppError(WEBHOOK_URL_ERROR);
    }
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
    throw new AppError(WEBHOOK_URL_ERROR);
  const family = addresses[0].family === 6 ? 6 : 4;
  return { url, address: addresses[0].address, family };
}
