import "server-only";
import { Account, Client, ID, Project, Query, TablesDB, Users, type Models } from "node-appwrite";
import { AppError, parseAreas, DEFAULT_AREAS } from "./domain";
import { checkToken, hashToken, randomSecret } from "./crypto";
import { readEnv } from "./env";
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, passwordBytes } from "./password";
import { createAdminClient } from "./appwrite/admin";
import { ALLOWED_EMAILS_TABLE, DATABASE_ID, SETTINGS_ROW_ID, SETTINGS_TABLE } from "./appwrite/ids";
import { getSettings } from "./appwrite/settings";
import { getConfig } from "./config";
import {
  assertAccountCreationAllowed,
  assertLoginAllowed,
  assertSetupTokenAttemptAllowed,
  releasesLoginReservation,
} from "./throttle";
import { resolvePublicWebhook, webhookUrlError } from "./webhook-url";

export type SetupInput = {
  email: string;
  password: string;
  areas: string;
  webhookUrl?: string;
  setupToken?: string;
  currentPassword?: string;
};

export type SetupResult = {
  agentApiKey: string;
  webhookSecret: string;
};

const SETUP_TOKEN_MIN = 32;
const CLAIM_TTL_MS = 10 * 60 * 1000;
const ALREADY_OWNED = "This workspace already has an owner. Sign in instead.";
const IN_PROGRESS = "Setup is already in progress. Wait a few minutes and try again.";

type SettingsRecord = Models.Row & {
  owner_user_id?: string;
  owner_email?: string;
  areas?: string[];
  agent_api_key_hash?: string;
  webhook_url?: string;
  webhook_secret?: string;
  setup_complete?: boolean;
  setup_claim?: string;
  setup_claim_until?: string;
};

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return 0;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : 0;
}

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
    throw new AppError(
      error instanceof Error
        ? error.message.replace(/^NEXT_PUBLIC_DECISION_AREAS: /, "")
        : "Enter a valid list of areas.",
    );
  }
  const webhookUrl = (input.webhookUrl || "").trim();
  const webhookProblem = webhookUrl ? webhookUrlError(webhookUrl) : null;
  if (webhookProblem) throw new AppError(webhookProblem);
  const currentPassword = input.currentPassword || "";
  if (currentPassword && passwordBytes(currentPassword) > PASSWORD_MAX_BYTES)
    throw new AppError(`Use at most ${PASSWORD_MAX_BYTES} characters.`);
  return {
    email,
    password,
    areas,
    webhookUrl,
    setupToken: (input.setupToken || "").trim(),
    currentPassword,
  };
}

async function assertInstallationToken(presented: string) {
  const expected = readEnv("SETUP_TOKEN");
  if (expected.length < SETUP_TOKEN_MIN)
    throw new AppError("Set a long SETUP_TOKEN on the server before first-run setup.", 503);
  const gate = await assertSetupTokenAttemptAllowed();
  if (!presented || !checkToken(presented, expected))
    throw new AppError("The installation token is incorrect.", 403);
  gate.cancel();
}

async function readSettings(tables: TablesDB): Promise<SettingsRecord | null> {
  try {
    return await tables.getRow<SettingsRecord>({
      databaseId: DATABASE_ID,
      tableId: SETTINGS_TABLE,
      rowId: SETTINGS_ROW_ID,
    });
  } catch (error) {
    if (errorCode(error) === 404) return null;
    throw error;
  }
}

function claimIsActive(row: SettingsRecord, now = Date.now()) {
  if (!row.setup_claim) return false;
  const until = Date.parse(row.setup_claim_until || "");
  if (!Number.isFinite(until)) return true;
  return until > now;
}

function wroteOne(result: { total?: number; rows?: unknown[] }) {
  const count = result.rows?.length ?? 0;
  return count === 1 || (count === 0 && result.total === 1);
}

/** Conditional write: only the current claim can change a workspace that is not finished. */
async function casSettings(tables: TablesDB, expectedClaim: string, data: Record<string, unknown>) {
  const result = await tables.updateRows<SettingsRecord>({
    databaseId: DATABASE_ID,
    tableId: SETTINGS_TABLE,
    queries: [
      Query.equal("$id", SETTINGS_ROW_ID),
      Query.equal("setup_complete", false),
      Query.equal("setup_claim", expectedClaim),
    ],
    data,
  });
  return wroteOne(result) ? result : null;
}

function claimExpiry() {
  return new Date(Date.now() + CLAIM_TTL_MS).toISOString();
}

async function acquireClaim(tables: TablesDB, email: string, claim: string) {
  const existing = await readSettings(tables);
  if (existing?.setup_complete) throw new AppError(ALREADY_OWNED, 409);
  if (!existing) {
    try {
      await tables.createRow({
        databaseId: DATABASE_ID,
        tableId: SETTINGS_TABLE,
        rowId: SETTINGS_ROW_ID,
        data: {
          owner_email: email,
          areas: [],
          setup_complete: false,
          owner_user_id: "",
          agent_api_key_hash: "",
          webhook_url: "",
          webhook_secret: "",
          setup_claim: claim,
          setup_claim_until: claimExpiry(),
        },
      });
    } catch (error) {
      if (errorCode(error) !== 409) throw error;
      await takeOverClaim(tables, email, claim);
    }
  } else {
    await takeOverClaim(tables, email, claim, existing);
  }
  const owned = await readSettings(tables);
  if (!owned || owned.setup_complete || owned.setup_claim !== claim)
    throw new AppError(owned?.setup_complete ? ALREADY_OWNED : IN_PROGRESS, 409);
}

async function takeOverClaim(
  tables: TablesDB,
  email: string,
  claim: string,
  known?: SettingsRecord | null,
) {
  const row = known ?? (await readSettings(tables));
  if (!row)
    throw new AppError(
      "We couldn’t finish setup. Check your Appwrite configuration and try again.",
      503,
    );
  if (row.setup_complete) throw new AppError(ALREADY_OWNED, 409);
  // An in-progress claim stays with whoever holds it. An expired or released
  // claim can be taken, including with a different email.
  if (claimIsActive(row)) throw new AppError(IN_PROGRESS, 409);
  const updated = await casSettings(tables, row.setup_claim || "", {
    setup_claim: claim,
    setup_claim_until: claimExpiry(),
    owner_email: email,
  });
  if (!updated) throw new AppError(IN_PROGRESS, 409);
}

async function releaseClaim(tables: TablesDB, claim: string) {
  await casSettings(tables, claim, {
    setup_claim: "",
    setup_claim_until: new Date(0).toISOString(),
    owner_email: "",
  });
}

function warnSessionCleanup(error: unknown) {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  console.warn("[Decisions] Setup could not delete its verification session.", {
    ...(typeof code === "number" ? { code } : {}),
  });
}

async function ensureOwnerUser(
  client: Awaited<ReturnType<typeof createAdminClient>>,
  input: { email: string; password: string; currentPassword: string },
) {
  const users = new Users(client);
  const listed = await users.list({ queries: [Query.equal("email", input.email)] });
  const found = listed.users.find((user) => user.email?.toLowerCase() === input.email);
  if (found) {
    if (!input.currentPassword)
      throw new AppError(
        "This email already has an Appwrite account. Enter its current password. Setup will not replace that password.",
        401,
      );
    const gate = await assertLoginAllowed(input.email);
    const account = new Account(client);
    let session;
    try {
      session = await account.createEmailPasswordSession({
        email: input.email,
        password: input.currentPassword,
      });
    } catch (error) {
      if (releasesLoginReservation(error)) {
        gate.cancel();
        throw new AppError("Sign-in is temporarily unavailable. Please try again shortly.", 503);
      }
      throw new AppError("The current password is incorrect.", 401);
    }
    try {
      if (!session.secret) {
        gate.cancel();
        throw new AppError("Sign-in is temporarily unavailable. Please try again shortly.", 503);
      }
      if (input.password !== input.currentPassword) {
        const config = getConfig();
        const userClient = new Client()
          .setEndpoint(config.endpoint)
          .setProject(config.projectId)
          .setSession(session.secret);
        try {
          await new Account(userClient).updatePassword({
            password: input.password,
            oldPassword: input.currentPassword,
          });
        } catch (error) {
          if (releasesLoginReservation(error)) gate.cancel();
          throw error;
        }
      }
      gate.cancel();
    } finally {
      if (session.$id) {
        await users
          .deleteSession({ userId: found.$id, sessionId: session.$id })
          .catch(warnSessionCleanup);
      }
    }
    await users
      .updateEmailVerification({ userId: found.$id, emailVerification: true })
      .catch(() => {});
    return { userId: found.$id, total: Math.max(listed.total, 1) };
  }

  await assertAccountCreationAllowed(input.email);
  const user = await users.create({
    userId: ID.unique(),
    email: input.email,
    password: input.password,
    name: input.email,
  });
  await users
    .updateEmailVerification({ userId: user.$id, emailVerification: true })
    .catch(() => {});
  return { userId: user.$id, total: Math.max(listed.total, 1) };
}

export async function completeSetup(raw: SetupInput): Promise<SetupResult> {
  const input = parseSetupInput(raw);
  await assertInstallationToken(input.setupToken);
  if (input.webhookUrl) await resolvePublicWebhook(input.webhookUrl);

  const client = await createAdminClient();
  const tables = new TablesDB(client);
  const claim = randomSecret();
  await acquireClaim(tables, input.email, claim);

  let committed = false;
  try {
    const owner = await ensureOwnerUser(client, input);
    const held = await readSettings(tables);
    if (!held || held.setup_complete || held.setup_claim !== claim)
      throw new AppError(held?.setup_complete ? ALREADY_OWNED : IN_PROGRESS, 409);

    const existingEmails = await tables.listRows<Models.Row & { email: string }>({
      databaseId: DATABASE_ID,
      tableId: ALLOWED_EMAILS_TABLE,
      queries: [],
    });
    if (!existingEmails.rows.some((row) => row.email.toLowerCase() === input.email)) {
      try {
        await tables.createRow({
          databaseId: DATABASE_ID,
          tableId: ALLOWED_EMAILS_TABLE,
          rowId: ID.unique(),
          data: { email: input.email },
        });
      } catch (error) {
        if (errorCode(error) !== 409) throw error;
      }
    }

    const agentApiKey = randomSecret();
    const webhookSecret = randomSecret();
    const hash = hashToken(agentApiKey);
    const saved = await casSettings(tables, claim, {
      owner_user_id: owner.userId,
      owner_email: input.email,
      areas: input.areas,
      agent_api_key_hash: hash,
      webhook_url: input.webhookUrl,
      webhook_secret: webhookSecret,
      setup_complete: true,
      setup_claim: claim,
    });
    if (!saved) throw new AppError(ALREADY_OWNED, 409);
    const confirmed = await readSettings(tables);
    if (
      !confirmed?.setup_complete ||
      confirmed.setup_claim !== claim ||
      confirmed.agent_api_key_hash !== hash ||
      confirmed.webhook_secret !== webhookSecret
    )
      throw new AppError(ALREADY_OWNED, 409);
    committed = true;

    try {
      const project = new Project(client);
      await project.updateUserLimitPolicy({ total: owner.total });
    } catch {
      /* Allowlist still blocks unknown emails if the policy cannot be set. */
    }
    return { agentApiKey, webhookSecret };
  } finally {
    if (!committed) await releaseClaim(tables, claim).catch(() => {});
  }
}

export async function setupIsLocked() {
  const settings = await getSettings();
  return Boolean(settings?.setupComplete);
}
