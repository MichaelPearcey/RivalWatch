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
- [x] CI on GitHub Actions (`npm run check`)
- [x] Nightly gzipped SQLite backups + retention; optional S3/R2 off-site (bucket pending)
- [x] Snapshot retention (raw HTML dropped after 30 days)
- [ ] Per-insight alert emails for importance >= 4 (Pro) - big *news* alerts exist; page-change alerts still to do
- [ ] Headless-browser fallback for CONTENT_UNREADABLE pages

## Phase 1.5 - Company + front door (done, September 2026)

- [x] Approvals primitive (tiered risk, human/manager approver) and audited execution
- [x] Agent framework with Support/Ops, Manager and Growth agents on schedules
- [x] Public site: landing, pricing, privacy, terms, crawler page; dark/light design system; self-hosted font
- [x] Password sign-in and password sign-up (scrypt), email verification, lockout
- [x] UK GDPR plumbing: versioned consent, JSON export, account deletion with grace period
- [x] Six UI languages (EN, UK, RU, DE, FR, ES); AI insights and digests in the user's language
- [x] Automatic competitor profiles (summary, target customers, USPs, products, pricing) fed into analysis
- [x] Competitor news via public RSS, LLM-classified; big news panel, instant alerts, digest section
- [x] Founder assistant chat in /admin with shared memory that Devin reads and writes

## Phase 2 - Paid product

- [ ] Founder assistant can propose code changes as GitHub pull requests; merge is an approval
- [ ] Stripe Checkout + Customer Portal; subscription events
- [ ] Onboarding: "enter your site + 3 competitors" -> auto-configure pages
- [ ] Historical trends per competitor (price timeline, launch cadence)
- [ ] Comparison view: you vs competitors on price/positioning
- [ ] Monthly strategic analysis (Plus)
- [ ] RSS/blog source, YouTube source

## Phase 3 - Agent-operated company (foundation done 2026-09-06)

- [x] Scoped API keys; `approvals` table + owner inbox (ADR-015)
- [x] Owner dashboard: users, plans, scan health, AI spend, agent runs/notes, pending approvals
- [x] Agent framework with closed tool set, cost caps, audit (ADR-016)
- [x] Support/Ops, Manager and Growth agents (v1 prompts)
- [ ] MRR/churn on the dashboard (needs billing)
- [ ] Agent prompt iteration driven by owner feedback on notes/approvals
- [ ] Experiments table for Growth
- [ ] Meta Graph API source (connected Instagram business accounts)
