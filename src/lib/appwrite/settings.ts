import "server-only";
import { Query, TablesDB, type Models } from "node-appwrite";
import { getConfig } from "../config";
import { AppError, DEFAULT_AREAS, parseAreas } from "../domain";
import { persistableWebhookError, webhookUrlHash, type WebhookKind } from "../webhook-status";
import { createAdminClient } from "./admin";
import { ALLOWED_EMAILS_TABLE, DATABASE_ID, SETTINGS_ROW_ID, SETTINGS_TABLE } from "./ids";

export type AppSettings = {
  ownerUserId: string;
  ownerEmail: string;
  areas: string[];
  agentApiKeyHash: string;
  webhookUrl: string;
  webhookSecret: string;
  webhookLastOutcome: string;
  webhookLastAt: string | null;
  webhookLastError: string;
  webhookLastKind: string;
  webhookLastUrlHash: string;
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
  webhook_last_outcome?: string;
  webhook_last_at?: string | null;
  webhook_last_error?: string;
  webhook_last_kind?: string;
  webhook_last_url_hash?: string;
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
    webhookLastOutcome: row.webhook_last_outcome || "",
    webhookLastAt: row.webhook_last_at || null,
    webhookLastError: row.webhook_last_error || "",
    webhookLastKind: row.webhook_last_kind || "",
    webhookLastUrlHash: row.webhook_last_url_hash || "",
    setupComplete: Boolean(row.setup_complete),
  };
}

const CLEARED_WEBHOOK_STATUS = {
  webhook_last_outcome: "",
  webhook_last_at: null,
  webhook_last_error: "",
  webhook_last_kind: "",
  webhook_last_url_hash: "",
};

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

export async function updateWorkspaceSettings(input: {
  areas?: string[];
  webhookUrl?: string;
  webhookSecret?: string;
}) {
  const tables = new TablesDB(await createAdminClient());
  const current = await getSettings();
  if (!current?.setupComplete) throw new AppError("Finish first-run setup first.", 409);
  const data: Record<string, unknown> = {};
  let resetDelivery = false;
  if (input.areas) data.areas = input.areas;
  if (input.webhookUrl !== undefined) {
    data.webhook_url = input.webhookUrl;
    if (input.webhookUrl !== current.webhookUrl) resetDelivery = true;
  }
  if (input.webhookSecret) {
    const secret = input.webhookSecret;
    if (
      secret !== secret.trim() ||
      /[\r\n]/.test(secret) ||
      secret.length < 16 ||
      secret.length > 256
    )
      throw new AppError("Webhook secret must be a single line of 16 to 256 characters.");
    data.webhook_secret = secret;
    resetDelivery = true;
  }
  if (resetDelivery) Object.assign(data, CLEARED_WEBHOOK_STATUS);
  if (!Object.keys(data).length) return current;
  await tables.updateRow({
    databaseId: DATABASE_ID,
    tableId: SETTINGS_TABLE,
    rowId: SETTINGS_ROW_ID,
    data,
  });
  return (await getSettings())!;
}

/** Records a delivery or test against the settings row. The secret is never written here. */
export async function recordWebhookAttempt(input: {
  url: string;
  outcome: "succeeded" | "failed";
  error: string;
  kind: WebhookKind;
  at: string;
}) {
  if (getConfig().mock) return;
  const tables = new TablesDB(await createAdminClient());
  const error = persistableWebhookError(input.error);
  await tables.updateRow({
    databaseId: DATABASE_ID,
    tableId: SETTINGS_TABLE,
    rowId: SETTINGS_ROW_ID,
    data: {
      webhook_last_outcome: input.outcome,
      webhook_last_at: input.at,
      webhook_last_error: input.outcome === "succeeded" ? "" : error,
      webhook_last_kind: input.kind,
      webhook_last_url_hash: webhookUrlHash(input.url),
    },
  });
}
