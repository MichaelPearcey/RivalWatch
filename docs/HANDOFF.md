# HANDOFF - read this first in any new Devin session

This file is the standing brief for whoever (human or agent) picks up work on
RivalWatch. It is kept current by the engineering agent; if you change
something material, update this file in the same PR.

## What this is, and who it is for

RivalWatch is a low-cost competitor-monitoring service for small businesses:
"tell us who your competitors are; we watch them and tell you when something
happens that actually matters." Live at
https://rivalwatch-production-8a8f.up.railway.app (Railway, auto-deploys from
`main`).

The company is a gift from the owner (Michael, UK) to his partner (Maria, in
Ukraine) so she has meaningful work she can run herself. She is an admin.
**Users of the founder assistant and of Devin sessions may write in Ukrainian or
Russian; reply in the language they use.** Product UI supports EN, UK, RU, DE,
FR, ES.

Maria (Masha) has no programming experience. When talking to her: no jargon
(explain or avoid terms like API, deploy, repo), use short bullet lists and
clear sections, reply in her language, and offer options plus step-by-step
guidance - including basics such as how to run the app. Greet and orient her at
the start of a session even if she opens with a task, and reassure her that
nothing can be broken permanently. Plain-language starter guide for her:
`docs/START-HERE-uk.md`. See `AGENTS.md`.

## State of the product (September 2026)

Everything below is live and tested (`npm run check`, ~130 tests, offline).

- Core loop: polite fetch -> snapshot -> change detection with noise filter ->
  confirm on second visit -> Claude analysis relative to the customer's own
  pricing -> insight card with evidence and "why it matters".
- Multi-tenant accounts, magic-link and password sign-in (scrypt), email
  verification, consent to versioned Terms/Privacy, JSON export, account
  deletion with grace period. UK GDPR-oriented; legal text is a founder draft
  awaiting a solicitor.
- Public site: dark/light design system, self-hosted font, landing, pricing,
  privacy, terms, crawler page.
- Automatic competitor profiles (summary, target customers, USPs, products,
  pricing) built from their pages and fed into every analysis.
- Competitor news from Google News RSS, classified by Claude (relevance,
  category, magnitude 1-5); magnitude >= 4 is "big news": dashboard panel,
  instant email on paid plans, digest section.
- Weekly digest emails per recipient language (Resend).
- Approvals primitive with risk tiers; Support/Ops, Manager and Growth agents on
  schedules; owner dashboard at `/admin`.
- Founder assistant at `/admin/founder`: Sonnet-class chat with live streaming,
  shared memory, and repo tools that open pull requests (merge = human approval).
- Nightly gzipped SQLite backups on the volume (off-site bucket not yet
  configured).

## How work flows (important)

1. **Shared memory** (`memory_notes`, `/api/admin/memory`, admin UI at
   `/admin/founder`). Requests from the owner or Maria arrive as
   `kind: request, status: open`. Pull it at session start:
   `npm run cli -- memory pull open` (needs `RIVALWATCH_URL` +
   `RIVALWATCH_API_KEY` = an admin's API key). If you lack the key, ask the
   owner; do not guess at requests.
2. **Never push to `main` directly from a cloud session.** Open a pull request;
   CI runs `npm run check`; an admin merges (Railway deploys `main`). The local
   CLI session run by the owner is the only place that pushes to `main`, and
   even that should move to PRs. **Both admins approve for themselves** - Maria
   does not need Michael's sign-off to ship; the PR is the undo mechanism, not a
   permission gate, and anything merged can be reverted on request.
3. **No secrets in the repo or in memory notes.** Production secrets live in
   Railway variables; local ones in `.env` (gitignored).
4. Consequential actions (spending, vendors, plan changes, deleting data,
   infrastructure) need explicit owner approval - propose first.
5. Record decisions as ADRs in `docs/03-decisions.md`; update `docs/06-roadmap.md`.

## Environment notes for cloud sessions

- Node 22 (uses `node:sqlite`); `npm ci` then `npm run check`. Tests need no
  network, no Docker, no secrets. `npm run demo` runs the full loop against the
  built-in fake competitor.
- Without `ANTHROPIC_API_KEY` the app runs with the heuristic analyser and
  log-only email; that is fine for development.
- Live checks (`scripts/live-*.ts`) need real keys and cost real money; skip
  them unless the owner asks.

## Open threads (as of this handoff)

Owner-side (only Michael can do these):
- Buy a domain; point Railway, Resend and `PUBLIC_URL` at it; make
  `privacy@<domain>` real (`COMPANY.contact` in `src/legal.ts`).
- Solicitor review of Terms/Privacy before charging money.
- Cloudflare R2 (or B2) bucket for off-site backups -> `BACKUP_S3_*` vars.
- GitHub bot token expiry date -> journal it in memory so the assistant reminds.

Engineering, in rough priority:
1. Stripe billing (Checkout + Customer Portal, plan changes via approvals).
2. Instant alerts for page-change insights with importance >= 4 (news alerts exist).
3. Founder assistant: it sometimes narrates instead of acting and can be
   expensive on large files - watch `ai.call` costs; keep PRs small.
4. Native-speaker review of UK/RU/DE/FR/ES translations (written by the agent).
5. Headless-browser fallback for `CONTENT_UNREADABLE` pages.
6. Instagram/Meta official-API integration and Remotion video ads (later; approval-gated publishing).

## Where to look

- `README.md`, `AGENTS.md` (conventions + memory protocol), `docs/01-vision.md`,
  `docs/02-architecture.md`, `docs/03-decisions.md` (ADRs 001-022),
  `docs/07-deployment.md`.
- Code map: `src/app.ts` composition root; `src/web/` routes + views;
  `src/monitor/` pipeline; `src/ai/` analysers + profile; `src/news/`;
  `src/agents/`; `src/founder/`; `src/i18n/`; `src/db/migrations/`.
