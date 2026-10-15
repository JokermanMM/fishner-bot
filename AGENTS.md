# Project instructions

## Product

This repository contains the private Telegram bot `@fishner_bot`, a fishing journal for a group of 3–4 friends. Read `PROJECT.md` before changing product behavior or deployment.

## Invariants

- The bot is private. New members join only through the configured invite code.
- Catches, the activity feed, records, and aggregate statistics are shared by all approved members.
- Every catch session keeps its submitting member separately from the actual angler of each fish. Rankings and records use the actual angler.
- An angler may be selected from approved members or resolved by `@username`; persistent ownership always uses immutable Telegram user ID and cards show the Telegram display name.
- One entry session contains 1–20 fish and 1–10 photos. Photos, location, waterbody, date, lure, disposition, and notes are shared; angler, species, weight, and length are stored per fish.
- Photos are stored once per catch session and deduplicated within the session by Telegram `file_unique_id`. Video is not supported.
- Species input accepts letters, spaces, and hyphens only; values that look like weights or contain digits must be rejected.
- A batch save is atomic: the session, all photos, and every fish are committed together or none are stored.
- Every approved member may manage shared catch sessions in the private bot. Deleting a session, one fish, or a photo requires an explicit confirmation; the last photo cannot be deleted.
- Catch leaderboards support all fish, species, and angler scopes, sorted by weight or length. Length rankings exclude catches without a length.
- The Statistics entry point opens the global catch leaderboard sorted by weight. Species filters are generated from species already present in catches.
- Leaderboards show the result and angler without catch date/time. The active metric is visually marked in the inline keyboard.
- Callback queries must be acknowledged before database work. An expired acknowledgement or a repeated active filter must never prevent the requested statistics view from being rendered.
- At the location step, a member may reuse their own latest named location; this copies both coordinates and waterbody and skips the repeated waterbody question.
- Catch time is neither collected nor displayed. Dates accept numeric Russian format or a Russian month name without time.
- Exact latitude and longitude are visible to every approved member inside the bot, but must never appear in inline cards shared to arbitrary chats. A human-readable waterbody name may be shared.
- The Mini App is part of the private bot experience. Every data or media API request must validate fresh Telegram `initData` and then confirm that the Telegram user is approved.
- Never expose Telegram `file_id` values, bot tokens, or Telegram file-download URLs in Mini App JSON. Media is proxied by the server only after authorization.
- Never commit or print `BOT_TOKEN`, `DATABASE_URL`, `FRIEND_INVITE_CODE`, `WEBHOOK_SECRET`, or `RENDER_DEPLOY_HOOK_URL`.
- Error logging must use sanitized summaries only; never log grammY context, API objects, request payloads, or raw error objects because they may contain `BOT_TOKEN`.
- Do not create or overwrite `.env` automatically. `.env.example` documents variable names only.
- Render Free has an ephemeral filesystem. Persistent application data belongs in Postgres, never in a local SQLite file.
- Production receives Telegram updates through a webhook. Polling is only for local development.
- Render builds with `NODE_ENV=production`; the build command must explicitly install dev dependencies before compiling TypeScript, then may prune them.
- GitHub Actions must run checks before triggering the Render deploy hook.
- UptimeRobot may monitor the public `/health` endpoint every 5 minutes to reduce Render Free cold starts. This does not replace health checks, persistence, or graceful restart handling.
- The public `/health` endpoint must return `200` for both `GET` and `HEAD`; UptimeRobot probes it with `HEAD`.

## Production data cleanup

- A test-data reset deletes `catch_sessions` (cascading to `catches` and `catch_photos`) and then `species`, inside one database transaction.
- Preserve `users`, membership approvals, `drafts`, the database schema, and every secret unless the user explicitly expands the cleanup scope.
- Before a production reset, verify the target database and record row counts. After it, verify that sessions, catches, photos, and species are empty and that the user count is unchanged.

## Architecture

- Runtime: Node.js 24 LTS and TypeScript.
- Telegram framework: grammY.
- Production host: Render Free Web Service.
- Production health URL: `https://fishner-bot.onrender.com/health`.
- Persistent database: external Postgres, currently Neon Free.
- Photo storage: Telegram `file_id` in `catch_photos`; a separate object-storage backup is intentionally outside the current roadmap.
- Mini App: static mobile-first assets served by the existing Render service at `/app`, with authenticated same-origin API routes under `/api/mini-app/`.
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
