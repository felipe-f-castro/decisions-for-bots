import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/domain";
import { parseSetupInput, completeSetup } from "@/lib/setup";
import { hashToken } from "@/lib/crypto";
import { appwriteEnv } from "./fixtures";

const { tables, users, project } = vi.hoisted(() => ({
  tables: {
    getRow: vi.fn(),
    createRow: vi.fn(),
    updateRow: vi.fn(),
    listRows: vi.fn(),
  },
  users: {
    list: vi.fn(),
    create: vi.fn(),
    updatePassword: vi.fn(),
    updateEmailVerification: vi.fn(),
  },
  project: { updateAuthLimit: vi.fn(), updateUserLimitPolicy: vi.fn() },
}));

vi.mock("node-appwrite", () => ({
  ID: { unique: () => "generated-user-id" },
  Query: { limit: () => "limit", offset: () => "offset", equal: () => "eq" },
  TablesDB: class {
    getRow = tables.getRow;
    createRow = tables.createRow;
    updateRow = tables.updateRow;
    listRows = tables.listRows;
  },
  Users: class {
    list = users.list;
    create = users.create;
    updatePassword = users.updatePassword;
    updateEmailVerification = users.updateEmailVerification;
  },
  Project: class {
    updateAuthLimit = project.updateAuthLimit;
    updateUserLimitPolicy = project.updateUserLimitPolicy;
  },
}));
vi.mock("@/lib/appwrite/admin", () => ({ createAdminClient: async () => ({}) }));

beforeEach(() => {
  appwriteEnv();
  Object.values(tables).forEach((fn) => fn.mockReset());
  Object.values(users).forEach((fn) => fn.mockReset());
  project.updateAuthLimit.mockReset();
  project.updateUserLimitPolicy.mockReset();
  tables.getRow.mockRejectedValue({ code: 404 });
  tables.createRow.mockResolvedValue({});
  tables.updateRow.mockResolvedValue({});
  tables.listRows.mockResolvedValue({ rows: [] });
  users.list.mockResolvedValue({ total: 0, users: [] });
  users.create.mockResolvedValue({ $id: "generated-user-id", email: "owner@example.com" });
  users.updateEmailVerification.mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());

describe("setup input", () => {
  it("normalizes the owner email and default areas", () => {
    expect(
      parseSetupInput({
        email: " Owner@Example.com ",
        password: "a strong password",
        areas: "",
        webhookUrl: "https://hooks.example/decisions",
      }),
    ).toEqual({
      email: "owner@example.com",
      password: "a strong password",
      areas: ["Design", "Content", "Other"],
      webhookUrl: "https://hooks.example/decisions",
    });
  });

  it("rejects an invalid email, a short password, or a credentialed webhook URL", () => {
    expect(() => parseSetupInput({ email: "nope", password: "a strong password", areas: "" })).toThrow(
      AppError,
    );
    expect(() =>
      parseSetupInput({ email: "owner@example.com", password: "short", areas: "" }),
    ).toThrow(/at least 10/);
    expect(() =>
      parseSetupInput({
        email: "owner@example.com",
        password: "a strong password",
        areas: "",
        webhookUrl: "https://user:pass@hooks.example",
      }),
    ).toThrow(/webhook URL/);
  });
});

describe("setup lock", () => {
  const input = {
    email: "owner@example.com",
    password: "a strong password",
    areas: "Design, Content",
    webhookUrl: "",
  };

  it("creates a pre-confirmed owner once and then refuses a second claim", async () => {
    const first = await completeSetup(input);
    expect(first.agentApiKey).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(first.webhookSecret).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(users.create).toHaveBeenCalledOnce();
    expect(users.updateEmailVerification).toHaveBeenCalledWith({
      userId: "generated-user-id",
      emailVerification: true,
    });
    const saved = tables.updateRow.mock.calls[0][0].data;
    expect(saved.setup_complete).toBe(true);
    expect(saved.owner_email).toBe("owner@example.com");
    expect(saved.areas).toEqual(["Design", "Content"]);
    expect(saved.agent_api_key_hash).toBe(hashToken(first.agentApiKey));
    expect(saved.webhook_secret).toBe(first.webhookSecret);
    expect(saved.agent_api_key_hash).not.toBe(first.agentApiKey);

    tables.getRow.mockResolvedValue({ setup_complete: true, owner_email: "owner@example.com" });
    await expect(completeSetup(input)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/already has an owner/),
    });
    expect(users.create).toHaveBeenCalledOnce();
  });
});
