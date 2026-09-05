# AGENTS.md - working notes for AI agents and engineers

Read `README.md` and `docs/` first. This file is operational guidance.

## Environment quirks (founding machine, Windows)

- Node 22 is installed via nvm at `%APPDATA%\nvm\v22.23.2` but is **not on PATH**
  (the `C:\Program Files\nodejs` symlink is missing). Prepend that directory to
  PATH before running `npm`/`node`, or run `nvm use 22.23.2` in an elevated shell.
- Python on this machine is 3.9 (EOL). Do not build on it.
- PowerShell `Get-Content | Set-Content` round-trips silently mangle the display
  of UTF-8 (`£`, `€`) and can change encodings. Use the editor tools for edits.

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
- Secrets: only `src/config.ts` reads env. Never log secret values.
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
