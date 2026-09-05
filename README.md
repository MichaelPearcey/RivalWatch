# RivalWatch

AI-filtered competitor monitoring for solopreneurs and small businesses.

> Tell us who your competitors are. We continuously watch them and tell you
> when something happens that actually matters.

This repository contains the technical foundation and the core-loop MVP:

```
business + competitors -> periodic fetch -> snapshots -> change detection
  -> AI decides if it matters -> plain-English insight -> UI / JSON API
```

Read `docs/` first if you are new (human or agent):

- `docs/01-vision.md` - product, customers, pricing, operating model
- `docs/02-architecture.md` - stack, layout, domain model, the loop, permission tiers
- `docs/03-decisions.md` - ADRs (why things are the way they are)
- `docs/04-risks.md` - crawling, social APIs, AI, ops risks and mitigations
- `docs/05-external-services.md` - services/credentials we will eventually need
- `docs/06-roadmap.md` - what comes next

## Requirements

- Node.js >= 22.13 (uses built-in `fetch` and `node:sqlite`; no native builds)
- No database server, no Docker, no API key needed to run or test

## Quick start

```bash
npm install
cp .env.example .env        # optional; defaults work
npm run demo                # boots the server + fake competitor, runs the whole loop, prints insights
```

Then open `http://127.0.0.1:3000/b/1`.

Other commands:

```bash
npm run dev                 # server with reload, scheduler on
npm run check               # typecheck + tests
npm test                    # tests only (in-memory SQLite, no network)
npm run build && npm start  # production build
npm run cli -- tick         # process due pages once (cron-friendly)
npm run cli -- scan 1       # scan every page of business 1 now
```

## Configuration

All via environment variables; see `.env.example`. Notable:

| Var | Default | Meaning |
|-----|---------|---------|
| `AI_PROVIDER` | `heuristic` | `heuristic` (free, deterministic) or `anthropic` (needs `ANTHROPIC_API_KEY`) |
| `AI_DAILY_CALL_CAP` | `500` | Max LLM calls per rolling 24h; excess falls back to heuristic |
| `SCHEDULER_ENABLED` | `true` | Run the in-process scan loop |
| `DEMO_SITE_ENABLED` | `true` | Serve the mutable fake competitor at `/demo/*`. **Set `false` in production.** |
| `DATABASE_PATH` | `./data/rivalwatch.db` | SQLite file; `:memory:` for ephemeral |

## API (agent-facing)

Everything the UI does is available as JSON. Agents should send `X-Actor: agent:<name>` so events are attributed.

```
GET  /health                                  GET  /api/stats            GET /api/events?type=&since=&limit=
GET  /api/plans
GET/POST /api/businesses                      GET/PATCH /api/businesses/:id
GET/POST /api/businesses/:id/competitors      DELETE /api/competitors/:id
GET/POST /api/competitors/:id/pages           DELETE /api/pages/:id
POST /api/businesses/:id/scan                 POST /api/pages/:id/scan     POST /api/scheduler/tick
GET  /api/businesses/:id/insights?include_noise=1   GET /api/insights/:id   POST /api/insights/:id/read
GET  /api/changes/:id                         POST /api/changes/:id/reanalyze
GET  /api/pages/:id/snapshots                 GET  /api/snapshots/:id?raw=1
```

Demo site controls (local only): `GET/POST /demo/state`, `POST /demo/reset`.

## Status

MVP. Single tenant, no auth, no billing, no email. Websites only. Do not
expose publicly yet. See `docs/06-roadmap.md`.
