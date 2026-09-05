# RivalWatch - Architecture

## Guiding principles

simplicity, low operating cost, maintainability, observability, structured
data, secure credential handling, API-first, automated tests. Avoid
infrastructure until it is demonstrably needed.

## Stack (MVP)

| Concern         | Choice                                   | Why                                                                 |
|-----------------|------------------------------------------|---------------------------------------------------------------------|
| Runtime         | Node 22 LTS, TypeScript (ESM)            | One language across backend, UI, agents. Built-in `fetch`, `node:sqlite`. |
| HTTP            | Hono + `@hono/node-server`               | Tiny, typed, JSX server rendering, no build step for UI.            |
| Database        | SQLite via `node:sqlite`                 | Zero-ops, single file, no native compile. Plenty for thousands of pages. |
| HTML parsing    | cheerio                                  | Fast, server-side, no browser.                                      |
| Diffing         | `diff`                                   | Line/word diffs for change detection and LLM context.               |
| Validation      | zod                                      | Config, API input and LLM output validation.                        |
| LLM             | `@anthropic-ai/sdk` behind an interface  | Swappable provider; heuristic fallback needs no key.                |
| Scheduling      | in-process interval loop                 | No Redis/queue. Idempotent scans; safe to run one instance.         |
| Tests           | vitest                                   |                                                                     |

Everything runs as **one process**: HTTP API + UI + scheduler. Deploy as one
container (Fly.io / Railway, ~£5/month) with a persistent volume for SQLite.
When we outgrow this, the migration path is: SQLite -> Postgres (schema is
plain SQL), interval loop -> a worker process. Nothing in the code assumes
otherwise.

## Source layout

```
src/
  config.ts              env -> validated config object
  logger.ts              structured JSON logging
  db/
    index.ts             open DB, run migrations
    migrations/*.sql     numbered plain-SQL migrations
    repo.ts              typed data access (businesses, competitors, pages, snapshots, changes, insights)
  events.ts              structured audit/event log (actor, action, target, risk, result, cost)
  plans.ts               plan definitions (limits as data)
  auth.ts                magic links, sessions, API keys, admin flag
  digest.ts              weekly digest composition + job
  mail/index.ts          MailProvider interface: log + Resend; Mailer records every email
  sources/website/discover.ts   home-page link ranking -> page suggestions
  web/admin.ts           owner/operator overview aggregation
  sources/
    types.ts             Source adapter contract (website now; social later)
    website/
      fetcher.ts         polite HTTP fetch: robots.txt, UA, timeout, per-host delay, conditional GET
      extract.ts         HTML -> normalised main text + price mentions + title
  monitor/
    detect.ts            snapshot comparison, noise filtering, significance score
    pipeline.ts          fetch -> snapshot -> detect -> analyse -> insight, emitting events
    scheduler.ts         finds due pages and runs the pipeline on a tick
  ai/
    types.ts             Analyzer contract + zod schema for structured output
    heuristic.ts         deterministic analyser (free; used in tests and as fallback)
    anthropic.ts         Claude-backed analyser with strict JSON output
    prompt.ts            prompt construction
    index.ts             provider selection + daily call cap
  web/
    app.ts               Hono app: JSON API + HTML pages
    views/*.tsx          server-rendered pages
    demo-site.ts         local fake competitor site (mutable) for demos/tests
  index.ts               process entrypoint
  cli.ts                 ops CLI (migrate, scan-now, demo)
test/                    vitest specs
docs/                    this documentation
```

## Domain model

```
Account 1--* User (email, is_admin)          Account 1--* ApiKey (agent:<name>)
Account 1--* Business 1--* Competitor 1--* MonitoredPage (status) 1--* Snapshot
                                   |               |
                                   1--* PageSuggestion   1--* Change (pending_confirmation -> done | discarded_unconfirmed)
                                                                    |
                                                                    0..1 Insight 1--* InsightFeedback
Event  (append-only audit: actor, type=action, entity=target, account_id, risk_level, result, estimated_cost_usd, payload)
Email  (every message sent, per provider)   LoginToken / Session (hashed tokens)
```

Every tenant-owned table carries `account_id`; see ADR-008. Page `status` is
one of ACTIVE, ROBOTS_BLOCKED, AUTH_REQUIRED, RATE_LIMITED, FETCH_ERROR,
CONTENT_UNREADABLE, PAUSED (ADR-011).

- **Business**: the customer's own company (name, website, description, own
  pricing notes). The description and pricing are fed to the analyser so
  insights can say "why this matters *to you*".
- **Competitor**: name + website root, belongs to a business.
- **MonitoredPage**: a concrete URL with a `kind` (`home`, `pricing`,
  `products`, `blog`, `other`) and a `source_type` (`website` now; later
  `rss`, `youtube`, `instagram`...). Has `check_interval_minutes`,
  `next_check_at`, failure counters.
- **Snapshot**: one fetch. Stores `content_hash`, extracted `text`, gzipped raw
  HTML, HTTP metadata. Consecutive identical hashes do not create a new
  snapshot; we bump `last_seen_at` instead.
- **Change**: two snapshots differed beyond the noise threshold. Stores the
  unified diff, `added`/`removed` line lists, and a numeric `significance`.
- **Insight**: analyser output for a change: `matters` (bool), `category`,
  `importance` 1-5, `headline`, `summary`, `why_it_matters`, plus the
  provider/model used and token usage for cost tracking. Insights with
  `matters=false` are stored (for audit and tuning) but hidden from the default
  feed.
- **Event**: `{ts, type, actor, entity_type, entity_id, payload}`. Actor is
  `system`, `user:<id>`, or `agent:<name>`.

## The core loop

```
scheduler tick
  -> pages where next_check_at <= now (ordered by due time, bounded batch)
  -> for each page: pipeline.processPage(page)
       fetch (robots, UA, timeout)                 event: page.fetched | page.fetch_failed (-> status)
       extract text
       if a change is pending confirmation:
         same as pending content & delay elapsed   event: change.confirmed -> analyse -> insight
         reverted to previous content              event: change.discarded_unconfirmed
       compare hash with latest snapshot
         same  -> touch last_seen_at               event: page.unchanged
         diff  -> store snapshot                   event: snapshot.created
                  detect(prevText, newText)
                    below noise threshold          event: change.ignored_noise
                    else store Change (pending_confirmation) and re-check after CONFIRM_DELAY_MINUTES
                                                   event: change.detected, change.pending_confirmation
       schedule next_check_at (+ exponential backoff on failure), update page.status
  -> jobs: weekly digests (digest.sent | digest.skipped), auth token purge
```

Scans are idempotent per (page, content hash), so re-running after a crash is
safe.

## Change detection strategy

The product lives or dies on noise filtering. MVP approach (`monitor/detect.ts`):

1. Extract *main text* only: drop `script/style/noscript/svg/iframe`, `nav`,
   `header`, `footer`, cookie banners and elements with common ad/consent
   class names. Collapse whitespace.
2. Normalise volatile tokens before hashing: dates, times, "x minutes ago",
   view/like counters, CSRF tokens, long hex/base64 strings.
3. Diff line-by-line. Compute significance from the fraction of changed
   characters, presence of money amounts / percentages / launch vocabulary,
   and page kind weighting (pricing pages weigh more).
4. Below threshold -> ignored (recorded as event for tuning). Otherwise -> the
   analyser decides `matters`.

Later: DOM-region-aware diffs, per-site learned noise, screenshot diffs.

## AI analysis

`Analyzer.analyze(input) -> InsightDraft` where input includes the business
context, competitor name, page kind/URL, and the diff (bounded in size). Output
is strict JSON validated by zod; invalid output is retried once then falls back
to the heuristic analyser. Every model call emits an `ai.call` event with
tokens and estimated cost so spend is visible in structured data.

Cost controls: only diffs above the noise threshold reach the model; a daily
call cap (`AI_DAILY_CALL_CAP`); small model by default.

## Adding social sources later

Implement `Source` (`sources/types.ts`): `fetch(page) -> {text, raw, meta}`.
The pipeline is source-agnostic from extraction onwards. Candidates, in order
of legitimacy and feasibility: RSS/Atom feeds and blogs, YouTube Data API,
Meta Graph API (Instagram/Facebook *business* accounts, incl. public
business-discovery), X API (paid), LinkedIn (no viable public API). See
`docs/04-risks.md`.

## Agent-facing API and permission tiers

All operations are available as JSON under `/api/*`. Agents are expected to
use the API with scoped API keys (not yet implemented). Actions are classified:

| Tier                          | Examples                                                                    |
|-------------------------------|-----------------------------------------------------------------------------|
| 1. Autonomous                 | run scans, generate insights, answer support questions, write blog drafts, read metrics |
| 2. Manager-AI approval        | change scan cadence globally, pause a customer, send bulk email, tweak prompts, start an A/B experiment |
| 3. Human approval             | change prices/plans, refunds over a threshold, new paid vendor, deploy infra changes, delete customer data, spend above budget |

Design rule: agents never hold credentials for payments, DNS, cloud consoles or
production databases. They act through the RivalWatch API, which enforces the
tier and records an `agent.action` / `approval.requested` event. Approval
requests are rows, not chat messages.

## Observability

- Structured JSON logs to stdout (`logger.ts`).
- The `events` table is the primary metrics source. `/api/events` and
  `/api/stats` expose it. Owner dashboard will read from here.
- `/health` returns DB status, scheduler status and last tick time.

## Security / credentials

- Secrets only via environment variables (`.env` locally, platform secrets in
  prod). `.env` is gitignored. `config.ts` is the only reader.
- The demo site and admin-ish endpoints are local-only until auth exists.
- Fetcher respects robots.txt, identifies itself, rate-limits per host, and
  never executes remote JavaScript.
