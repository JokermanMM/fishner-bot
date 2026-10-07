# Project instructions

## Product

This repository contains the private Telegram bot `@fishner_bot`, a fishing journal for a group of 3–4 friends. Read `PROJECT.md` before changing product behavior or deployment.

## Invariants

- The bot is private. New members join only through the configured invite code.
- Catches, the activity feed, records, and aggregate statistics are shared by all approved members.
- Every catch keeps its author. Rankings must show who caught the fish.
- Exact latitude and longitude are visible to every approved member inside the bot, but must never appear in inline cards shared to arbitrary chats. A human-readable waterbody name may be shared.
- Never commit or print `BOT_TOKEN`, `DATABASE_URL`, `FRIEND_INVITE_CODE`, `WEBHOOK_SECRET`, or `RENDER_DEPLOY_HOOK_URL`.
- Do not create or overwrite `.env` automatically. `.env.example` documents variable names only.
- Render Free has an ephemeral filesystem. Persistent application data belongs in Postgres, never in a local SQLite file.
- Production receives Telegram updates through a webhook. Polling is only for local development.
- GitHub Actions must run checks before triggering the Render deploy hook.
- UptimeRobot may monitor the public `/health` endpoint every 5 minutes to reduce Render Free cold starts. This does not replace health checks, persistence, or graceful restart handling.

## Architecture

- Runtime: Node.js 24 LTS and TypeScript.
- Telegram framework: grammY.
- Production host: Render Free Web Service.
- Persistent database: external Postgres, currently Neon Free.
- Media MVP: Telegram `file_id`. A separate object-storage backup is a later milestone.
- CI/CD: `.github/workflows/ci.yml`, with `RENDER_DEPLOY_HOOK_URL` stored as a GitHub Actions secret.
- Availability helper: UptimeRobot HTTP monitor targeting the Render `/health` endpoint.

## Verification

Run before delivery:

```bash
npm run typecheck
npm test
npm run build
```

Update `PROJECT.md` whenever the product model, deployment, privacy rules, or roadmap changes.
