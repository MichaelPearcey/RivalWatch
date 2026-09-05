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

## Phase 1 - Make it useful for a real first user

- [ ] Competitor page auto-discovery (pricing / products / blog links from home page)
- [ ] "Confirm on next fetch" for medium-significance changes (A/B-test noise)
- [ ] Insight feedback (useful / not useful) recorded as events; use to tune prompts
- [ ] Re-analyse endpoint and prompt versioning
- [ ] Weekly digest email (Resend) + per-insight alerts for importance >= 4
- [ ] Magic-link auth, multi-tenant scoping, plan limits enforced from `plans.ts`
- [ ] Deploy to Fly.io with Litestream backups; CI on GitHub Actions

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
