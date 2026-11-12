import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/domain";
import { parseSetupInput, completeSetup } from "@/lib/setup";
import { hashToken } from "@/lib/crypto";
import {
  assertAccountCreationAllowed,
  resetAuthThrottles,
  SETUP_TOKEN_WINDOW_MS,
} from "@/lib/throttle";
import { appwriteEnv } from "./fixtures";

const TOKEN = "fixture-setup-token-with-enough-length";

const { tables, users, project, account, state } = vi.hoisted(() => ({
  state: {
    row: null as null | Record<string, unknown>,
    emails: [] as string[],
  },
  tables: {
    getRow: vi.fn(),
    createRow: vi.fn(),
    updateRow: vi.fn(),
    updateRows: vi.fn(),
    listRows: vi.fn(),
  },
  users: {
    list: vi.fn(),
    create: vi.fn(),
    updatePassword: vi.fn(),
    updateEmailVerification: vi.fn(),
    deleteSession: vi.fn(),
  },
  project: { updateAuthLimit: vi.fn(), updateUserLimitPolicy: vi.fn() },
  account: {
    createEmailPasswordSession: vi.fn(),
    updatePassword: vi.fn(),
    deleteSession: vi.fn(),
  },
}));

function matches(row: Record<string, unknown>, queries: string[] = []) {
  return queries.every((raw) => {
    const query = JSON.parse(raw) as { method: string; attribute: string; values?: unknown[] };
    if (query.method !== "equal") return true;
    const actual = query.attribute === "$id" ? row.$id : row[query.attribute];
    return actual === query.values?.[0];
  });
}

vi.mock("node-appwrite", () => ({
  ID: { unique: () => "generated-user-id" },
  Query: {
    limit: (value: number) => JSON.stringify({ method: "limit", values: [value] }),
    offset: (value: number) => JSON.stringify({ method: "offset", values: [value] }),
    equal: (attribute: string, value: unknown) =>
      JSON.stringify({
        method: "equal",
        attribute,
        values: Array.isArray(value) ? value : [value],
      }),
  },
  Client: class {
    setEndpoint() {
      return this;
    }
    setProject() {
      return this;
    }
    setSession() {
      return this;
    }
    setKey() {
      return this;
    }
  },
  TablesDB: class {
    getRow = tables.getRow;
    createRow = tables.createRow;
    updateRow = tables.updateRow;
    updateRows = tables.updateRows;
    listRows = tables.listRows;
  },
  Users: class {
    list = users.list;
    create = users.create;
    updatePassword = users.updatePassword;
    updateEmailVerification = users.updateEmailVerification;
    deleteSession = users.deleteSession;
  },
  Account: class {
    createEmailPasswordSession = account.createEmailPasswordSession;
    updatePassword = account.updatePassword;
    deleteSession = account.deleteSession;
  },
  Project: class {
    updateAuthLimit = project.updateAuthLimit;
    updateUserLimitPolicy = project.updateUserLimitPolicy;
  },
}));
vi.mock("@/lib/appwrite/admin", () => ({ createAdminClient: async () => ({}) }));

const input = {
  email: "owner@example.com",
  password: "a strong password",
  areas: "Design, Content",
  webhookUrl: "",
  setupToken: TOKEN,
};

beforeEach(() => {
  appwriteEnv();
  vi.stubEnv("SETUP_TOKEN", TOKEN);
  resetAuthThrottles();
  state.row = null;
  state.emails = [];
  for (const fn of Object.values(tables)) fn.mockReset();
  for (const fn of Object.values(users)) fn.mockReset();
  for (const fn of Object.values(account)) fn.mockReset();
  project.updateAuthLimit.mockReset();
  project.updateUserLimitPolicy.mockReset();
  tables.getRow.mockImplementation(async () => {
    await Promise.resolve();
    if (!state.row) throw Object.assign(new Error("missing"), { code: 404 });
    return { ...state.row };
  });
  tables.createRow.mockImplementation(
    async (args: { tableId: string; rowId?: string; data: Record<string, unknown> }) => {
      await Promise.resolve();
      if (args.tableId === "allowed_emails") {
        state.emails.push(String(args.data.email));
        return {};
      }
      if (state.row) throw Object.assign(new Error("conflict"), { code: 409 });
      state.row = { $id: args.rowId || "app", ...args.data };
      return {};
    },
  );
  tables.updateRow.mockImplementation(async (args: { data: Record<string, unknown> }) => {
    state.row = { ...(state.row ?? {}), ...args.data };
    return {};
  });
  tables.updateRows.mockImplementation(
    async (args: { queries?: string[]; data: Record<string, unknown> }) => {
      await Promise.resolve();
      if (!state.row || !matches(state.row, args.queries)) return { total: 0, rows: [] };
      state.row = { ...state.row, ...args.data };
      return { total: 1, rows: [{ ...state.row }] };
    },
  );
  tables.listRows.mockImplementation(async () => ({
    rows: state.emails.map((email) => ({ email })),
  }));
  users.list.mockResolvedValue({ total: 0, users: [] });
  users.create.mockResolvedValue({ $id: "generated-user-id", email: "owner@example.com" });
  users.updateEmailVerification.mockResolvedValue({});
  users.deleteSession.mockResolvedValue({});
  account.createEmailPasswordSession.mockResolvedValue({
    $id: "session-1",
    secret: "session-secret",
  });
  account.updatePassword.mockResolvedValue({});
  account.deleteSession.mockResolvedValue({});
  project.updateUserLimitPolicy.mockResolvedValue({});
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
        setupToken: ` ${TOKEN} `,
      }),
    ).toEqual({
      email: "owner@example.com",
      password: "a strong password",
      areas: ["Design", "Content", "Other"],
      webhookUrl: "https://hooks.example/decisions",
      setupToken: TOKEN,
      currentPassword: "",
    });
  });

  it("rejects an invalid email, a short password, or an unsafe webhook URL", () => {
    expect(() =>
      parseSetupInput({ email: "nope", password: "a strong password", areas: "" }),
    ).toThrow(AppError);
    expect(() =>
      parseSetupInput({ email: "owner@example.com", password: "short", areas: "" }),
    ).toThrow(/at least 10/);
    for (const webhookUrl of [
      "https://user:pass@hooks.example",
      "http://hooks.example/decisions",
      "https://127.0.0.1/hook",
      "https://localhost/hook",
      "https://10.1.2.3/hook",
    ]) {
      expect(() =>
        parseSetupInput({
          email: "owner@example.com",
          password: "a strong password",
          areas: "",
          webhookUrl,
        }),
      ).toThrow(/webhook URL/);
    }
  });
});

describe("setup lock", () => {
  it("requires an installation token and does not create an owner without one", async () => {
    vi.stubEnv("SETUP_TOKEN", "");
    await expect(completeSetup(input)).rejects.toMatchObject({ status: 503 });
    vi.stubEnv("SETUP_TOKEN", "too-short");
    await expect(completeSetup(input)).rejects.toMatchObject({ status: 503 });
    vi.stubEnv("SETUP_TOKEN", TOKEN);
    await expect(
      completeSetup({ ...input, setupToken: "wrong-token-but-long-enough-value" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(users.create).not.toHaveBeenCalled();
    expect(state.row).toBeNull();
  });

  it("creates a pre-confirmed owner once and then refuses a second claim", async () => {
    const first = await completeSetup(input);
    expect(first.agentApiKey).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(first.webhookSecret).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(users.create).toHaveBeenCalledOnce();
    expect(users.updatePassword).not.toHaveBeenCalled();
    expect(users.updateEmailVerification).toHaveBeenCalledWith({
      userId: "generated-user-id",
      emailVerification: true,
    });
    expect(state.row).toMatchObject({
      setup_complete: true,
      owner_email: "owner@example.com",
      areas: ["Design", "Content"],
      agent_api_key_hash: hashToken(first.agentApiKey),
      webhook_secret: first.webhookSecret,
    });
    expect(state.row?.agent_api_key_hash).not.toBe(first.agentApiKey);
    expect(tables.updateRow).not.toHaveBeenCalled();

    const writes = tables.updateRows.mock.calls.length;
    await expect(completeSetup(input)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/already has an owner/),
    });
    expect(users.create).toHaveBeenCalledOnce();
    expect(users.updatePassword).not.toHaveBeenCalled();
    expect(tables.updateRows).toHaveBeenCalledTimes(writes);
    expect(state.row?.webhook_secret).toBe(first.webhookSecret);
  });

  it("lets only one overlapping setup write secrets", async () => {
    const other = { ...input, password: "another strong password" };
    const [first, second] = await Promise.allSettled([completeSetup(input), completeSetup(other)]);
    const fulfilled = [first, second].filter((result) => result.status === "fulfilled");
    const rejected = [first, second].filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(users.create).toHaveBeenCalledOnce();
    expect(users.updatePassword).not.toHaveBeenCalled();
    const winner = fulfilled[0].status === "fulfilled" ? fulfilled[0].value : undefined;
    expect(state.row).toMatchObject({
      setup_complete: true,
      agent_api_key_hash: hashToken(winner!.agentApiKey),
      webhook_secret: winner!.webhookSecret,
    });
    expect(tables.updateRows.mock.calls.filter((call) => call[0].data.setup_complete)).toHaveLength(
      1,
    );
  });

  it("does not replace an existing Appwrite password without the current one", async () => {
    users.list.mockResolvedValue({
      total: 1,
      users: [{ $id: "existing-user", email: "owner@example.com" }],
    });
    await expect(completeSetup(input)).rejects.toMatchObject({ status: 401 });
    expect(users.updatePassword).not.toHaveBeenCalled();
    expect(account.updatePassword).not.toHaveBeenCalled();
    expect(users.create).not.toHaveBeenCalled();
    expect(state.row?.setup_complete).not.toBe(true);

    account.createEmailPasswordSession.mockRejectedValueOnce(new Error("invalid"));
    await expect(
      completeSetup({ ...input, currentPassword: "wrong password" }),
    ).rejects.toMatchObject({
      status: 401,
    });
    expect(users.updatePassword).not.toHaveBeenCalled();
    expect(state.row?.setup_complete).not.toBe(true);

    account.createEmailPasswordSession.mockRejectedValueOnce(
      Object.assign(new Error("Server Error"), { code: 503 }),
    );
    await expect(
      completeSetup({ ...input, currentPassword: "current password" }),
    ).rejects.toMatchObject({ status: 503 });
    expect(state.row?.setup_complete).not.toBe(true);

    const done = await completeSetup({ ...input, currentPassword: "current password" });
    expect(users.updatePassword).not.toHaveBeenCalled();
    expect(users.create).not.toHaveBeenCalled();
    expect(account.createEmailPasswordSession).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "current password",
    });
    expect(account.updatePassword).toHaveBeenCalledWith({
      password: "a strong password",
      oldPassword: "current password",
    });
    expect(users.deleteSession).toHaveBeenCalledWith({
      userId: "existing-user",
      sessionId: "session-1",
    });
    expect(account.deleteSession).not.toHaveBeenCalled();
    expect(state.row?.agent_api_key_hash).toBe(hashToken(done.agentApiKey));
  });

  it("keeps an existing password when the new one matches the current one", async () => {
    users.list.mockResolvedValue({
      total: 1,
      users: [{ $id: "existing-user", email: "owner@example.com" }],
    });
    await completeSetup({ ...input, currentPassword: input.password });
    expect(account.updatePassword).not.toHaveBeenCalled();
    expect(users.updatePassword).not.toHaveBeenCalled();
    expect(users.deleteSession).toHaveBeenCalledWith({
      userId: "existing-user",
      sessionId: "session-1",
    });
    expect(state.row?.setup_complete).toBe(true);
  });

  it("finishes setup when verification-session cleanup fails", async () => {
    users.list.mockResolvedValue({
      total: 1,
      users: [{ $id: "existing-user", email: "owner@example.com" }],
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    users.deleteSession.mockRejectedValueOnce(
      Object.assign(new Error("session-secret leaked in the message"), { code: 503 }),
    );
    const done = await completeSetup({ ...input, currentPassword: input.password });
    expect(done.agentApiKey).toBeTruthy();
    expect(state.row?.setup_complete).toBe(true);
    expect(users.deleteSession).toHaveBeenCalledWith({
      userId: "existing-user",
      sessionId: "session-1",
    });
    expect(account.deleteSession).not.toHaveBeenCalled();
    const logs = JSON.stringify(warn.mock.calls);
    expect(logs).not.toContain("session-secret");
    expect(logs).toContain("503");
    warn.mockRestore();
  });

  it("stops admin account creation after repeated attempts", async () => {
    await assertAccountCreationAllowed(input.email);
    await assertAccountCreationAllowed(input.email);
    await assertAccountCreationAllowed(input.email);
    await expect(completeSetup(input)).rejects.toMatchObject({ status: 429 });
    expect(users.create).not.toHaveBeenCalled();
    expect(state.row?.setup_complete).not.toBe(true);
  });

  it("throttles installation token failures and recovers after the window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const wrong = { ...input, setupToken: "wrong-token-but-long-enough-value" };
    try {
      for (let attempt = 0; attempt < 5; attempt++)
        await expect(completeSetup(wrong)).rejects.toMatchObject({ status: 403 });
      await expect(completeSetup(wrong)).rejects.toMatchObject({ status: 429 });
      expect(users.create).not.toHaveBeenCalled();
      expect(state.row).toBeNull();
      vi.setSystemTime(new Date(Date.now() + SETUP_TOKEN_WINDOW_MS));
      await expect(completeSetup(wrong)).rejects.toMatchObject({ status: 403 });
      expect(state.row).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a released unfinished claim use a different email", async () => {
    users.create.mockRejectedValueOnce(new Error("unavailable"));
    await expect(completeSetup(input)).rejects.toThrow(/unavailable/);
    expect(state.row).toMatchObject({
      setup_complete: false,
      owner_email: "",
      setup_claim: "",
    });
    const done = await completeSetup({
      ...input,
      email: "other@example.com",
      password: "another strong password",
    });
    expect(state.row).toMatchObject({
      setup_complete: true,
      owner_email: "other@example.com",
      agent_api_key_hash: hashToken(done.agentApiKey),
    });
  });

  it("refuses another email while a claim is still active", async () => {
    state.row = {
      $id: "app",
      setup_complete: false,
      owner_email: "first@example.com",
      setup_claim: "claim-a",
      setup_claim_until: new Date(Date.now() + 60_000).toISOString(),
      owner_user_id: "",
      agent_api_key_hash: "",
      webhook_url: "",
      webhook_secret: "",
    };
    await expect(
      completeSetup({ ...input, email: "other@example.com", password: "another strong password" }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/in progress/) });
    expect(state.row).toMatchObject({
      owner_email: "first@example.com",
      setup_claim: "claim-a",
      setup_complete: false,
    });
    expect(users.create).not.toHaveBeenCalled();
  });

  it("lets an expired claim change email and ignores the old claim afterwards", async () => {
    state.row = {
      $id: "app",
      setup_complete: false,
      owner_email: "first@example.com",
      setup_claim: "claim-a",
      setup_claim_until: new Date(Date.now() - 1000).toISOString(),
      owner_user_id: "",
      agent_api_key_hash: "",
      webhook_url: "",
      webhook_secret: "",
    };
    let releaseList: (() => void) | undefined;
    let listed = 0;
    users.list.mockImplementation(async () => {
      listed += 1;
      if (listed === 1) await new Promise<void>((resolve) => (releaseList = resolve));
      return { total: 0, users: [] };
    });
    const first = completeSetup(input);
    await vi.waitFor(() => expect(releaseList).toEqual(expect.any(Function)));
    const held = state.row?.setup_claim;
    expect(held).toBeTruthy();
    expect(held).not.toBe("claim-a");
    state.row = {
      ...state.row,
      setup_claim_until: new Date(Date.now() - 1000).toISOString(),
    };
    const second = await completeSetup({
      ...input,
      email: "other@example.com",
      password: "another strong password",
    });
    const replacement = { ...state.row };
    expect(replacement).toMatchObject({
      setup_complete: true,
      owner_email: "other@example.com",
      agent_api_key_hash: hashToken(second.agentApiKey),
      webhook_secret: second.webhookSecret,
    });
    expect(replacement.setup_claim).not.toBe(held);
    releaseList?.();
    await expect(first).rejects.toMatchObject({ status: 409 });
    expect(state.row).toEqual(replacement);
  });

  it("does not treat a settings read failure as an empty workspace", async () => {
    tables.getRow.mockRejectedValue(new Error("database down"));
    await expect(completeSetup(input)).rejects.toThrow(/database down/);
    expect(users.create).not.toHaveBeenCalled();
    expect(users.updatePassword).not.toHaveBeenCalled();
  });
});
