# Decisions

A human-in-the-loop inbox for AI agents. Assistants post questions; you answer them in a focused web UI; a signed webhook can tell the assistant the answer.

This tree is the **Appwrite** edition. The existing Vercel + Supabase deployment is a separate project and is not modified here.

## What you get

- Next.js App Router UI with email + password sign-in (no public sign-up)
- First-run `/setup` page that creates the owner, stores areas, and shows the agent API key and webhook secret once
- Agent API with the same contract as before:
  - `POST` / `GET` `/api/agent/decisions`
  - `GET` `/api/agent/decisions/:id`
  - `POST` `/api/agent/decisions/:id/route` with `{ expectedRevision }`
  - `Authorization: Bearer <AGENT_API_KEY>`
- Outbound `decision.answered` webhook (HMAC-SHA256 `X-Decisions-Signature` plus `Authorization: Bearer`) delivered by the app itself to a public HTTPS URL
- Optional demo mode when `DECISIONS_DEMO=1` and Appwrite is not configured (never in production)

There is **no** one-click “Deploy to Appwrite” button. The shortest path is: one Appwrite account, `appwrite push`, deploy the site, then open `/setup`.

## Free plan note

Appwrite Cloud **Free** projects pause after 7 days with no Console development activity. Runtime traffic does not reset that timer. Data is kept. Visit the project in the [Appwrite Console](https://cloud.appwrite.io/) at least once a week, or use a paid plan with no pause.

## Requirements

- Node.js 22 or newer
- An [Appwrite Cloud](https://cloud.appwrite.io/) account (Free is enough to try)
- The [Appwrite CLI](https://appwrite.io/docs/tooling/command-line/installation)

## Install (new workspace)

1. Create an Appwrite project (or use an existing one). Note the **project ID** and the API **endpoint** for your region, for example `https://nyc.cloud.appwrite.io/v1`.
2. In **Overview → Integrations → API keys**, create a server key for local setup and CLI work. Grant every scope below (missing ones are the usual reason a push or the public URL fails):
   - `users.read`, `users.write`
   - `sessions.write`
   - `databases.read`, `databases.write`
   - `tables.read`, `tables.write`, `columns.write`, `indexes.write`
   - `collections.write` (needed for `appwrite push table` to create columns)
   - `rows.read`, `rows.write`
   - `buckets.read`, `buckets.write`, `files.read`, `files.write`
   - `tokens.write`
   - `project.write`, `project.policies.write` (so setup can set a user-limit policy and turn off public sign-up)
   - `sites.read`, `sites.write`, `log.read` (Sites group; the name `logs.read` does not exist)
   - `rules.read`, `rules.write` (needed to create the platform-generated public domain)
     Copy the key once. It never belongs in git. Adding scopes later does not rotate the secret.
3. Copy `.env.example` to `.env.local` and fill in the endpoint, project ID, and server key. Generate a long random `SETUP_TOKEN` (`openssl rand -base64 32`) and put it only in that file. Leave `AGENT_API_KEY` and webhook values blank; `/setup` will create them.
4. Log in to the CLI and link this folder to the project:

   ```bash
   npm install -g appwrite-cli
   appwrite login
   appwrite init project
   ```

   When prompted, choose the existing project. Do not commit the `.appwrite` session folder.

5. Push the database, tables, and bucket (and optionally the site definition) from `appwrite.config.json`:

   ```bash
   appwrite push
   ```

   If the CLI asks you to confirm tables, buckets, or sites, review the plan and accept only this project's resources (`inbox`, `decisions`, `settings`, `allowed_emails`, `decision-images`).

6. Run the app locally:

   ```bash
   npm ci
   npm run dev
   ```

   Open http://localhost:3000/setup. Enter the installation token, **your** email, and a password (at least 10 characters). If that email already has an Appwrite account, also enter its current password — setup will not replace it unless that password is correct. Add the decision areas and an optional public HTTPS webhook URL. Copy the agent API key and webhook secret that appear **once**, then sign in at `/login`. Unset `SETUP_TOKEN` after setup.

7. To host the Next.js app on [Appwrite Sites](https://appwrite.io/docs/products/sites), push or create a Site in this project (framework `nextjs`, `npm ci`, `npm run build`, output `./.next`, Node 22). Set `NEXT_PUBLIC_APPWRITE_ENDPOINT` and `NEXT_PUBLIC_APPWRITE_PROJECT_ID` as Site environment variables, plus a server-only `SETUP_TOKEN` (never `NEXT_PUBLIC_`). Grant the Site the scopes listed in `appwrite.config.json`. On Sites, an ephemeral `x-appwrite-key` is injected at request time, so you should not put `APPWRITE_API_KEY` in the repo, in Site variables, or in a public build log. Unset `SETUP_TOKEN` after setup.
8. Give the site a public URL. Do **not** invent a hostname the user does not own, and do not guess `https://<site-id>.appwrite.network` (that typically 404s). The Console “add domain” flow and `POST /proxy/rules/site` are for a **custom domain you already own**. Preview hosts can be org-gated and are not the public Visit URL. After the API key has `rules.write`, create a [platform-generated domain](https://appwrite.io/docs/products/sites/domains) with:

   ```bash
   appwrite push site --force --site-id decisions-app --no-code
   ```

   That yields a URL like `https://<hex>.appwrite.network`. Use **HTTPS** (plain `http://` may return 500). Then open `/setup` and create the owner as in step 6. For the full assistant playbook, including failure recovery, see [docs/install-for-bots.md](docs/install-for-bots.md).

### Demo without Appwrite

```bash
npm ci
npm test
DECISIONS_DEMO=1 npm run dev
```

With Appwrite variables unset and `DECISIONS_DEMO=1`, outside production, the app runs a temporary in-memory inbox. It resets when the process restarts. Demo mode does not send webhooks. Production without Appwrite configuration does not enter demo mode.

## Agent and webhook contract

Bots should only need a new base URL after you cut over. The paths, JSON bodies, bearer header, and webhook shape stay the same.

- Create a decision: `POST /api/agent/decisions` with JSON (`question`, `area`, optional `context`, `options`, `waitingOn`, `deadline`, `imageUrls`) or multipart (`decision` JSON plus `images` files).
- List or read: `GET /api/agent/decisions`, `GET /api/agent/decisions/:id`.
- Mark an answered card as picked up: `POST /api/agent/decisions/:id/route` with `{ "expectedRevision": "<revision>" }`.
- Webhook event: `decision.answered`. Headers: `X-Decisions-Event`, `X-Decisions-Signature: sha256=<hex>`, `Authorization: Bearer <webhook secret>`. The destination must be public HTTPS with no credentials. Delivery is attempted twice. Each attempt, including name lookup, is limited to 3 seconds and never follows redirects. The connection uses the address that passed that check. Demo mode does not deliver.

See [docs/install-for-bots.md](docs/install-for-bots.md) for step-by-step install instructions written for an AI assistant (create the project, set the API key and env, push schema, deploy the Site, create the generated domain, run `/setup`, connect the agent API and webhook, and run the test).

## Tests

```bash
npm ci
npm test
npm run typecheck
npm run lint
```

Important coverage includes setup locking, the installation token, sign-in allowlisting and throttling, agent bearer auth (database hash, or the env key only when no hash exists and the fallback is enabled), webhook HTTPS checks and HMAC signing, and optimistic concurrency (`409` on a stale revision).

## Security

- Never commit `.env`, `.env.local`, `.appwrite`, API keys, webhook secrets, installation tokens, or personal emails or decision data.
- `.env.example` contains placeholders only.
- `/setup` requires `SETUP_TOKEN`. After setup completes, another request cannot change the owner, password, webhook, or secrets. Unset the token when you are done.
- An existing Appwrite password is changed only after the current password is checked, and only through that password. The admin API is not used to replace it.
- Only the workspace owner can change areas and the webhook URL. The signing secret is not shown again and is not returned to other members.
- Webhook URLs must be public HTTPS. Loopback, private, link-local, and reserved addresses are rejected. Demo mode does not send webhooks.
- Sign-in and admin account creation are throttled in the application.
- The agent credential stored at setup (SHA-256 hash) is the only accepted key once it exists. `AGENT_API_KEY` works in demo mode, or before a hash exists when `AGENT_API_KEY_FALLBACK=1`. Replace the stored hash to rotate or revoke that key. Unset the env var and the fallback flag to revoke the env key. Clearing the hash does not by itself disable a fallback you left enabled.
- The first-run setup page is the only place a new owner is created. After that, unknown emails cannot sign up.
- Image files are stored in a private bucket; list/get responses include short-lived view URLs.
- Do not invent or register a domain the project does not own. Use the generated `appwrite.network` hostname, or a custom domain the user already controls.
- Before publishing this repository, review the tree for secrets, run a fresh install from the bot guide, and get the owner's approval.

## Project layout

```
appwrite.config.json        Database, tables, bucket, and site definition for `appwrite push`
src/app/setup/              First-run owner setup
src/app/api/agent/          Agent REST API
src/lib/appwrite/           Server clients, session cookie, settings
src/lib/stores/appwrite.ts  TablesDB + Storage adapter
src/lib/answer-webhook.ts   Signed decision.answered delivery
docs/install-for-bots.md    Step-by-step install playbook for AI assistants
```

## License

MIT
