import "server-only";
import { ID, Project, Query, TablesDB, Users, type Models } from "node-appwrite";
import { AppError, isWebUrl, parseAreas, DEFAULT_AREAS } from "./domain";
import { hashToken, randomSecret } from "./crypto";
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, passwordBytes } from "./password";
import { createAdminClient } from "./appwrite/admin";
import {
  ALLOWED_EMAILS_TABLE,
  DATABASE_ID,
  SETTINGS_ROW_ID,
  SETTINGS_TABLE,
} from "./appwrite/ids";
import { getSettings } from "./appwrite/settings";

export type SetupInput = {
  email: string;
  password: string;
  areas: string;
  webhookUrl?: string;
};

export type SetupResult = {
  agentApiKey: string;
  webhookSecret: string;
};

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email))
    throw new AppError("Enter a valid email address.");
  return email;
}

export function parseSetupInput(input: SetupInput) {
  const email = normalizeEmail(input.email);
  const password = input.password;
  if (password.length < PASSWORD_MIN_LENGTH)
    throw new AppError(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (passwordBytes(password) > PASSWORD_MAX_BYTES)
    throw new AppError(`Use at most ${PASSWORD_MAX_BYTES} characters.`);
  let areas;
  try {
    areas = parseAreas(input.areas || DEFAULT_AREAS.join(","));
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message.replace(/^NEXT_PUBLIC_DECISION_AREAS: /, "") : "Enter a valid list of areas.");
  }
  const webhookUrl = (input.webhookUrl || "").trim();
  if (webhookUrl && !isWebUrl(webhookUrl))
    throw new AppError("Use an HTTP or HTTPS webhook URL without credentials.");
  return { email, password, areas, webhookUrl };
}

async function alreadyComplete(tables: TablesDB) {
  try {
    const row = await tables.getRow<Models.Row & { setup_complete?: boolean; owner_email?: string }>({
      databaseId: DATABASE_ID,
      tableId: SETTINGS_TABLE,
      rowId: SETTINGS_ROW_ID,
    });
    return row;
  } catch {
    return null;
  }
}

export async function completeSetup(raw: SetupInput): Promise<SetupResult> {
  const input = parseSetupInput(raw);
  const client = await createAdminClient();
  const tables = new TablesDB(client);
  const existing = await alreadyComplete(tables);
  if (existing?.setup_complete)
    throw new AppError("This workspace already has an owner. Sign in instead.", 409);
  if (existing?.owner_email && existing.owner_email.toLowerCase() !== input.email)
    throw new AppError("Setup was started with a different email.", 409);

  if (!existing) {
    try {
      await tables.createRow({
        databaseId: DATABASE_ID,
        tableId: SETTINGS_TABLE,
        rowId: SETTINGS_ROW_ID,
        data: {
          owner_email: input.email,
          areas: input.areas,
          setup_complete: false,
          owner_user_id: "",
          agent_api_key_hash: "",
          webhook_url: input.webhookUrl,
          webhook_secret: "",
        },
      });
    } catch (error) {
      const again = await alreadyComplete(tables);
      if (again?.setup_complete)
        throw new AppError("This workspace already has an owner. Sign in instead.", 409);
      if (again?.owner_email && again.owner_email.toLowerCase() !== input.email)
        throw new AppError("Setup was started with a different email.", 409);
      if (!again) throw error;
    }
  }

  const users = new Users(client);
  let userId = "";
  const listed = await users.list({ queries: [Query.equal("email", input.email)] });
  const found = listed.users.find((user) => user.email?.toLowerCase() === input.email);
  if (found) {
    userId = found.$id;
    await users.updatePassword({ userId, password: input.password });
  } else {
    const user = await users.create({
      userId: ID.unique(),
      email: input.email,
      password: input.password,
      name: input.email,
    });
    userId = user.$id;
  }
  try {
    await users.updateEmailVerification({ userId, emailVerification: true });
  } catch {
    /* Verification is optional for login; continue setup. */
  }

  const existingEmails = await tables.listRows<Models.Row & { email: string }>({
    databaseId: DATABASE_ID,
    tableId: ALLOWED_EMAILS_TABLE,
    queries: [],
  });
  if (!existingEmails.rows.some((row) => row.email.toLowerCase() === input.email)) {
    await tables.createRow({
      databaseId: DATABASE_ID,
      tableId: ALLOWED_EMAILS_TABLE,
      rowId: ID.unique(),
      data: { email: input.email },
    });
  }

  const agentApiKey = randomSecret();
  const webhookSecret = randomSecret();
  await tables.updateRow({
    databaseId: DATABASE_ID,
    tableId: SETTINGS_TABLE,
    rowId: SETTINGS_ROW_ID,
    data: {
      owner_user_id: userId,
      owner_email: input.email,
      areas: input.areas,
      agent_api_key_hash: hashToken(agentApiKey),
      webhook_url: input.webhookUrl,
      webhook_secret: webhookSecret,
      setup_complete: true,
    },
  });

  try {
    const project = new Project(client);
    await project.updateUserLimitPolicy({ total: Math.max(listed.total, 1) });
  } catch {
    /* Allowlist still blocks unknown emails if the policy cannot be set. */
  }

  return { agentApiKey, webhookSecret };
}

export async function setupIsLocked() {
  const settings = await getSettings().catch(() => null);
  return Boolean(settings?.setupComplete);
}
