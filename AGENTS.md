# AGENTS.md - working notes for AI agents and engineers

Read `docs/HANDOFF.md` first (standing brief: what exists, who it is for, open
threads), then `README.md` and `docs/`. This file is operational guidance.

## People and language

The owner (Michael) and his partner Maria (Ukraine) are both admins and may
start sessions or talk to the founder assistant. **They may write in Ukrainian,
Russian or English - answer in the language they used.** Product UI strings live
in `src/i18n/*.ts`; every locale must keep every key (compile-time enforced).

## Standing reports (CTO <-> VP Engineering)

- **`CTO_report.md`** on the `production` branch is Michael's channel to the agent: updates and
  direct messages. Read it at the start of every six-hour window (the first prompt after 00:00,
  06:00, 12:00 and 18:00 UTC), `git fetch` first, and act on anything addressed to you.
- **`VP_ENG_report.md`** on `production` is the reply channel: every push to `production` adds a
  dated entry with patch notes, what was verified, and what was deliberately not covered.
  Newest entry first.

## Cloud Devin sessions (app.devin.ai)

- Fresh VM: `npm ci && npm run check`. Tests are offline (in-memory SQLite, no
  Docker, no secrets). Without `ANTHROPIC_API_KEY` the app uses the heuristic
  analyser - fine for development.
- **Open pull requests; never push to `main`.** CI runs `npm run check`; a human
  merges; Railway deploys `main` automatically. Keep PRs small and single-purpose,
  with a plain-language description (the reviewer may not be an engineer).
- If shared-memory credentials are absent, ask the owner rather than guessing
  what was requested. Do not add secrets to the repo, to memory notes, or to PRs.
- Consequential actions (spending, vendors, plan changes, deleting data,
  infrastructure) need explicit owner approval - propose in the PR description
  or a memory `request`, do not act.

## Environment quirks (founding machine, Windows)

- Node 22 is installed via nvm at `%APPDATA%\nvm\v22.23.2` but is **not on PATH**
  (the `C:\Program Files\nodejs` symlink is missing). Prepend that directory to
  PATH before running `npm`/`node`, or run `nvm use 22.23.2` in an elevated shell.
- Python on this machine is 3.9 (EOL). Do not build on it.
- PowerShell `Get-Content | Set-Content` round-trips silently mangle the display
  of UTF-8 (`£`, `€`) and can change encodings. Use the editor tools for edits.

## Shared memory protocol (Devin: do this every session)

The production app holds a shared memory (`memory_notes`) written by the owner,
the person the product is built for, and the in-app Founder assistant at
`/admin/founder`. Requests for product changes arrive there as
`kind: request, status: open`. Devin is expected to:

1. **Start of session**: `npm run cli -- memory pull open` (needs
   `RIVALWATCH_URL` and `RIVALWATCH_API_KEY` in `.env`; the key is an admin's
   API key from `/settings`). Treat open requests as work to plan with the owner.
2. **After shipping** something requested: `npm run cli -- memory done <id>` and
   `npm run cli -- memory push journal "<title>" "<what changed, where>"`.
3. **When learning a lasting fact or preference** from the owner in chat, push
   it as `fact`/`preference` so the Founder assistant knows it too.

Never put secrets in memory notes; they are readable by every admin.

## Commands

```bash
npm run check      # typecheck + tests. Run before every commit.
npm test           # vitest, in-memory SQLite, no network, ~1s
npm run demo       # full loop against the built-in fake competitor
npm run build      # tsc + copies src/db/migrations/*.sql into dist/
```

## Conventions

- **Tenancy**: every `Repo` read of tenant-owned data takes `accountId` first
  and filters in SQL. Only `*Any` methods cross tenants (scheduler/admin).
  Route handlers never touch `repo` with ids from the request without going
  through `web/actions.ts`, which takes the authenticated `Principal`.
- **Events**: use the audit fields (`riskLevel`, `result`, `estimatedCostUsd`,
  `requestedBy`, `approvedBy`) - failures must be `result: "failed"`, skipped
  work `"skipped"`, denied actions `"denied"`. Never log raw emails in payloads
  (use `maskEmail`).
- **Page status**: only the pipeline sets `status`; new failure kinds must map
  to one of the seven statuses in `PAGE_STATUSES`.
- TypeScript strict, ESM, `.js` extensions in relative imports (NodeNext).
- Plain SQL migrations in `src/db/migrations/NNN_name.sql`, applied in order,
  never edited after commit. Add a new file for schema changes.
- Every meaningful action emits an event via `Events.record` (see
  `src/events.ts` for the type vocabulary). Add new types there; never
  repurpose existing ones.
- Business rules (plan limits, etc.) live in `src/web/actions.ts` and
  `src/plans.ts`, shared by the JSON API and the HTML forms. Do not put rules
  in route handlers.
- Analyser output must satisfy `InsightDraftSchema`. New providers implement
  `Analyzer` and are wrapped by `GuardedAnalyzer` (cap + fallback + events).
- New data sources implement `Source` (`src/sources/types.ts`) and register in
  `src/app.ts`. The pipeline must stay source-agnostic.
- Secrets: only `src/config.ts` reads env. Never log secret values. **Never
  handle secret values in ad-hoc shell one-liners** - see INCIDENT-001 in
  `docs/03-decisions.md`. To put a secret on Railway use
  `scripts/railway-set-secret.ps1 -Name VAR -FromFile <path outside repo>`.
  To list Railway variables safely: `railway variables --json 2>$null |
  Out-String | ConvertFrom-Json` then take `.PSObject.Properties.Name` only,
  and never pipe per-line into a parser (a parse failure echoes values).
- Railway: project token lives in `.env` as `RAILWAY_TOKEN` (gitignored).
  `railway status`, `railway variables`, `railway up`/redeploy work from the
  repo root. Do not print `railway variables` without `--json` + names filter.
- Record consequential decisions as an ADR in `docs/03-decisions.md`.

## Permission tiers (see docs/02-architecture.md)

Autonomous: scans, analysis, reading metrics, adding pages for existing
customers, drafting content. Manager-AI approval: global cadence changes,
prompt changes, bulk email, pausing customers. Human approval: pricing/plan
changes, new paid vendors, infrastructure, deleting customer data, spending.
Devin must not activate paid services or deploy infrastructure without owner
approval; propose first.

## Testing guidance

- `test/helpers.ts` boots the whole app in memory and routes the fetcher into
  the Hono app, so end-to-end tests need no sockets or network. `login()` runs
  the real magic-link flow; `fixture()` gives a Pro account with the demo
  competitor. The demo site exposes `/demo/status/:code` and `/demo/spa` to
  exercise status classification.
- Detector/analyser behaviour is tuned by tests in `test/detect.test.ts` and
  `test/heuristic.test.ts`. When changing thresholds, add a fixture showing why.
