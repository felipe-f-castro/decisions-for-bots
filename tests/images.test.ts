import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  downloadImage,
  isPublicAddress,
  MAX_IMAGE_BYTES,
  resolveImageTarget,
  validateImage,
} from "@/lib/images";
import { png } from "./fixtures";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));
beforeEach(() => {
  vi.mocked(lookup).mockReset();
  vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
  vi.mocked(httpsRequest).mockReset();
});

describe("safe private image ingestion", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "0.0.0.0",
    "100.64.0.1",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "fc00::1",
    "2002:7f00:1::",
    "2001:db8::1",
    "not-an-ip",
  ])("blocks %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it("accepts public addresses and rejects mixed/private DNS and unusual ports", async () => {
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
    expect(await resolveImageTarget("https://images.example/image.png")).toMatchObject({
      address: "93.184.216.34",
      family: 4,
    });
    vi.mocked(lookup).mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ] as never);
    await expect(resolveImageTarget("https://images.example/image.png")).rejects.toMatchObject({
      status: 400,
    });
    for (const url of [
      "http://127.1/image.png",
      "http://2130706433/image.png",
      "http://[::ffff:127.0.0.1]/image.png",
      "https://images.example:444/image.png",
      "file:///etc/passwd",
      "https://user:secret@images.example/image.png",
    ])
      await expect(resolveImageTarget(url)).rejects.toThrow();
  });
  it("checks size, MIME signatures, and safe filenames", () => {
    expect(
      validateImage({ bytes: png, contentType: "image/png", filename: "../../private.png" })
        .filename,
    ).toBe(".._.._private.png");
    expect(() =>
      validateImage({ bytes: png, contentType: "image/jpeg", filename: "x.jpg" }),
    ).toThrow("matching content type");
    expect(() =>
      validateImage({
        bytes: Buffer.from("<svg/>"),
        contentType: "image/svg+xml",
        filename: "x.svg",
      }),
    ).toThrow();
    expect(() =>
      validateImage({
        bytes: new Uint8Array(MAX_IMAGE_BYTES + 1),
        contentType: "image/png",
        filename: "x.png",
      }),
    ).toThrow("3 MiB");
  });
  it("pins the connection IP and keeps TLS SNI and Host on the original host", async () => {
    vi.mocked(httpsRequest).mockImplementation(((
      options: object,
      callback: (response: unknown) => void,
    ) => {
      const req = new EventEmitter();
      return Object.assign(req, {
        end() {
          const res = Object.assign(new PassThrough(), {
            statusCode: 200,
            headers: { "content-type": "image/png" },
          });
          callback(res);
          queueMicrotask(() => res.end(png));
        },
      });
    }) as never);
    const result = await downloadImage("https://images.example/logo.png");
    expect(result.bytes).toEqual(png);
    expect(httpsRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: "93.184.216.34",
        servername: "images.example",
        headers: expect.objectContaining({ Host: "images.example" }),
      }),
      expect.any(Function),
    );
  });
  it("rechecks redirects before contacting a private address", async () => {
    vi.mocked(httpsRequest).mockImplementation(((
      _options: object,
      callback: (response: unknown) => void,
    ) =>
      Object.assign(new EventEmitter(), {
        end() {
          callback(
            Object.assign(new PassThrough(), {
              statusCode: 302,
              headers: { location: "http://169.254.169.254/latest/meta-data" },
            }),
          );
        },
      })) as never);
    await expect(downloadImage("https://images.example/redirect")).rejects.toThrow(
      "public internet",
    );
    expect(httpsRequest).toHaveBeenCalledOnce();
  });
  it("bounds DNS resolution with the same abort signal as the download", async () => {
    vi.mocked(lookup).mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const download = downloadImage("https://images.example/slow.png", controller.signal);
    controller.abort();
    await expect(download).rejects.toMatchObject({ name: "AbortError" });
    expect(httpsRequest).not.toHaveBeenCalled();
  });
  it("bounds downloaded streams even without a Content-Length header", async () => {
    vi.mocked(httpsRequest).mockImplementation(((
      _options: object,
      callback: (response: unknown) => void,
    ) =>
      Object.assign(new EventEmitter(), {
        end() {
          const response = Object.assign(new PassThrough(), {
            statusCode: 200,
            headers: { "content-type": "image/png" },
          });
          callback(response);
          queueMicrotask(() => response.end(Buffer.alloc(MAX_IMAGE_BYTES + 1)));
        },
      })) as never);
    await expect(downloadImage("https://images.example/huge.png")).rejects.toMatchObject({
      status: 413,
    });
  });
});
