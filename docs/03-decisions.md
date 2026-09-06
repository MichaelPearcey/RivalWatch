# Architecture Decision Records

Short, append-only. Newest at the bottom. Format: context / decision / consequences.

## ADR-001: TypeScript on Node 22, single process

**Context.** Available runtimes on the founding machine: Node 22 (via nvm),
Python 3.9 (end-of-life). The company will be operated by AI agents that need
a JSON API; the product needs a web UI; future work includes browser-side code.

**Decision.** TypeScript (ESM, strict) on Node 22. One process serving API, UI
and scheduler.

**Consequences.** One language everywhere. Node 22 ships `fetch` and
`node:sqlite`, so no native build toolchain is required. Horizontal scaling of
the scheduler is deferred; if ever needed, split the scheduler into a worker.

## ADR-002: SQLite via `node:sqlite`, plain SQL migrations, no ORM

**Context.** Expected data volume for years: thousands of pages, ~10^5
snapshots. Ops budget: near zero. `node:sqlite` is built in from Node 22.13
(still prints an "experimental" warning but the API is stable).

**Decision.** SQLite file DB, WAL mode, numbered `.sql` migrations, thin typed
repository layer. No ORM.

**Consequences.** Zero infrastructure, trivial backups (copy the file or use
Litestream). Single-writer limits are irrelevant at this scale. Moving to
Postgres later means porting ~1 file of SQL.

## ADR-003: Structured event log from day one

**Context.** The company must eventually be run by agents; metrics and audit
trails cannot live in logs or chat.

**Decision.** Append-only `events` table with `type`, `actor`, `entity_type`,
`entity_id`, JSON `payload`. Every pipeline step and business action emits an
event. Exposed via `/api/events` and aggregated by `/api/stats`.

**Consequences.** The future owner dashboard, agent metrics and cost tracking
all read one table. Slight write amplification (acceptable).

## ADR-004: Analyzer behind an interface with a free heuristic fallback

**Context.** LLM calls cost money and need a key; tests must run offline; the
core loop must be demonstrable without credentials.

**Decision.** `Analyzer` interface. `HeuristicAnalyzer` (regex/rules for
prices, promos, launch vocabulary) is the default and the fallback.
`AnthropicAnalyzer` is used when `AI_PROVIDER=anthropic` and a key is present.
Output is strict JSON validated with zod. A daily call cap bounds spend.

**Consequences.** Deterministic tests. Provider can be swapped (OpenAI, local
model) without touching the pipeline.

## ADR-005: Websites only for the MVP; social via official APIs later

**Context.** Instagram/X/LinkedIn scraping violates terms of service, breaks
constantly and risks IP bans. Official APIs are limited to connected/business
accounts (Meta), paid (X) or unavailable (LinkedIn).

**Decision.** MVP monitors websites. `Source` adapter contract exists so RSS,
YouTube Data API and Meta Graph API can be added without pipeline changes.
Never depend on unofficial scraping.

**Consequences.** Some "social-first" customers will be underserved initially.
Marketing must be honest about coverage.

## ADR-006: Bundled mutable demo competitor site

**Context.** Real websites change unpredictably, making the loop hard to demo
and impossible to test end-to-end deterministically.

**Decision.** The app serves `/demo/*`, a fake competitor with a pricing page
whose content can be mutated via `POST /demo/state`. Seed data points at it.

**Consequences.** `npm run demo` shows the full loop in seconds; e2e tests are
deterministic. Must be disabled (`DEMO_SITE_ENABLED=false`) in production.

## ADR-007: No auth, billing or email in the MVP

**Context.** These are well-understood, vendor-driven and not the risky part
of the product. The risky part is signal-vs-noise in change detection and
insight quality.

**Decision.** Defer. The schema already has `businesses` with a `plan` column
and plan limits as data so billing can attach later. Email/alerts are a future
`notifications` module reading `insights`.

**Consequences.** MVP is single-tenant and must not be exposed publicly.
*Superseded by ADR-008..013 (Phase 1).*

## ADR-008: Accounts as the tenant boundary; account_id denormalised onto every row

**Context.** Phase 1 requires every business, competitor, page, snapshot,
change, insight and event to be tenant-scoped, and the API must make
cross-tenant access impossible by construction.

**Decision.** `accounts` own `users` (1..n) and all data. Every tenant-owned
table carries `account_id`; every `Repo` read of such a row takes `accountId`
and filters on it. Cross-tenant methods are suffixed `*Any` and used only by
the scheduler and admin views. Plans live on the account.

**Consequences.** Slight redundancy (a snapshot's account is derivable from its
page) buys simple, auditable SQL and cheap per-tenant queries. Existing rows
were backfilled into a "Legacy" account (id 1) by migration 002.

## ADR-009: Passwordless magic-link auth, opaque hashed tokens, no signing secret

**Context.** Non-technical users; no desire to store passwords; no time for
OAuth. Sessions must survive restarts.

**Decision.** Login token and session token are 256-bit random values stored
SHA-256 hashed in SQLite, single-use/expiring for login, 30-day for sessions,
cookie `HttpOnly; SameSite=Lax; Secure` (when PUBLIC_URL is https). Rate limit
5 links/email/hour. API keys (`rw_…`) use the same hashing and authenticate as
`agent:<name>`. Admins are users whose email is in `ADMIN_EMAILS` (or granted
via CLI); the flag is never silently revoked.

**Consequences.** No `SESSION_SECRET` to rotate; revocation is a row delete.
SameSite=Lax gives CSRF protection for form POSTs without tokens (known
limitation: not defence-in-depth). Email deliverability becomes critical.

## ADR-010: Confirm every detected change on a later fetch

**Context.** A/B tests, transient error pages and half-deployed edits cause
false positives that would destroy trust in the product.

**Decision.** All changes above the noise threshold are stored as
`pending_confirmation` and the page is re-fetched after `CONFIRM_DELAY_MINUTES`
(default 60). Same content ⇒ confirmed and analysed. Reverted ⇒
`discarded_unconfirmed` (event result `skipped`). Changed again ⇒ old pending
discarded, new one opened.

**Consequences.** Insights arrive ~1 hour later; one extra fetch per change;
zero LLM spend on flapping content. Simpler and more predictable than trying to
classify "suspicious" changes.

## ADR-011: Explicit monitoring status; failure is never shown as healthy

**Context.** The owner requires ACTIVE / ROBOTS_BLOCKED / AUTH_REQUIRED /
RATE_LIMITED / FETCH_ERROR / CONTENT_UNREADABLE / PAUSED and that failed
monitoring is never treated as healthy.

**Decision.** `FetchFailureReason` maps 1:1 to statuses. 401/403 ⇒
AUTH_REQUIRED, 429/503 ⇒ RATE_LIMITED, non-HTML or JS-only pages ⇒
CONTENT_UNREADABLE, robots.txt ⇒ ROBOTS_BLOCKED, other ⇒ FETCH_ERROR. Every
transition emits `page.status_changed` (result `failed`, risk `medium` when
unhealthy). Unhealthy pages are surfaced on the dashboard, in digests and in
the admin view; exponential backoff applies.

## ADR-012: Email behind a `MailProvider` interface; Resend via plain HTTPS

**Decision.** `LogMailProvider` (default; stores the body in the `emails`
table) and `ResendMailProvider` (no SDK). Every email is recorded and emits
`email.sent`/`email.failed` with a masked recipient. Digest = one job in the
scheduler, per business, weekly at `DIGEST_WEEKDAY`/`DIGEST_HOUR_UTC`, skipped
(with an event) when there is nothing to report and all pages are healthy.

## ADR-013: Railway, single replica, SQLite on a volume

**Context.** Owner chose Railway (2026-09-05). Constraint: preserve the
single-process architecture.

**Decision.** Dockerfile + `railway.json`, `numReplicas: 1`, volume at `/data`.
No Postgres, no Redis, no worker. See `docs/07-deployment.md`.

**Consequences.** Zero-downtime deploys are not guaranteed (single instance);
acceptable for MVP testing. Scaling beyond one instance requires extracting the
scheduler first.

## ADR-015: Approvals as the only path to consequential actions

**Context.** The company will be run by agents. The safety principle requires
three tiers (autonomous / Manager-AI approval / human approval), auditability,
and that agents never hold destructive or financial power.

**Decision.** `src/approvals.ts` holds a catalogue of *actions*
(`account.set_plan`, `page.set_paused`, `email.send`, ...), each with a zod
payload schema, a risk level (`medium` = Manager agent or human may approve;
`high` = human only) and an `execute` function. Any principal may *request*
(`POST /api/approvals`, validated immediately, 202). Admins decide via API or
the "Needs your attention" inbox in `/admin`; the Manager agent will be
allowed to decide medium-risk requests. Approval triggers execution **by the
system** (actor `system`, with `requested_by` and `approved_by` on the audit
event). Requesters cannot approve their own requests (admins excepted, whose
direct actions are modelled as request+approve so the trail is identical).
Pending requests expire after 72h.

**Consequences.** Every new agent capability that changes the world is one
catalogue entry, automatically gated and audited. Tier-1 (autonomous) actions
remain plain API calls attributed to `agent:<name>`. Billing will later
request `account.set_plan` the same way.

## INCIDENT-001 (2026-09-06): vendor API keys exposed in an agent transcript

**What happened.** While listing Railway variable *names*, an ad-hoc PowerShell
one-liner's JSON parsing failed and echoed variable *values* in its error
output, putting the Anthropic and Resend API keys into the Devin session
transcript. Earlier the same day the owner also pasted a GitHub PAT directly
into chat.

**Response.** Owner asked to rotate both keys and revoke the PAT; the leaked
bootstrap token was already single-use and its variable was deleted.

**Rule (binding for all agents and humans working on this repo).**
1. Never handle secret values with ad-hoc shell one-liners. Use
   `scripts/railway-set-secret.ps1` (reads from a file, scrubs errors, prints
   names/lengths only) or an equivalent reviewed script.
2. Never run a command whose *failure path* could print values (JSON parsing of
   secret-bearing output, `env`, `Get-Content` on `.env`, etc.). List names via
   a parser that is known to succeed, or not at all.
3. Secrets travel: owner -> local file outside the repo -> script -> Railway.
   They never appear in chat, git, logs or docs. Owners should never paste
   secrets into chat; agents must say so immediately if it happens.
4. Any exposure, however brief, is treated as a compromise: rotate, then note
   it here.

## ADR-014: Audit format on events

**Decision.** `events` gained `account_id, risk_level, requested_by,
approved_by, result, estimated_cost_usd`. Mapping to the required audit shape:
actor→`actor`, action→`type`, target→`entity_type/entity_id`,
metadata→`payload`, timestamp→`ts`. `approval.*` and `agent.action` types are
reserved for the Manager AI layer; nothing writes `approved_by` yet except the
CLI `make-admin` path (`requested_by=cli`).
