# Technical Risks and Mitigations

## 1. Website crawling

| Risk | Detail | Mitigation |
|------|--------|------------|
| Anti-bot blocking | Cloudflare / Akamai / Vercel bot protection returns 403 or challenge pages. | Identify honestly (UA with contact URL), low frequency, per-host delay, respect robots.txt. Record `page.fetch_failed` with status so blocked pages are visible. Later: optional headless browser fallback (Playwright) for a minority of pages; residential proxies are **out** on cost and ethics grounds. |
| JavaScript-rendered content | SPA pricing pages have no server-rendered text. | Detect "thin" pages (very little text, big script payload) and flag them in the UI. Later: Playwright fallback for flagged pages only. Many sites still SSR pricing for SEO. |
| Noise | Rotating testimonials, dates, A/B tests, cookie banners, counters. | Main-content extraction, volatile-token normalisation, significance threshold, and an `ignored_noise` event stream we can use to tune. A/B tests are the hardest: mitigate with "confirm on next fetch" for medium-significance changes (planned). |
| Legal / ToS | Fetching public pages is generally lawful in the UK/EU/US for publicly available data, but some sites' ToS prohibit automated access. | Respect robots.txt, never bypass auth or paywalls, low volume, store only what is needed, honour takedown requests. Add a bot info page. Get a short legal review before public launch. |
| Cost of fetching | Trivial: a few KB per page, a few pages per competitor. | n/a |
| Being blocked as a whole | Shared IP of the host gets blocked. | Rotate hosting region if needed; keep volume tiny; contact sites proactively when possible. |

## 2. Social media data (the biggest product risk)

Honest assessment of what is legitimately possible:

| Platform | Legitimate access | Notes |
|----------|-------------------|-------|
| Instagram / Facebook | Meta Graph API. Requires an app review. *Business Discovery* lets a business account read public posts/metrics of **other** business/creator accounts (by username). | Best option for "watch competitor Instagram". Customer must connect their own Instagram Business/Creator account (Facebook login). Rate limits are generous. Personal accounts of competitors are not accessible. |
| YouTube | YouTube Data API (free quota 10k units/day). | Easy, official, public channels. |
| X / Twitter | Official API, paid tiers (Basic ~$100+/month) for reading. | Expensive relative to our price point; defer, possibly Plus-only. |
| LinkedIn | No public read API for company page content of others. | Not feasible legitimately. Monitor their website/blog instead. |
| TikTok | Research API (restricted), Display API (own account only). | Not feasible for competitor monitoring initially. |
| Blogs / newsletters | RSS/Atom, sitemap.xml, `/blog` page monitoring. | Cheap, official, high signal for "content strategy changes". |

Decision: never scrape Instagram/X/LinkedIn unofficially. Build RSS + YouTube +
Meta Graph (connected account) in that order after the website MVP.

## 3. AI analysis

| Risk | Mitigation |
|------|------------|
| Hallucinated numbers / wrong "why it matters" | Feed only the diff and structured context; require the model to quote figures present in the diff; validate JSON; show the underlying diff in the UI so users can verify. |
| Cost per scan | Only diffs above threshold reach the model; small model; daily cap; token usage recorded per call. Target: < £0.002 per analysed change. |
| Provider outage | Heuristic fallback keeps the loop running with reduced quality; changes are stored and can be re-analysed later (`POST /api/changes/:id/reanalyze`). |
| Prompt injection from competitor pages | Treat page text as untrusted data in the prompt, never as instructions; output schema is closed; the analyser has no tools. |

## 4. Operations

| Risk | Mitigation |
|------|------------|
| Single SQLite file loss | Nightly copy / Litestream to object storage before launch. |
| Scheduler drift / duplicate work | Idempotent per (page, hash); one instance only; `/health` reports last tick. |
| Agent misuse of API | Permission tiers, scoped API keys, all agent actions logged as events. Not in MVP. |
| Secret leakage | Only `config.ts` reads env; secrets never logged; `.env` gitignored. |

## 5. Product

| Risk | Mitigation |
|------|------------|
| Insights are boring or wrong -> churn | Keep `matters=false` insights for tuning; add thumbs up/down feedback (planned) as an event to drive prompt iteration. |
| Users don't know which competitor pages to add | Auto-discover pricing/products/blog links from the competitor's home page (planned: `sources/website/discover.ts`). |
