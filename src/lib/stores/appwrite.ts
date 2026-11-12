import "server-only";
import { randomUUID } from "node:crypto";
import { Query, Storage, TablesDB, Tokens, type Models } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import { getConfig } from "../config";
import {
  AppError,
  applyMutation,
  validateDecisionId,
  type Decision,
  type Mutation,
  type NewDecision,
  type Status,
} from "../domain";
import {
  downloadImage,
  validateImage,
  IMAGE_BUCKET,
  SIGNED_URL_SECONDS,
  type ImageUpload,
} from "../images";
import { createAdminClient } from "../appwrite/admin";
import { DATABASE_ID, DECISIONS_TABLE } from "../appwrite/ids";
import type { DecisionStore } from "./types";

const statuses = { open: "Open", answered: "Answered", routed: "Routed" } as const;
type RowStatus = keyof typeof statuses;

export type DecisionRow = Models.Row & {
  $id: string;
  $createdAt: string;
  $updatedAt: string;
  question: string;
  context?: string;
  options?: string[];
  area: string;
  waiting_on?: string;
  deadline?: string | null;
  status: RowStatus;
  answer?: string;
  custom_answer?: string;
  answered_at?: string | null;
  version: number;
  image_paths?: string[];
};

function fromRow(row: DecisionRow): Decision {
  return {
    id: row.$id,
    question: row.question,
    context: row.context || "",
    options: row.options ?? [],
    area: row.area,
    waitingOn: row.waiting_on || "",
    deadline: row.deadline ?? null,
    status: statuses[row.status],
    answer: row.answer || "",
    customAnswer: row.custom_answer || "",
    answeredAt: row.answered_at ?? null,
    createdAt: row.$createdAt,
    updatedAt: row.$updatedAt,
    revision: String(row.version),
    images: [],
  };
}

export class AppwriteStore implements DecisionStore {
  constructor(private downloader = downloadImage) {}

  private async db() {
    return new TablesDB(await createAdminClient());
  }

  private async storage() {
    return new Storage(await createAdminClient());
  }

  private async signed(rows: DecisionRow[]): Promise<Decision[]> {
    const ids = [...new Set(rows.flatMap((row) => row.image_paths ?? []))];
    const urls = new Map<string, { url: string; filename: string }>();
    if (ids.length) {
      const client = await createAdminClient();
      const storage = new Storage(client);
      const tokens = new Tokens(client);
      const config = getConfig();
      const expire = new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString();
      await Promise.all(
        ids.map(async (fileId) => {
          let filename = fileId;
          try {
            const file = await storage.getFile({ bucketId: IMAGE_BUCKET, fileId });
            filename = file.name || fileId;
          } catch {
            throw new Error("Could not sign decision images.");
          }
          let token = "";
          try {
            const issued = await tokens.createFileToken({
              bucketId: IMAGE_BUCKET,
              fileId,
              expire,
            });
            token = issued.secret || "";
          } catch {
            token = "";
          }
          const view = new URL(
            `${config.endpoint.replace(/\/$/, "")}/storage/buckets/${IMAGE_BUCKET}/files/${fileId}/view`,
          );
          view.searchParams.set("project", config.projectId);
          if (token) view.searchParams.set("token", token);
          urls.set(fileId, { url: view.toString(), filename });
        }),
      );
    }
    return rows.map((row) => ({
      ...fromRow(row),
      images: (row.image_paths ?? []).map((path) => {
        const image = urls.get(path);
        if (!image) throw new Error("Missing signed image URL.");
        return { id: path, url: image.url, thumbnailUrl: image.url, filename: image.filename };
      }),
    }));
  }

  private async row(id: string) {
    validateDecisionId(id);
    try {
      return await (await this.db()).getRow<DecisionRow>({
        databaseId: DATABASE_ID,
        tableId: DECISIONS_TABLE,
        rowId: id,
      });
    } catch (error) {
      const status = (error as { code?: number; type?: string }).code;
      if (status === 404) throw new AppError("This decision could not be found.", 404);
      throw new Error("Could not read decision.");
    }
  }

  async list(status?: Status) {
    const db = await this.db();
    const decisions: Decision[] = [];
    const pageSize = 100;
    for (let offset = 0; ; offset += pageSize) {
      const queries = [Query.orderAsc("$createdAt"), Query.orderAsc("$id"), Query.limit(pageSize), Query.offset(offset)];
      if (status) queries.unshift(Query.equal("status", status.toLowerCase()));
      let page;
      try {
        page = await db.listRows<DecisionRow>({
          databaseId: DATABASE_ID,
          tableId: DECISIONS_TABLE,
          queries,
        });
      } catch {
        throw new Error("Could not list decisions.");
      }
      decisions.push(...(await this.signed(page.rows)));
      if (page.rows.length < pageSize) return decisions;
    }
  }

  async get(id: string) {
    return (await this.signed([await this.row(id)]))[0];
  }

  async create(input: NewDecision, uploads: ImageUpload[] = []) {
    if (input.imageUrls.length + uploads.length > 10)
      throw new AppError("Add up to 10 images in total.");
    const id = randomUUID();
    const images = [
      ...uploads.map(validateImage),
      ...(await Promise.all(input.imageUrls.map((url) => this.downloader(url)))),
    ];
    const storage = await this.storage();
    const paths: string[] = [];
    const results = await Promise.allSettled(
      images.map(async (image) => {
        const validated = validateImage(image);
        const fileId = randomUUID();
        await storage.createFile({
          bucketId: IMAGE_BUCKET,
          fileId,
          file: InputFile.fromBuffer(Buffer.from(validated.bytes), validated.filename),
        });
        paths.push(fileId);
        return fileId;
      }),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed) {
      if (paths.length)
        await Promise.all(
          paths.map((fileId) =>
            storage.deleteFile({ bucketId: IMAGE_BUCKET, fileId }).catch(() => undefined),
          ),
        );
      throw new Error("Could not upload decision images.");
    }
    const imagePaths = results.map((result) => (result as PromiseFulfilledResult<string>).value);
    try {
      const row = await (await this.db()).createRow<DecisionRow>({
        databaseId: DATABASE_ID,
        tableId: DECISIONS_TABLE,
        rowId: id,
        data: {
          question: input.question,
          context: input.context,
          options: input.options,
          area: input.area,
          waiting_on: input.waitingOn,
          deadline: input.deadline,
          status: "open",
          answer: "",
          custom_answer: "",
          version: 1,
          image_paths: imagePaths,
        },
      });
      return (await this.signed([row]))[0];
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code && code >= 400 && code < 500 && imagePaths.length)
        await Promise.all(
          imagePaths.map((fileId) =>
            storage.deleteFile({ bucketId: IMAGE_BUCKET, fileId }).catch(() => undefined),
          ),
        );
      throw new Error("Could not confirm decision creation.");
    }
  }

  async mutate(id: string, mutation: Mutation) {
    const current = await this.row(id);
    const updated = applyMutation(fromRow(current), mutation);
    const result = await (await this.db()).updateRows<DecisionRow>({
      databaseId: DATABASE_ID,
      tableId: DECISIONS_TABLE,
      data: {
        status: updated.status.toLowerCase() as RowStatus,
        answer: updated.answer,
        custom_answer: updated.customAnswer,
        answered_at: updated.answeredAt,
        version: current.version + 1,
      },
      queries: [Query.equal("$id", id), Query.equal("version", current.version)],
    });
    if (!result.total) throw new AppError("This decision changed or is locked. Refresh before trying again.", 409);
    const row = result.rows?.[0] ?? { ...current, ...{
      status: updated.status.toLowerCase() as RowStatus,
      answer: updated.answer,
      custom_answer: updated.customAnswer,
      answered_at: updated.answeredAt,
      version: current.version + 1,
    } };
    return (await this.signed([row]))[0];
  }
}
