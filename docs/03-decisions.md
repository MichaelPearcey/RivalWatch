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

## ADR-016: Agents are scheduled tool-using runs with a closed tool set

**Context.** The company must be operated largely by AI agents (Manager,
Growth, Support/Ops), under the permission tiers, with full auditability and
bounded cost, without giving any agent credentials or destructive power.

**Decision.** `src/agents/`: an agent = role prompt + briefing + whitelist of
tools + schedule + per-run cost cap. Tools are read-only queries over the
system's own data, plus exactly two write tools: `request_approval` (creates
an approvals row) and `write_note` (report/draft/recommendation for the
owner). The Manager additionally gets `decide_approval`, restricted by the
approvals layer to medium-risk requests it did not raise itself. The runner
(`AgentRunner`) records an `agent.action` event per tool call, an `ai.call`
event per model turn (with cost), and an `agent_runs` row per run; it stops at
`maxTurns`, at the per-run cap, or at the rolling daily cap across agents.
Agents are off unless `AGENTS_ENABLED=true`; each can be disabled in `/admin`.
Runs are sequential (one at a time) and use the Haiku-class model by default.

**Consequences.** Adding a capability = adding a tool (read) or an approval
action (write); prompts cannot escalate beyond the tool set. Agents produce
*requests and notes*, humans (or the Manager, for medium risk) produce
*decisions*, the system produces *effects*. Cost at default schedules is
≈ $4/month. Tool results are the main token cost; tools must stay terse.
Verified live on 2026-09-06 with Claude Haiku 4.5 (see scripts/live-agent-check.ts).

## ADR-017: Optional passwords with scrypt; magic links remain the recovery path

**Decision.** Users may set a password in Settings. Hashes use Node's built-in
`scrypt` with N=2^15, r=8, p=3 (OWASP-listed; ~32 MiB so a burst of logins
cannot exhaust a 512 MB container), stored self-describing so parameters can be
raised and re-hashed on next login. Policy is length-based (>= 12, NIST
800-63B), no composition rules. 10 failures lock the account for 15 minutes;
responses never reveal whether an email exists; a magic-link login clears the
lock (it proves mailbox control) and doubles as password reset. Changing a
password revokes all other sessions.

## ADR-018: Data protection by design (UK GDPR)

**Decision.** Versioned Terms and Privacy Policy in `src/legal.ts`; acceptance
is recorded per user per version in `consents` and required before using the
web app (API keys inherit the owner's acceptance). Users can export all their
data as JSON and delete their account from Settings; deletion pauses
monitoring, waits 7 days (cancellable), then hard-deletes via cascades,
redacts email addresses (including pre-signup magic-link emails) and leaves
audit events with `account_id = NULL`. One strictly-necessary cookie, no
third-party requests from pages (system fonts, inline CSS), so no cookie
banner is required. Raw competitor HTML is kept 30 days. A `/bot` page explains
the crawler and how to opt out. A solicitor should review the texts before
paid launch; `COMPANY.contact` must become a real mailbox on the production
domain.

## ADR-019: Server-rendered UI with a single inline stylesheet

**Decision.** Keep Hono JSX server rendering; one design-system stylesheet
(`web/theme.ts`) inlined per page; no client framework, no build step, no
external assets. Public marketing pages (landing, pricing, legal) share the
shell with the app. Rationale: fastest possible pages, zero third-party
requests (privacy), trivially testable HTML, and the product's UI surface is
small. Revisit if we need rich interactivity (charts, live updates).

## ADR-020: Internationalisation (EN, UK, RU, DE, FR, ES)

**Decision.** Typed message catalogue in `src/i18n/` (`en.ts` is the source of
truth; every other locale is `Record<keyof typeof en, string>` so a missing key
is a compile error). Locale resolution: cookie `rw_lang` → signed-in user's
`users.locale` → `Accept-Language` → English. A nav switcher (`GET /lang`) sets
the cookie and, when signed in, the user preference. The analyser prompt is
told the owner's language so insights are written in it; digests are rendered
per recipient. **Legal documents remain English-only** with a notice that the
English version is binding (machine-translated legal text without per-language
legal review is a liability). The admin dashboard is English-only
(operator-facing). Translations were written by the engineering agent and need
a native-speaker review before marketing in those languages.

## ADR-021: Competitor news via public RSS, LLM-classified, "big" threshold at 4/5

**Decision.** `NewsSource` interface with `GoogleNewsRss` (free, keyless) as
the first implementation. One quoted-name query per competitor per
`NEWS_INTERVAL_HOURS` (24). New headlines are stored (deduped by URL hash) and
classified in one batched LLM call: `about_competitor` (profile-aided
disambiguation), category, magnitude 1–5, summary and why-it-matters in the
owner's language; heuristic fallback without an LLM. Magnitude ≥ 4 and
about_competitor ⇒ **big**: `news.big` event, dashboard panel, instant email on
plans with alerts (verified users only), and a section in the weekly digest.
Items the model marks as not about the competitor are capped at magnitude 2
regardless of what it said.

**Robots.txt note.** news.google.com disallows `/rss/` for generic crawlers.
Feeds are syndication endpoints published for automated readers, and
robots.txt governs crawling/indexing, so feed fetches pass
`syndication: true` and skip the robots check. Frequency stays at once per
query per day; nothing else bypasses robots.

**Consequences.** Zero vendor cost for the source; ≈ $0.01 per competitor on
first run, ≈ $0.001/day thereafter. Live check on "Figma" correctly excluded
namesakes (anime figures, a crypto token) and graded earnings news as 3/5.

## ADR-022: Founder assistant + shared memory as the human/agent bridge

**Context.** The owner wants the person the product is built for to be able to
talk to "the founder" and ask for changes herself, and wants those conversations
to reach Devin (the engineering agent, which runs in a local CLI and cannot be
reached from the web).

**Decision.** (1) `memory_notes`: an append-mostly store of facts, decisions,
requests, preferences and journal entries, authored by users, the Founder
assistant (`agent:founder`) or Devin (`agent:devin`, via an admin API key).
Exposed at `/api/admin/memory` and in the admin UI. Devin pulls it at session
start and pushes back what it shipped (protocol in `AGENTS.md`). (2) A Founder
assistant chat at `/admin/founder` (admin-only, per-user conversations) using a
Sonnet-class model with the agents' read tools plus `remember`,
`search_memory`, `update_memory_status`, `request_approval`, `write_note`. Its
system prompt embeds the memory briefing and the project docs, so it can
explain the company truthfully and turns change requests into memory notes.
Separate budget (`FOUNDER_*`), every model call and write-tool use audited.

**Phase B (done).** Repo tools via a fine-grained GitHub token limited to this
repository (contents + pull requests write, actions read): `repo_list_files`,
`repo_read_file`, `repo_search`, `propose_change` (branch `founder/<slug>` +
commit + PR, journaled in memory), `pr_status` (CI result + failure excerpt),
`list_pull_requests`. Merging is the approval action `repo.merge_pr`
(high risk, human); execution refuses if CI is pending or red. The assistant
never writes to `main` and is blocked from paths reserved for the engineering
agent (CI, Docker/Railway, package manifests, config, auth, passwords,
approvals, github client, the founder module itself, existing migrations).
Guidance in the prompt: small single-purpose PRs for copy, translations,
theme, landing/pricing, legal, docs; everything else becomes a memory request.

**Consequences.** ≈ $0.05 per exchange; conversations are stored in the
database (exportable, deletable with the account). API keys now inherit their
owner's admin flag so Devin's key can reach admin endpoints.

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
