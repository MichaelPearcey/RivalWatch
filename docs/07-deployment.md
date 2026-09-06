# Deployment and Secrets

Target: Railway (owner decision, 2026-09-05). One service, one volume, no
database server. Everything below is also valid for Fly.io/Render with a
persistent disk.

## Architecture in production

```
Railway service (Dockerfile) ── PORT injected ── HTTPS via Railway domain
  └── node dist/index.js  (API + UI + scheduler in one process)
        └── SQLite at /data/rivalwatch.db  (Railway volume mounted at /data)
Outbound: competitor websites, api.anthropic.com, api.resend.com
```

Exactly **one replica**. The scheduler is in-process and assumes a single
instance; running two would double-fetch. (`railway.json` pins `numReplicas: 1`.)

## First deployment (owner, ~10 minutes)

1. Railway → New Project → Deploy from GitHub repo → `MichaelFinchetto/rivalwatch`.
   Railway detects `railway.json` and builds the Dockerfile.
2. Service → **Volumes** → add volume, mount path `/data`.
3. Service → **Settings → Networking** → Generate Domain. Note the URL.
   **Port: Railway injects `PORT=8080` into the container and the app listens
   on whatever `PORT` is, so the domain's target port must be `8080`** (not the
   Dockerfile's `EXPOSE 3000`). A wrong port shows as `502 Bad Gateway` while
   the deployment is green. The deploy log line `rivalwatch listening` shows the
   actual port.
4. Service → **Variables** → set (see table). At minimum:
   `NODE_ENV=production`, `PUBLIC_URL=https://<domain>`, `ADMIN_EMAILS=<you>`,
   `DATABASE_PATH=/data/rivalwatch.db`.
5. Redeploy. Check `https://<domain>/health` returns `{"status":"ok"}`.
6. **First sign-in without email.** Until Resend is configured no magic link
   can be delivered, so use the one-time bootstrap:
   - add variable `BOOTSTRAP_ADMIN_TOKEN=<random string, 16+ chars>` and deploy;
   - open `https://<domain>/auth/bootstrap?token=<that string>&email=<an ADMIN_EMAILS address>`;
   - you land on `/admin` signed in. Each token *value* works exactly once and
     records a high-risk audit event. Locked out again (lost cookie, email
     down)? Set a **new** value for `BOOTSTRAP_ADMIN_TOKEN` and repeat.
   - **Delete the `BOOTSTRAP_ADMIN_TOKEN` variable** when you don't need it.
   Later, once Resend is live, everyone (including you) signs in at `/login`.

> **Railway UI gotcha:** variable edits are *staged*. After editing, click the
> purple **Deploy / Apply changes** button at the top of the service, otherwise
> the running container keeps the old environment and the app exits with
> `RivalWatch cannot start: PUBLIC_URL is required in production`.

## Environment variables

| Variable | Production value | Secret? | Notes |
|----------|------------------|---------|-------|
| `NODE_ENV` | `production` | no | Enforces PUBLIC_URL, forbids demo site, binds 0.0.0.0 |
| `PORT` | (Railway injects) | no | |
| `PUBLIC_URL` | `https://<domain>` | no | Used in magic links and digests |
| `DATABASE_PATH` | `/data/rivalwatch.db` | no | Must be on the volume |
| `ADMIN_EMAILS` | `owner@…` | no | Comma-separated; grants the owner dashboard |
| `AI_PROVIDER` | `anthropic` | no | `heuristic` to disable spend entirely |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | **yes** | Create at console.anthropic.com with a **monthly spend limit** |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5` | no | Any Claude model id |
| `AI_DAILY_CALL_CAP` / `AI_DAILY_COST_CAP_USD` | `300` / `2` | no | Hard caps; beyond them the heuristic analyser is used |
| `AI_INPUT_COST_PER_MTOK` / `AI_OUTPUT_COST_PER_MTOK` | `1.0` / `5.0` | no | For cost estimates; match the model's list price |
| `EMAIL_PROVIDER` | `resend` | no | `log` until the domain is verified |
| `RESEND_API_KEY` | `re_…` | **yes** | Create at resend.com; restrict to "sending access" |
| `EMAIL_FROM` | `RivalWatch <digest@yourdomain>` | no | Domain must be verified in Resend (DKIM + SPF) |
| `BOOTSTRAP_ADMIN_TOKEN` | random, 16+ chars, **temporary** | **yes** | Enables `/auth/bootstrap` for the very first admin sign-in; remove afterwards |
| `CONFIRM_DELAY_MINUTES` | `60` | no | |
| `DIGEST_WEEKDAY` / `DIGEST_HOUR_UTC` | `1` / `8` | no | Monday 08:00 UTC |
| `FETCH_USER_AGENT` | include a real contact URL | no | Site owners must be able to reach us |
| `DEMO_SITE_ENABLED` | `false` | no | App refuses to start otherwise in production |

## Secret handling rules

- Secrets exist in exactly two places: the owner's password manager and the
  Railway **Variables** panel (encrypted at rest, injected as env vars). Never
  in git, Dockerfile, logs, or chat.
- `src/config.ts` is the only code that reads env. `/health` shows config only
  to admins and always redacts secret values.
- Local development uses `.env` (gitignored). `.env.example` documents keys only.
- Devin/agents never receive vendor credentials. They use RivalWatch API keys
  (`/settings`) which are scoped to one account and attributed as `agent:<name>`.
- Rotation: create new key at the vendor → update Railway variable → redeploy →
  revoke old key. Record an `ops` note in `docs/03-decisions.md`.

## Backups

The SQLite file is the whole system. Until Litestream is added (roadmap):
`railway volume` snapshots, or `railway run` + `sqlite3 /data/rivalwatch.db ".backup /data/backup.db"`
and download. Do this before every schema migration deploy.

## Operating costs (recurring, at the time of writing)

| Item | Cost | Notes |
|------|------|-------|
| Railway Hobby plan | $5/month, includes $5 usage credit | A single small service typically fits in the credit |
| Railway volume | $0.25/GB-month (first GB usually within credit) | |
| Anthropic API | usage-based; ≈ $0.001–0.003 per analysed change with Haiku | Capped in-app at `AI_DAILY_COST_CAP_USD` (default $2/day ⇒ ≤ $60/month worst case). Set a lower monthly limit in the Anthropic console. |
| Resend | free up to 3,000 emails/month | Domain required for non-test sending |
| GitHub private repo | free | |

Nothing is spent until the owner creates the Railway project and the vendor
keys.

## Upgrades

`git push` → Railway rebuilds → restarts. Migrations run automatically at boot
(`openAndMigrate`). Migrations are additive-only; downgrade = redeploy previous
image + restore backup.

## Runbook

| Symptom | Where to look | Likely fix |
|---------|---------------|------------|
| `/health` degraded | Railway logs `db` | Volume not mounted / path wrong |
| `502 Bad Gateway` with a green deploy | Settings → Networking → domain port | Must equal the `PORT` Railway injects (8080) |
| `Cannot open database at /data/...` | Deploy logs | Volume permissions; the entrypoint chowns `/data` - ensure the image is current |
| Users not receiving links | `/admin` → Recent emails; `email.failed` events | Resend domain not verified; wrong `EMAIL_FROM` |
| Pages stuck non-ACTIVE | `/admin` → Unhealthy pages | See status: AUTH_REQUIRED ⇒ site blocks bots (pause or drop page); RATE_LIMITED ⇒ backoff is automatic; CONTENT_UNREADABLE ⇒ JS-rendered page (roadmap: headless fallback) |
| Insights say `heuristic` though Anthropic is on | `ai.cap_reached` / `ai.failed` events | Raise caps or fix key |
| Scheduler `lastTickAt` stale | `/health` | Restart service; check logs for `scheduler.error` |
