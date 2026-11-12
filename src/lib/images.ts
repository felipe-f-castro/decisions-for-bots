import "server-only";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { AppError } from "./domain";

export const IMAGE_BUCKET = "decision-images";
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_UPLOAD_BODY_BYTES = 4 * 1024 * 1024;
export const SIGNED_URL_SECONDS = 15 * 60;
export interface ImageUpload {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}

const blocked = new BlockList();
for (const [ip, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(ip, prefix, "ipv4");
// Only global unicast IPv6; exclude documentation, tunnelling and special-use ranges.
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [ip, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blocked.addSubnet(ip, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  return family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

export async function resolveImageTarget(value: string, resolver = lookup) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("Use a valid public image URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && url.port !== "80" && url.port !== "443")
  )
    throw new AppError(
      "Image URLs must use public HTTP(S) on port 80 or 443, without credentials.",
    );
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await resolver(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
    throw new AppError("Image URLs must point to the public internet.");
  return { url, address: addresses[0].address, family: addresses[0].family };
}

export function validateImage(image: ImageUpload): ImageUpload {
  if (!image.bytes.length) throw new AppError("The image is empty.");
  if (image.bytes.length > MAX_IMAGE_BYTES)
    throw new AppError("Each image must be 3 MiB or smaller.", 413);
  const bytes = Buffer.from(image.bytes);
  const mime = image.contentType.toLowerCase().split(";")[0].trim();
  const matches =
    (mime === "image/png" &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    (mime === "image/gif" && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())) ||
    (mime === "image/webp" &&
      bytes.subarray(0, 4).toString() === "RIFF" &&
      bytes.subarray(8, 12).toString() === "WEBP");
  if (!matches)
    throw new AppError("Use a PNG, JPEG, WebP, or GIF image with a matching content type.", 415);
  const filename = image.filename.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(-120) || "image";
  return { bytes: image.bytes, contentType: mime, filename };
}

// Resolve each redirect, then connect to the validated IP while retaining TLS SNI
// and Host. This prevents DNS rebinding and never forwards cookies/credentials.
export async function downloadImage(
  value: string,
  signal = AbortSignal.timeout(12000),
  redirects = 0,
): Promise<ImageUpload> {
  if (redirects > 3) throw new AppError("The image has too many redirects.");
  signal.throwIfAborted();
  const { url, address, family } = await new Promise<
    Awaited<ReturnType<typeof resolveImageTarget>>
  >((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    resolveImageTarget(value)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
  signal.throwIfAborted();
  const result = await new Promise<ImageUpload | URL>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      {
        protocol: url.protocol,
        hostname: address,
        family,
        port: url.port || undefined,
        servername: url.hostname.replace(/^\[|\]$/g, ""),
        path: url.pathname + url.search,
        method: "GET",
        headers: { Host: url.host, Accept: "image/png,image/jpeg,image/webp,image/gif" },
        signal,
      },
      (response) => {
        const status = response.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.destroy();
          try {
            resolve(new URL(response.headers.location, url));
          } catch {
            reject(new AppError("The image URL returned an invalid redirect."));
          }
          return;
        }
        if (status !== 200) {
          response.destroy();
          reject(new AppError("The image URL could not be downloaded.", 400));
          return;
        }
        if (Number(response.headers["content-length"]) > MAX_IMAGE_BYTES) {
          response.destroy();
          reject(new AppError("Each image must be 3 MiB or smaller.", 413));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_IMAGE_BYTES) {
            response.destroy();
            reject(new AppError("Each image must be 3 MiB or smaller.", 413));
          } else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            resolve(
              validateImage({
                bytes: Buffer.concat(chunks),
                contentType: response.headers["content-type"] || "",
                filename: url.pathname.split("/").pop() || "image",
              }),
            );
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
  return result instanceof URL ? downloadImage(result.href, signal, redirects + 1) : result;
}
