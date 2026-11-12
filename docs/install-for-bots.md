# Install Decisions (for AI assistants)

Follow this guide exactly when installing Decisions for a new user. It is written for an assistant that can use a shell, the [Appwrite CLI](https://appwrite.io/docs/tooling/command-line/installation), and the Appwrite Console.

Do not invent hostnames, API keys, passwords, or email addresses. Do not print secrets in chat, in logs, or in the repository. Do not commit `.env`, `.env.local`, `.appwrite`, or credential files. Ask the user before creating a public GitHub repository or pushing.

There is no one-click Deploy-to-Appwrite button. The shortest path is: one Appwrite account, one project, a server API key, `appwrite push`, a Site deployment, a platform-generated domain, then first-run `/setup`.

## Security

Treat this repository as public from the first commit.

- Never write passwords, API keys, webhook secrets, personal emails, or `.env` / local config files into the tree.
- `.gitignore` already excludes `.env*`, `.appwrite`, and `credentials/`. `.env.example` has placeholders only.
- Store the server API key only in the Appwrite Console and in a local file with mode `600` that is not in git.
- After `/setup`, the agent API key and webhook secret are shown once. Save them in the user's vault or a secret store. Do not add them to the repo or to Site environment variables unless the user asks for a local fallback.

## What you need

- Node.js 22 or newer
- An [Appwrite Cloud](https://cloud.appwrite.io/) account (Free is enough to try)
- The Appwrite CLI (`npm install -g appwrite-cli`)
- The user's email for the workspace owner (ask; do not guess)
- A password the user chooses, collected through a secure form or vault — never invented and never written into chat

### Free plan

Appwrite Cloud **Free** projects pause after 7 days with no Console development activity. Runtime traffic does not reset that timer. Data is kept. Tell the user they should open the project in the [Console](https://cloud.appwrite.io/) at least once a week, or move to a paid plan, before this installation becomes a live inbox.

Regions available when this guide was written: `fra`, `nyc`, `syd`, `sfo`, `sgp`, `tor`. There is no São Paulo region. The API endpoint is `https://<region>.cloud.appwrite.io/v1`.

## 1. Create the project

1. Create or sign in to an Appwrite Cloud account with the user's email.
2. Create a project. Note the **project ID** and the regional **endpoint**.
3. The Console URL looks like `https://cloud.appwrite.io/console/project-<PROJECT_ID>` (or the current Console equivalent).

## 2. Create a server API key

In **Overview → Integrations → API keys**, create a server key with no expiry (or an expiry the user accepts). The secret is shown once. Save it privately. Never paste it into the repository, a README example, a screenshot, a chat message, or a build log.

Grant every scope below. Missing scopes are the usual reason `appwrite push` or the public URL fails. You can add scopes later; adding scopes does not rotate the secret, so do not rewrite the saved key file when you only change scopes.

**Schema, users, and first-run setup**

- `users.read`, `users.write`
- `sessions.write`
- `databases.read`, `databases.write`
- `tables.read`, `tables.write`, `columns.write`, `indexes.write`
- `collections.write` — required for `appwrite push table` to create columns. If a table push fails on columns, add this scope and retry. If the CLI still cannot create columns, create them with TablesDB commands from `appwrite.config.json`.
- `rows.read`, `rows.write`
- `buckets.read`, `buckets.write`, `files.read`, `files.write`
- `tokens.write`
- `project.write`, `project.policies.write` — so `/setup` can set a user-limit policy and close public sign-up

**Sites and the public domain**

- `sites.read`, `sites.write`
- `log.read` — this is the Sites logs scope. The name `logs.read` (plural) does not exist; do not use it.
- `rules.read`, `rules.write` — required to create the platform-generated public hostname. Without `rules.write`, the site can build and still have no public Visit URL.

## 3. Local environment

From the repository root:

```bash
cp .env.example .env.local
chmod 600 .env.local
```

Set only:

- `NEXT_PUBLIC_APPWRITE_ENDPOINT` — for example `https://nyc.cloud.appwrite.io/v1`
- `NEXT_PUBLIC_APPWRITE_PROJECT_ID` — the project ID
- `APPWRITE_API_KEY` — the server key from step 2

Leave `AGENT_API_KEY`, `DECISION_WEBHOOK_URL`, and `DECISION_WEBHOOK_SECRET` blank. `/setup` creates the agent key and webhook secret.

## 4. Link the CLI

```bash
npm install -g appwrite-cli
appwrite login
appwrite init project
```

Choose the existing project when prompted. Do not commit the `.appwrite` session folder.

## 5. Push the schema

```bash
appwrite push
```

If the CLI asks you to confirm tables, buckets, or sites, review the plan and accept only this project's resources:

- Database `inbox` (name Inbox)
- Tables `decisions`, `settings`, `allowed_emails` (indexes: `status` + `$createdAt` on `decisions`; unique `email` on `allowed_emails`)
- Bucket `decision-images` (3 MiB, `jpg` / `jpeg` / `png` / `webp` / `gif`)

`settings` also stores answer-notification status. On a project created before those columns existed, run `appwrite push` again so delivery results can be saved. Add them by hand if the CLI will not:

- `webhook_last_outcome` (string, 16, default empty) — `succeeded`, `failed`, or empty
- `webhook_last_at` (datetime, optional)
- `webhook_last_error` (string, 240, default empty) — safe text only, never the secret or the URL
- `webhook_last_kind` (string, 16, default empty) — `delivery` or `test`
- `webhook_last_url_hash` (string, 64, default empty) — SHA-256 of the URL that was checked

Until those columns exist, answering still works. The indicator stays “Not verified” because the result cannot be stored. Do not log or display `webhook_secret`.

If `appwrite push table` fails while creating columns, add `collections.write` to the key and retry, or create the columns with TablesDB to match `appwrite.config.json`.

## 6. Deploy the Site

The site definition in `appwrite.config.json` is:

- Site ID: `decisions-app`
- Framework: `nextjs`, adapter `ssr`
- Runtime: Node 22
- Install: `npm ci`
- Build: `npm run build`
- Output: `./.next`

Set **only** these Site environment variables (public, safe for the browser):

- `NEXT_PUBLIC_APPWRITE_ENDPOINT`
- `NEXT_PUBLIC_APPWRITE_PROJECT_ID`

Do **not** set `APPWRITE_API_KEY` as a Site variable. On Appwrite Sites, an ephemeral `x-appwrite-key` is injected at request time. Putting the server key in Site variables risks exposing it in a build log.

Grant the Site the request-key scopes listed in `appwrite.config.json`: `users.read`, `users.write`, `sessions.write`, `databases.read`, `tables.read`, `rows.read`, `rows.write`, `files.read`, `files.write`, `tokens.write`, `project.write`, `project.policies.write`.

If `appwrite push site` fails because `sites.read` or `sites.write` is missing, add those scopes (and `log.read`) and retry. To create a build without rewriting Site variables or inventing a hostname:

```bash
appwrite sites create-deployment --site-id decisions-app --activate
```

(Use the CLI's current flags if they differ; do not pass a domain or env file unless the user asked.)

Wait until the deployment is ready and activated.

## 7. Get the public URL

This step is easy to get wrong. Follow it literally.

- **Do not invent a domain** the user does not own. Do not register `something.appwrite.network` by guessing.
- A hostname like `https://decisions-app.appwrite.network` (the site ID as a subdomain) is **not** automatic and typically returns 404.
- `POST /proxy/rules/site` (`create-site-rule`) is for a **custom domain the user already owns**. It requires a valid `domain` parameter (`Param "domain" is not optional` / `Value must be a valid domain`). Do not call it without a domain the user provided.
- Deployment **preview** hosts (rule type `deployment`, trigger `deployment`) may be org-gated (`edge-preview-auth` / preview.appwrite.io). Those are not the public Visit URL. See [Sites previews](https://appwrite.io/docs/products/sites/previews).
- After the key has `rules.read` and `rules.write`, create the **platform-generated** domain with this command only — no variables, no invented hostname:

  ```bash
  appwrite push site --force --site-id decisions-app --no-code
  ```

- That creates a verified proxy rule and a URL of the form `https://<hex>.appwrite.network`. Official behavior is described at [Sites domains](https://appwrite.io/docs/products/sites/domains).
- Use **HTTPS**. Plain `http://` on the same host may return 500.

Confirm the setup page is reachable:

```bash
curl -sI "https://<hex>.appwrite.network/setup"
```

Expect HTTP 200, no redirect. The HTML title is “Decisions · A little clarity”. The page is the first-run form: owner email, password, repeat password, decision areas, optional webhook URL, and the button “Create owner and finish setup”.

## 8. First-run `/setup`

1. Open `https://<hex>.appwrite.network/setup`.
2. Owner email: the **user's** address. Do not hard-code an example email into a public file.
3. Password: at least 10 and at most 72 characters. Collect it with a secure form or the user's vault. Do not invent one. Do not print it.
4. Decision areas: comma-separated, up to 12 names, 40 characters each. Ask the user, or leave the form default.
5. Webhook URL: optional. Leave blank unless the user already has a receiver. The field must be an HTTP or HTTPS URL without credentials.
6. Submit **Create owner and finish setup**. Do not complete setup just to “try it” without the user's email and a password they chose.

The page then shows the **agent API key** and **webhook secret once**. Copy them into a secret store. They will not be shown again. The page then locks; later visits go to `/login`. After this, unknown emails cannot sign up. The owner is created already verified, so no confirmation email is required.

If setup returns “This workspace already has an owner,” sign in at `/login` instead. Do not reset or overwrite the owner unless the user asked.

## 9. Connect an assistant and test

Point the assistant at the new HTTPS origin only. Paths and payloads stay the same as the previous edition.

- Base URL: `https://<hex>.appwrite.network`
- `Authorization: Bearer <agent API key>` on `/api/agent/*`
- Create: `POST /api/agent/decisions` with JSON (`question`, `area`, optional `context`, `options`, `waitingOn`, `deadline`, `imageUrls`) or multipart (`decision` JSON plus `images` files)
- List or read: `GET /api/agent/decisions`, `GET /api/agent/decisions/:id`
- Mark an answered card as picked up: `POST /api/agent/decisions/:id/route` with `{ "expectedRevision": "<revision>" }`. **`expectedRevision` must be a string** (for example `"2"`), not a JSON number. A number returns an error such as “Decision version must be text.”
- Optional webhook: event name `decision.answered`. Headers: `X-Decisions-Event`, `X-Decisions-Signature: sha256=<hex>` of the raw body, `Authorization: Bearer <webhook secret>`. Delivery is attempted twice, with a 3 second timeout, and never follows redirects. JSON fields include `id`, `question`, `area`, `waiting_on`, `answer`, `custom_answer`, `answered_at`.

### Answer notification status

The inbox and `/settings` show whether notifications are working. Do not tell the user they work just because a URL is saved.

| State                | Meaning                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Not configured       | No webhook URL in settings and no `DECISION_WEBHOOK_URL`                                                                     |
| Not verified         | A URL is saved, but this URL has not had a successful test or delivery                                                       |
| Working              | The last test or the last real delivery returned HTTP 2xx                                                                    |
| Last delivery failed | The last attempt failed. The message is a short safe sentence and does not include the secret, the URL, or the response body |

To configure it:

1. Obtain or create an HTTPS receiver for the user’s decision-answered automation, plus a shared secret. Do not hardcode a product routine ID, a personal email, or a live hostname.
2. Sign in as the owner and open `/settings`. Set **Answer webhook URL** (`webhookUrl`) and, when you have the shared secret, **Webhook secret** (`webhookSecret`, write-only, 16–256 characters). Leave the secret blank to keep the one `/setup` generated. Saving a new URL or secret marks the indicator “Not verified”.
3. Press **Send test notification**. That POSTs event `webhook.test` with `"test": true` and does not create a card. Ignore that event except as a connectivity check.
4. Success is: the receiver returns HTTP 2xx within 3 seconds without a redirect, the HMAC over the raw body matches `X-Decisions-Signature`, and the indicator says **Working**. Then answer one test card and confirm event `decision.answered`.

If the indicator is not Working, use **How a bot can set this up**. It copies the same steps. Settings values override `DECISION_WEBHOOK_URL` and `DECISION_WEBHOOK_SECRET` when set. Do not put the secret in git or in Site variables.

Run a side-by-side test before moving any production cards: create a test card, answer it in the UI, confirm the indicator says Working if a webhook is configured, call `/route` with the revision as text, then delete the test card. Do not change a previous live deployment (for example a Vercel + Supabase site) until the user agrees to cut over.

## 10. Automated checks

```bash
npm ci
npm test
npm run typecheck
npm run lint
```

To try the UI without Appwrite, leave the Appwrite variables unset and run `npm run dev`. That starts a temporary in-memory inbox that resets when the process stops.

## Troubleshooting

| Symptom                                  | What to do                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `appwrite push table` fails on columns   | Add `collections.write` to the server key and retry, or create columns with TablesDB.                                                |
| `appwrite push site` fails on permission | Add `sites.read`, `sites.write`, and `log.read` (`log.read`, not `logs.read`).                                                       |
| Site is built but there is no public URL | Add `rules.read` and `rules.write`, then run `appwrite push site --force --site-id decisions-app --no-code`. Do not invent a domain. |
| `create-site-rule` asks for `domain`     | That API is custom-domain only. Stop unless the user gave a domain they own.                                                         |
| Preview hostname asks for org sign-in    | That is not the public URL. Use the generated `https://<hex>.appwrite.network` rule instead.                                         |
| `http://` returns 500                    | Use `https://`.                                                                                                                      |
| `/setup` is not a form                   | Confirm the deployment is active, public env vars are set, and you are on the generated HTTPS domain.                                |
| Agent `/route` rejects the body          | Send `expectedRevision` as a string.                                                                                                 |

## What not to do

- Do not migrate production cards until the new install has been tested.
- Do not put `APPWRITE_API_KEY` in Site environment variables or in git.
- Do not publish the repository until a security review has confirmed there are no secrets, and the user has said yes to making it public.
