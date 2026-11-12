import "server-only";
import { Query, TablesDB, type Models } from "node-appwrite";
import { AppError, DEFAULT_AREAS, parseAreas } from "../domain";
import { createAdminClient } from "./admin";
import { ALLOWED_EMAILS_TABLE, DATABASE_ID, SETTINGS_ROW_ID, SETTINGS_TABLE } from "./ids";

export type AppSettings = {
  ownerUserId: string;
  ownerEmail: string;
  areas: string[];
  agentApiKeyHash: string;
  webhookUrl: string;
  webhookSecret: string;
  setupComplete: boolean;
};

type SettingsRow = Models.Row & {
  $id: string;
  owner_user_id?: string;
  owner_email?: string;
  areas?: string[];
  agent_api_key_hash?: string;
  webhook_url?: string;
  webhook_secret?: string;
  setup_complete?: boolean;
};

function fromRow(row: SettingsRow): AppSettings {
  return {
    ownerUserId: row.owner_user_id || "",
    ownerEmail: (row.owner_email || "").toLowerCase(),
    areas: row.areas?.length ? parseAreas(row.areas.join(",")) : [...DEFAULT_AREAS],
    agentApiKeyHash: row.agent_api_key_hash || "",
    webhookUrl: row.webhook_url || "",
    webhookSecret: row.webhook_secret || "",
    setupComplete: Boolean(row.setup_complete),
  };
}

export async function getSettings(): Promise<AppSettings | null> {
  const tables = new TablesDB(await createAdminClient());
  try {
    const row = await tables.getRow<SettingsRow>({
      databaseId: DATABASE_ID,
      tableId: SETTINGS_TABLE,
      rowId: SETTINGS_ROW_ID,
    });
    return fromRow(row);
  } catch {
    return null;
  }
}

export async function getDecisionAreas() {
  const settings = await getSettings();
  return settings?.areas ?? [...DEFAULT_AREAS];
}

export async function listAllowedEmails() {
  const tables = new TablesDB(await createAdminClient());
  const emails: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await tables.listRows<Models.Row & { email: string }>({
      databaseId: DATABASE_ID,
      tableId: ALLOWED_EMAILS_TABLE,
      queries: [Query.limit(100), Query.offset(offset)],
    });
    emails.push(...page.rows.map((row) => row.email.toLowerCase()));
    if (page.rows.length < 100) return emails;
  }
}

export async function isEmailAllowed(email: string) {
  const list = await listAllowedEmails();
  return list.includes(email.trim().toLowerCase());
}

export async function updateWorkspaceSettings(input: { areas?: string[]; webhookUrl?: string }) {
  const tables = new TablesDB(await createAdminClient());
  const current = await getSettings();
  if (!current?.setupComplete) throw new AppError("Finish first-run setup first.", 409);
  const data: Record<string, unknown> = {};
  if (input.areas) data.areas = input.areas;
  if (input.webhookUrl !== undefined) data.webhook_url = input.webhookUrl;
  if (!Object.keys(data).length) return current;
  await tables.updateRow({
    databaseId: DATABASE_ID,
    tableId: SETTINGS_TABLE,
    rowId: SETTINGS_ROW_ID,
    data,
  });
  return (await getSettings())!;
}
