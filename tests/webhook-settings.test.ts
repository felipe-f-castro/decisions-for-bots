import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSettings,
  recordWebhookAttempt,
  updateWorkspaceSettings,
} from "@/lib/appwrite/settings";
import { publicWebhookHealth, webhookUrlHash } from "@/lib/webhook-status";
import { appwriteEnv } from "./fixtures";

const rows = new Map<string, Record<string, unknown>>();

vi.mock("@/lib/appwrite/admin", () => ({ createAdminClient: async () => ({}) }));
vi.mock("node-appwrite", () => ({
  Query: {
    limit: (n: number) => `limit:${n}`,
    offset: (n: number) => `offset:${n}`,
  },
  TablesDB: class {
    async getRow({ rowId }: { rowId: string }) {
      const row = rows.get(rowId);
      if (!row) throw { code: 404 };
      return structuredClone(row);
    }
    async updateRow({ rowId, data }: { rowId: string; data: Record<string, unknown> }) {
      const row = rows.get(rowId);
      if (!row) throw { code: 404 };
      Object.assign(row, data);
      return structuredClone(row);
    }
    async listRows() {
      return { rows: [], total: 0 };
    }
  },
}));

const url = "https://receiver.example/hooks/decisions";
const secret = "fixture-webhook-secret-value";

beforeEach(() => {
  appwriteEnv();
  rows.clear();
  rows.set("app", {
    $id: "app",
    owner_user_id: "user",
    owner_email: "owner@example.com",
    areas: ["Design", "Content", "Other"],
    agent_api_key_hash: "abc",
    webhook_url: "",
    webhook_secret: "",
    setup_complete: true,
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("settings webhook status", () => {
  it("keeps an unverified URL from looking successful, then records a real result", async () => {
    expect((await getSettings())?.webhookSecret).toBe("");
    expect(publicWebhookHealth(await getSettings()).state).toBe("unconfigured");
    await updateWorkspaceSettings({ webhookUrl: url });
    const saved = await getSettings();
    expect(saved?.webhookUrl).toBe(url);
    expect(publicWebhookHealth(saved).state).toBe("unknown");
    expect(JSON.stringify(publicWebhookHealth(saved))).not.toContain(secret);

    await updateWorkspaceSettings({ webhookSecret: secret });
    await recordWebhookAttempt({
      url,
      outcome: "succeeded",
      error: "",
      kind: "test",
      at: "2026-11-12T12:00:00.000Z",
    });
    const working = await getSettings();
    expect(publicWebhookHealth(working)).toMatchObject({ state: "ok", kind: "test" });
    const row = rows.get("app")!;
    expect(row.webhook_last_url_hash).toBe(webhookUrlHash(url));
    expect(JSON.stringify(row.webhook_last_error)).not.toContain(secret);
    expect(row.webhook_last_error).not.toContain(url);
    expect(row.webhook_secret).toBe(secret);

    await recordWebhookAttempt({
      url,
      outcome: "failed",
      error: `boom ${secret}\n${url}`,
      kind: "delivery",
      at: "2026-11-12T12:05:00.000Z",
    });
    const failed = publicWebhookHealth(await getSettings());
    expect(failed).toMatchObject({ state: "failed", error: "The last delivery failed." });
    expect(rows.get("app")?.webhook_last_error).toBe("The last delivery failed.");
    expect(JSON.stringify(rows.get("app")?.webhook_last_error)).not.toContain(secret);
    expect(JSON.stringify(failed)).not.toContain(secret);
    expect(JSON.stringify(failed)).not.toContain(url);
  });

  it("clears a previous success when the URL or secret changes", async () => {
    await updateWorkspaceSettings({ webhookUrl: url, webhookSecret: secret });
    await recordWebhookAttempt({
      url,
      outcome: "succeeded",
      error: "",
      kind: "delivery",
      at: "2026-11-12T12:00:00.000Z",
    });
    expect(publicWebhookHealth(await getSettings()).state).toBe("ok");
    await updateWorkspaceSettings({ webhookUrl: "https://other.example/hook" });
    const moved = await getSettings();
    expect(moved?.webhookLastOutcome).toBe("");
    expect(moved?.webhookSecret).toBe(secret);
    expect(publicWebhookHealth(moved).state).toBe("unknown");
    await recordWebhookAttempt({
      url: "https://other.example/hook",
      outcome: "succeeded",
      error: "",
      kind: "test",
      at: "2026-11-12T13:00:00.000Z",
    });
    await updateWorkspaceSettings({ webhookSecret: "replacement-secret-value" });
    expect(publicWebhookHealth(await getSettings()).state).toBe("unknown");
    expect((await getSettings())?.webhookSecret).toBe("replacement-secret-value");
  });

  it("rejects a short secret without storing it", async () => {
    await expect(updateWorkspaceSettings({ webhookSecret: "too-short" })).rejects.toThrow(
      /16 to 256/,
    );
    expect((await getSettings())?.webhookSecret).toBe("");
    expect(String((await getSettings())?.webhookSecret)).not.toContain("too-short");
  });
});
