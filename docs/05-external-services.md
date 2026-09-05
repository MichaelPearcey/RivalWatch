# External Services and Credentials

Nothing in this list has been purchased or activated. Each requires an explicit
owner decision (tier 3). Estimated costs are for the first ~100 customers.

| Service | Purpose | When | Est. cost | Credential / env var | Notes |
|---------|---------|------|-----------|----------------------|-------|
| Anthropic API | Change analysis / insights | Before first real user | ~£5-20/month at MVP volumes | `ANTHROPIC_API_KEY` | Alternative: OpenAI. Provider is swappable. Use a small model (Haiku-class). |
| Fly.io or Railway | Hosting (1 small VM + 1GB volume) | Before beta | ~£5/month | platform token held by owner/CI only | Single container, SQLite on volume. |
| Domain + DNS (e.g. Cloudflare) | rivalwatch.* | Before beta | ~£10/year | registrar login (owner only) | Cloudflare free tier for DNS/TLS proxy. |
| Resend or Postmark | Transactional email: alerts, weekly reports, magic links | Beta | free tier -> ~£15/month | `EMAIL_API_KEY` | Needs domain verification (DKIM/SPF). |
| Stripe | Subscriptions, invoicing, tax | Paid launch | 1.5% + 20p per UK card txn | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Use Stripe Checkout + Customer Portal to avoid building billing UI. |
| Sentry | Error tracking | Beta | free tier | `SENTRY_DSN` | Optional; structured logs may suffice initially. |
| Object storage (Cloudflare R2 / Backblaze B2) | SQLite backups via Litestream | Beta | < £1/month | `LITESTREAM_*` | |
| Meta for Developers app | Instagram/Facebook business discovery | Post-MVP social | free | `META_APP_ID`, `META_APP_SECRET` | Requires app review; customers connect their own IG business account. |
| Google Cloud project | YouTube Data API | Post-MVP social | free quota | `YOUTUBE_API_KEY` | |
| X API | Competitor tweets | Only if demanded | $100+/month | `X_BEARER_TOKEN` | Likely not viable at our price point. |
| GitHub | Repo, CI (Actions) | Now | free | owner account | CI runs `npm test` and `npm run typecheck`. |

## Credential handling rules

- Secrets live only in environment variables (local `.env`, gitignored) and in
  the hosting platform's secret store.
- Agents (including Devin) get **scoped RivalWatch API keys**, never vendor
  credentials. Vendor credentials are held by the owner and the deployment
  platform only.
- Rotation: document the date and rotator in `docs/03-decisions.md` or an ops
  log event (`ops.secret_rotated`, no secret values).
- The Devin `upload-secrets` skill can push local secrets to the Devin cloud
  secret manager without exposing values in conversation.
