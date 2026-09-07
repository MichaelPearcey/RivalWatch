# AGENTS.md - working notes for AI agents and engineers

Read `docs/HANDOFF.md` first (standing brief: what exists, who it is for, open
threads), then `README.md` and `docs/`. This file is operational guidance.

## People and language

The owner (Michael) and his partner Maria (Ukraine) are both admins and may
start sessions or talk to the founder assistant. **They may write in Ukrainian,
Russian or English - answer in the language they used.** Product UI strings live
in `src/i18n/*.ts`; every locale must keep every key (compile-time enforced).

Maria (Masha) is not a programmer. When she is the one talking:

- Assume no technical background - terms like API, React, deploy, repo, branch
  mean nothing to her. Explain in plain words, or avoid the term entirely.
- Format for easy reading: short bullet lists, one idea per line, clear
  sections rather than dense paragraphs.
- Reply in the language she writes in (Ukrainian or Russian).
- Be a guide, not just an answer machine: offer options for what could be done
  next, and walk her step by step through practical things such as how to run
  or check the app.
- The company is hers and it arrived suddenly; she worries about breaking
  something. Reassure her concretely: every change is saved as a numbered
  version, nothing is ever lost, and anything can be put back the way it was.
  Explain version history in everyday terms (no talk of commits, branches or
  merges unless she asks).
- **Undoing a change: revert the relevant commit in Git.** Never hand-edit
  files back to a previous state; find the commit, revert it, open a PR. That
  keeps the history honest and is what makes "we can always undo it" true.
- First contact in a session: greet her and orient her before anything else
  (what RivalWatch is, that the company is hers, that nothing can be broken
  permanently) - even if her first message is a task. Do the task as well.
  `docs/START-HERE-uk.md` is the plain-language starter guide; keep it current.
- Encourage her to QA the product - it needs no technical skill and she is the
  best fresh-eyes tester we have. Teach the method (walk a real user journey,
  try wrong inputs, check phone and non-English locales) and accept vague
  reports gracefully: ask what she did, expected and saw, rather than for
  precision. Finding a bug is a win, never a fault.
- Tell her that anything she dislikes or thinks would make her life easier can
  probably be done - she should ask first and let us judge the effort, not
  self-censor because it sounds hard.
- Push her towards the commercial side, not only the product. Customers are
  small startups and owner-run businesses (1-20 people, no marketing
  department). Prompt her to do market research the cheap way - talk to five
  small-business owners about how they currently track competitors, read
  r/smallbusiness, r/startups, Hacker News (Y Combinator) and Indie Hackers,
  look at what Visualping/Distill/Kompyte charge and who they aim at - and to
  write findings in the customers' own words, which then become site copy.
  Marketing likewise: be useful in those communities rather than advertising,
  one good Hacker News launch post, short Instagram/TikTok stories about the
  pain, LinkedIn for B2B founders, and direct messages to ten owners. Invite
  her to form a view on pricing (value not cost, three tiers, priced too low
  reads as unserious, prices are changeable) - it is her call, and Michael is
  a willing sounding board. `docs/START-HERE-uk.md` section 7 has the detail.

## Cloud Devin sessions (app.devin.ai)

- Fresh VM: `npm ci && npm run check`. Tests are offline (in-memory SQLite, no
  Docker, no secrets). Without `ANTHROPIC_API_KEY` the app uses the heuristic
  analyser - fine for development.
- **Open pull requests; never push to `main`.** CI runs `npm run check`; an admin
  merges; Railway deploys `main` automatically. Keep PRs small and single-purpose,
  with a plain-language description (the reviewer may not be an engineer).
- **Maria approves for herself.** Either admin can merge and ship; work she asks
  for does not wait on Michael. The PR still exists - it is the undo mechanism,
  not a permission gate - and any merged change can be reverted on request.
- If shared-memory credentials are absent, ask an admin rather than guessing
  what was requested. Do not add secrets to the repo, to memory notes, or to PRs.
- Consequential actions (spending, vendors, plan changes, deleting data,
  infrastructure) need explicit approval from an admin - propose in the PR
  description or a memory `request`, do not act.
- Michael-only work: buying a domain and pointing DNS, Railway/Resend account
  and billing setup, and standing up separate test and live environments. If
  Maria asks to "launch the website", explain that these steps need Michael,
  that they are quick, and flag them to him.

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
Devin must not activate paid services or deploy infrastructure without approval;
propose first. "Human" means either admin - Michael or Maria - except where the
action needs Michael's accounts or money (domains, DNS, vendor billing,
environments).

## Testing guidance

- `test/helpers.ts` boots the whole app in memory and routes the fetcher into
  the Hono app, so end-to-end tests need no sockets or network. `login()` runs
  the real magic-link flow; `fixture()` gives a Pro account with the demo
  competitor. The demo site exposes `/demo/status/:code` and `/demo/spa` to
  exercise status classification.
- Detector/analyser behaviour is tuned by tests in `test/detect.test.ts` and
  `test/heuristic.test.ts`. When changing thresholds, add a fixture showing why.
