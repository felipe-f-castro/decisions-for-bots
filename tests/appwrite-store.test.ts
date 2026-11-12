import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/domain";
import { appwriteEnv, png } from "./fixtures";

type Row = Record<string, unknown> & { $id: string; $createdAt: string; $updatedAt: string; version: number };

const { state } = vi.hoisted(() => ({
  state: {
    rows: new Map<string, Row>(),
    files: new Map<string, { name: string }>(),
  },
}));

function matches(row: Row, queries: string[] = []) {
  for (const query of queries) {
    const equal = /^equal:(.+)=(.+)$/.exec(query);
    if (equal && String(row[equal[1]]) !== equal[2]) return false;
  }
  return true;
}

vi.mock("node-appwrite", () => ({
  Query: {
    equal: (key: string, value: unknown) => `equal:${key}=${value}`,
    orderAsc: (key: string) => `orderAsc:${key}`,
    limit: (n: number) => `limit:${n}`,
    offset: (n: number) => `offset:${n}`,
  },
  Storage: class {
    async createFile({ fileId, file }: { fileId: string; file: { name?: string } }) {
      state.files.set(fileId, { name: file.name || fileId });
      return { $id: fileId, name: file.name || fileId };
    }
    async getFile({ fileId }: { fileId: string }) {
      const file = state.files.get(fileId);
      if (!file) throw { code: 404 };
      return { $id: fileId, name: file.name };
    }
    async deleteFile({ fileId }: { fileId: string }) {
      state.files.delete(fileId);
    }
  },
  Tokens: class {
    async createFileToken({ fileId }: { fileId: string }) {
      return { secret: `file-token-${fileId}` };
    }
  },
  TablesDB: class {
    async getRow({ rowId }: { rowId: string }) {
      const row = state.rows.get(rowId);
      if (!row) throw { code: 404 };
      return structuredClone(row);
    }
    async listRows({ queries = [] }: { queries?: string[] }) {
      const rows = [...state.rows.values()].filter((row) => matches(row, queries));
      return { rows: rows.map((row) => structuredClone(row)), total: rows.length };
    }
    async createRow({ rowId, data }: { rowId: string; data: Record<string, unknown> }) {
      const now = new Date().toISOString();
      const row = { $id: rowId, $createdAt: now, $updatedAt: now, ...data } as Row;
      state.rows.set(rowId, row);
      return structuredClone(row);
    }
    async updateRows({ data, queries = [] }: { data: Record<string, unknown>; queries?: string[] }) {
      const updated: Row[] = [];
      for (const [id, row] of state.rows) {
        if (!matches(row, queries)) continue;
        const next = { ...row, ...data, $updatedAt: new Date().toISOString() } as Row;
        state.rows.set(id, next);
        updated.push(structuredClone(next));
      }
      return { total: updated.length, rows: updated };
    }
  },
}));
vi.mock("node-appwrite/file", () => ({
  InputFile: { fromBuffer: (bytes: Uint8Array, name: string) => ({ bytes, name }) },
}));
vi.mock("@/lib/appwrite/admin", () => ({ createAdminClient: async () => ({}) }));

import { AppwriteStore } from "@/lib/stores/appwrite";

beforeEach(() => {
  appwriteEnv();
  state.rows.clear();
  state.files.clear();
});
afterEach(() => vi.unstubAllEnvs());

const input = {
  question: "Which heading?",
  context: "",
  options: ["Keep it", "Change it"],
  area: "Design",
  waitingOn: "",
  deadline: null,
  imageUrls: [],
};

describe("Appwrite store versioning", () => {
  it("creates a decision and signs stored image URLs", async () => {
    const store = new AppwriteStore(async () => {
      throw new Error("no download in this test");
    });
    const created = await store.create(input, [
      { bytes: png, contentType: "image/png", filename: "heading.png" },
    ]);
    expect(created.status).toBe("Open");
    expect(created.revision).toBe("1");
    expect(created.images[0].filename).toBe("heading.png");
    expect(created.images[0].url).toContain("file-token-");
    expect(created.images[0].url).toContain("/view");
  });

  it("returns 409 when a second mutate uses a stale version", async () => {
    const store = new AppwriteStore();
    const created = await store.create(input);
    const first = await store.mutate(created.id, {
      action: "answer",
      answer: "Keep it",
      custom: false,
      expectedRevision: created.revision,
    });
    expect(first.status).toBe("Answered");
    expect(first.revision).toBe("2");
    await expect(
      store.mutate(created.id, {
        action: "answer",
        answer: "Keep it",
        custom: false,
        expectedRevision: created.revision,
      }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      store.mutate(created.id, {
        action: "answer",
        answer: "Keep it",
        custom: false,
        expectedRevision: created.revision,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const current = await store.get(created.id);
    expect(current.revision).toBe("2");
    expect(current.answer).toBe("Keep it");
  });
});
