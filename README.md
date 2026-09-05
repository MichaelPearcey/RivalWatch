# RivalWatch

AI-filtered competitor monitoring for solopreneurs and small businesses.

> Tell us who your competitors are. We continuously watch them and tell you
> when something happens that actually matters.

```
account/user -> business + competitors -> page discovery (user confirms)
  -> scheduled polite fetch -> snapshot -> change detection -> confirm on next fetch
  -> AI decides if it matters (hard-capped spend, heuristic fallback)
  -> plain-English insight -> dashboard / weekly digest email / JSON API
  -> user feedback (useful / not useful / incorrect / too noisy)
every step -> structured audit event (actor, action, target, risk, result, cost)
```

Read `docs/` first if you are new (human or agent):

- `docs/01-vision.md` - product, customers, pricing, operating model
- `docs/02-architecture.md` - stack, layout, domain model, the loop, permission tiers
- `docs/03-decisions.md` - ADRs (why things are the way they are)
- `docs/04-risks.md` - crawling, social APIs, AI, ops risks and mitigations
- `docs/05-external-services.md` - services/credentials
- `docs/06-roadmap.md` - what comes next
- `docs/07-deployment.md` - Railway deployment, env vars, secrets, costs, runbook

## Requirements

- Node.js >= 22.13 (built-in `fetch` and `node:sqlite`; no native builds)
- No database server, no Docker locally, no API keys needed to run or test

## Quick start

```bash
npm install
cp .env.example .env        # optional; defaults work (heuristic AI, log-only email)
npm run demo                # server + fake competitor; runs the whole loop; prints a sign-in link
```

Other commands:

```bash
npm run dev                          # server with reload, scheduler on
npm run check                        # typecheck + tests (~1.5s, in-memory SQLite, no network)
npm run build && npm start           # production build
npm run cli -- tick                  # process due pages + jobs once (cron-friendly)
npm run cli -- make-admin you@x.com  # grant the owner dashboard
npm run cli -- login-link you@x.com  # print a one-time sign-in link (log email provider)
node scripts/github-create-repo.mjs  # create the private GitHub repo (GITHUB_TOKEN from .env)
```

## Configuration

Environment variables only; see `.env.example` (documented) and
`docs/07-deployment.md` (production values). Secrets: `ANTHROPIC_API_KEY`,
`RESEND_API_KEY`. Never commit `.env`.

## API

Authenticate with the session cookie (browser) or `Authorization: Bearer rw_…`
(API keys from `/settings`; actions are attributed to `agent:<name>`). All
data is scoped to the caller's account.

```
GET  /health                         GET  /api/me                 GET  /api/plans
POST /auth/login {email}             GET  /auth/verify?token=     POST /auth/logout
GET/POST   /api/businesses           GET/PATCH/DELETE /api/businesses/:id
GET/POST   /api/businesses/:id/competitors        DELETE /api/competitors/:id
GET/POST   /api/competitors/:id/pages             POST /api/competitors/:id/discover
GET        /api/competitors/:id/suggestions       POST /api/suggestions/:id/accept|dismiss
GET/DELETE /api/pages/:id            POST /api/pages/:id/pause|resume|scan
GET  /api/pages/:id/snapshots        GET  /api/pages/:id/changes  GET /api/snapshots/:id?raw=1
POST /api/businesses/:id/scan        POST /api/businesses/:id/digest/send
GET  /api/businesses/:id/insights?include_noise=1   GET /api/insights/:id
POST /api/insights/:id/feedback {verdict, comment?}  POST /api/insights/:id/read
GET  /api/changes/:id                POST /api/changes/:id/reanalyze
GET  /api/events?type=&since=&limit= (own account)
GET/POST /api/api-keys               DELETE /api/api-keys/:id
Admin: GET /api/admin/overview  GET /api/admin/events  POST /api/admin/scheduler/tick  POST /api/admin/digests/run
```

Page monitoring status is one of `ACTIVE | ROBOTS_BLOCKED | AUTH_REQUIRED |
RATE_LIMITED | FETCH_ERROR | CONTENT_UNREADABLE | PAUSED`. Anything other than
ACTIVE is shown as a problem, never as healthy.

## Status

Phase 1: multi-tenant, passwordless auth, deployable. Websites only. No billing
yet (plans are set by the operator). See `docs/06-roadmap.md` and the "known
limitations" in `docs/07-deployment.md`.
