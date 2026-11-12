import "server-only";
import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "./domain";
import { isPublicAddress } from "./images";

export const WEBHOOK_URL_ERROR =
  "Use an HTTPS webhook URL on the public internet, without credentials.";

/** DNS for a delivery attempt shares that attempt's deadline. */
export const WEBHOOK_LOOKUP_TIMEOUT_MS = 3_000;

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

function lookupWithin(resolver: typeof lookup, host: string, signal?: AbortSignal) {
  const controller = new AbortController();
  const timer = signal
    ? undefined
    : setTimeout(
        () => controller.abort(new DOMException("timeout", "TimeoutError")),
        WEBHOOK_LOOKUP_TIMEOUT_MS,
      );
  const onParent = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", onParent, { once: true });
  }
  const stop = () => {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onParent);
  };
  return new Promise<LookupAddress[]>((resolve, reject) => {
    const finish = (error?: unknown, addresses?: LookupAddress[]) => {
      stop();
      controller.signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(addresses ?? []);
    };
    const onAbort = () => finish(controller.signal.reason ?? new Error("timeout"));
    if (controller.signal.aborted) return onAbort();
    controller.signal.addEventListener("abort", onAbort, { once: true });
    resolver(host, { all: true, verbatim: true }).then(
      (addresses) => {
        if (controller.signal.aborted) finish(controller.signal.reason);
        else finish(undefined, addresses);
      },
      (error) => finish(error),
    );
  });
}

export async function resolvePublicWebhook(
  value: string,
  resolver: typeof lookup = lookup,
  signal?: AbortSignal,
): Promise<ResolvedWebhook> {
  if (webhookUrlError(value)) throw new AppError(WEBHOOK_URL_ERROR);
  const url = new URL(value);
  const host = hostName(url);
  let addresses: LookupAddress[];
  if (signal?.aborted) throw new AppError(WEBHOOK_URL_ERROR);
  if (isIP(host)) addresses = [{ address: host, family: isIP(host) as 4 | 6 }];
  else {
    try {
      addresses = await lookupWithin(resolver, host, signal);
    } catch {
      throw new AppError(WEBHOOK_URL_ERROR);
    }
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
    throw new AppError(WEBHOOK_URL_ERROR);
  const family = addresses[0].family === 6 ? 6 : 4;
  return { url, address: addresses[0].address, family };
}
