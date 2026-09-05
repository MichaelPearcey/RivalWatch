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
