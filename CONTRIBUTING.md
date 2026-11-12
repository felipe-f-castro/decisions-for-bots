# Contributing to Decisions

Decisions is a shared human-in-the-loop inbox: agents ask, people answer, and an agent picks up the answer. Keep that workflow clear and easy to self-host.

## Local development

Use Node.js 22+ and npm:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. With Supabase credentials absent, demo mode bypasses auth and resets on server restart. Use generic sample data and images.

## Before a pull request

Create a focused branch (`codex/short-description` for Codex work) and target **main**. Explain the problem, resulting behavior, and relevant validation. Add screenshots for visible changes and update README.md when changing setup or API behavior.

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Use `npm run format` for source and public documentation. GitHub Actions runs the same checks in one Linux job with Node.js 22. Use only the free quota. If hosted CI cannot run, distinguish local results from hosted verification.

## Design and testing

- Keep storage behind `DecisionStore` in `src/lib/stores/types.ts`; shared validation and state transitions belong in `src/lib/domain.ts`.
- Human requests must use an allowed Supabase session and remain subject to RLS. Only authenticated agent endpoints may construct the service-role store. Never move service-role access into client components or use it to bypass human policies.
- Keep the server and database allowlists in sync through the documented reconciliation command. Do not authorize from user-editable metadata or session payloads alone.
- Preserve atomic `id` + `version` updates, database version triggers, and Routed locks. Signed image URL rotation must not affect revisions.
- Update `appwrite.config.json` for schema, bucket, or site changes. Never hide a real provider call in the build, and never commit secrets.
- Private images belong in Supabase Storage. Preserve bounded bodies, MIME/signature checks, DNS/IP validation, redirect checks, and connection pinning for URL downloads. Do not forward app credentials to attachment hosts.
- Test meaningful behavior: auth boundaries, RLS, concurrency, upload failures, provider requests, and user journeys. SDK tests use fake transports; database tests run the actual migration in PGlite with Supabase scaffolding. Normal checks require no real credentials, hosted services, or Docker.
- Avoid automatically retrying writes that may already have succeeded. Never expose provider bodies, tokens, private decisions, or email lists in errors/logs.

The TypeScript 7 checker runs beside Microsoft's TypeScript 6 compatibility API, used by ESLint and Next.js tooling. Keep these aliases together. The scoped `minimatch` override fixes a development dependency advisory; review it when updating the parser.

## Private files and security reports

Never commit environment files, credentials, private data, personal screenshots, local instructions, prompts, logs, Supabase CLI state, or generated `output/` artifacts. Only `.env.example` is public. README screenshots belong in `docs/` and use generic demo assets.

Use GitHub private vulnerability reporting if available on the published repository; otherwise contact a maintainer privately. Do not post live credentials or private decisions in issues.

Contributions are licensed under the [MIT License](LICENSE).
