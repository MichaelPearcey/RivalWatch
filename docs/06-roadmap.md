# Roadmap

Rough order. Each item should be small enough for a single Devin session.

## Phase 0 - Foundation + core-loop MVP (this repo, done)

- [x] Repo, TypeScript, SQLite, migrations, event log
- [x] Polite fetcher + main-text extraction
- [x] Snapshot storage, change detection with noise filtering
- [x] Analyzer interface, heuristic + Anthropic providers
- [x] Scheduler + pipeline
- [x] JSON API + minimal server-rendered UI
- [x] Demo competitor site, seed, tests, docs

## Phase 1 - Deployable multi-tenant product for real-world testing (done)

- [x] Competitor page auto-discovery with user confirmation
- [x] "Confirm on next fetch" for all detected changes (A/B-test noise)
- [x] Insight feedback (useful / not useful / incorrect / too noisy) as events
- [x] Re-analyse endpoint and prompt versioning
- [x] Weekly digest email behind a provider interface (log + Resend)
- [x] Magic-link auth, accounts, API keys, tenant scoping on every row
- [x] Explicit monitoring statuses; failures never shown as healthy
- [x] Anthropic provider with daily call + cost caps and per-call cost logging
- [x] Owner/admin dashboard (users, pages, fetch health, insights, LLM cost, errors, emails)
- [x] Dockerfile + Railway config + deployment/secrets docs
- [ ] Per-insight alert emails for importance >= 4 (Pro)
- [ ] CI on GitHub Actions (`npm run check`)
- [ ] Litestream/scheduled SQLite backups
- [ ] Snapshot retention (drop raw HTML after N days)
- [ ] Headless-browser fallback for CONTENT_UNREADABLE pages

## Phase 2 - Paid product

- [ ] Stripe Checkout + Customer Portal; subscription events
- [ ] Onboarding: "enter your site + 3 competitors" -> auto-configure pages
- [ ] Historical trends per competitor (price timeline, launch cadence)
- [ ] Comparison view: you vs competitors on price/positioning
- [ ] Monthly strategic analysis (Plus)
- [ ] RSS/blog source, YouTube source

## Phase 3 - Agent-operated company

- [ ] Scoped API keys with permission tiers; `approvals` table + owner inbox
- [ ] Owner dashboard: MRR, signups, churn, scan health, AI spend, agent actions, pending approvals
- [ ] Support AI reading `events` + customer data via API
- [ ] Growth AI: content drafts, experiments (`experiments` table)
- [ ] Meta Graph API source (connected Instagram business accounts)
