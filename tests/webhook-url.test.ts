import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { resolvePublicWebhook, webhookUrlError } from "@/lib/webhook-url";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

beforeEach(() => {
  vi.mocked(lookup).mockReset();
  vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
});

describe("public webhook destinations", () => {
  it.each([
    "http://hooks.example/decisions",
    "https://user:secret@hooks.example/decisions",
    "https://127.0.0.1/hook",
    "https://2130706433/hook",
    "https://127.1/hook",
    "https://0x7f000001/hook",
    "https://[::1]/hook",
    "https://[::ffff:127.0.0.1]/hook",
    "https://10.0.0.5/hook",
    "https://192.168.1.4/hook",
    "https://169.254.169.254/latest",
    "https://localhost/hook",
    "https://metadata.google.internal/hook",
    "file:///tmp/hook",
  ])("rejects %s before DNS", (value) => {
    expect(webhookUrlError(value)).toBeTruthy();
  });

  it("accepts a hostname only when every address is public", async () => {
    const target = await resolvePublicWebhook("https://hooks.example/decisions");
    expect(target).toMatchObject({ address: "93.184.216.34", family: 4 });
    vi.mocked(lookup).mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.8", family: 4 },
    ] as never);
    await expect(resolvePublicWebhook("https://hooks.example/decisions")).rejects.toThrow(
      /public internet/,
    );
    vi.mocked(lookup).mockRejectedValue(new Error("ENOTFOUND") as never);
    await expect(resolvePublicWebhook("https://hooks.example/decisions")).rejects.toThrow(
      /public internet/,
    );
  });

  it("rejects unique-local and link-local IPv6, including mixed answers", async () => {
    for (const address of ["fd00::1", "fc00::2", "fe80::1"]) {
      vi.mocked(lookup).mockResolvedValue([{ address, family: 6 }] as never);
      await expect(resolvePublicWebhook("https://hooks.example/decisions")).rejects.toThrow(
        /public internet/,
      );
    }
    for (const privateAddress of ["fd12:3456:789a::1", "fe80::abcd"]) {
      vi.mocked(lookup).mockResolvedValue([
        { address: "2001:4860:4860::8888", family: 6 },
        { address: privateAddress, family: 6 },
      ] as never);
      await expect(resolvePublicWebhook("https://hooks.example/decisions")).rejects.toThrow(
        /public internet/,
      );
    }
  });

  it("stops waiting when DNS does not answer before the deadline", async () => {
    vi.mocked(lookup).mockImplementation(() => new Promise(() => {}) as never);
    const controller = new AbortController();
    const pending = resolvePublicWebhook(
      "https://hooks.example/decisions",
      lookup,
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toThrow(/public internet/);
  });
});
