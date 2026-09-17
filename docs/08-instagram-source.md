# Instagram as a source - what it takes (CTO setup + build plan)

Raised by Maria: Ukrainian small businesses (her example: dance studios) often have
no website at all, only an Instagram profile. Two of her competitors are Instagram
links; today they sit in the app as `ROBOTS_BLOCKED` and collect nothing.

## Why they are blocked

`https://www.instagram.com/robots.txt` is `Disallow: /` for `User-agent: *`, and the
file carries an explicit notice that automated collection requires written permission
from Instagram. Our fetcher obeys robots, so it refuses - correctly. **We are not
going to scrape around this**: it breaks Meta's terms and gets IPs and accounts
banned. The only route is Meta's own API.

## The legitimate route: Business Discovery

Meta's Instagram API (with Facebook Login) has a `business_discovery` edge: *our*
Instagram professional account may request **public** data about **other**
professional (Business/Creator) accounts by username.

`GET /<our-ig-user-id>?fields=business_discovery.username(<competitor>){followers_count,media_count,media{caption,timestamp,permalink,like_count,comments_count}}`

Token permissions required: `instagram_basic`, `instagram_manage_insights`,
`pages_read_engagement` (plus `ads_management`/`ads_read` if the Page role came via
Business Manager).

Two hard limits to design around, not bugs:

- **Target must be a professional account.** Personal accounts return nothing, and
  age-gated accounts are excluded. Most studios/salons are Business accounts, but it
  is per-competitor luck and the UI must say so plainly.
- **Prices live in captions or not at all.** We get caption text, not the image. A
  studio that posts its price list as a graphic is invisible to us; we do not do OCR.
  Our hryvnia price parser already handles `800 грн/міс.` in caption text.

## Phase 1 - internal, no App Review (do this first)

App Review is **not required** while the app only serves a business we own. That is
enough to run Instagram monitoring for Maria's own testing and for hand-held early
customers.

CTO checklist (Michael - accounts, not code):

1. Switch the RivalWatch Instagram account to **Professional (Business)**.
2. Create/attach a **Facebook Page** and link the Instagram account to it.
3. Create an app at developers.facebook.com, add the Instagram product, and generate
   a long-lived Page/User access token with the permissions above.
4. Store it as `META_IG_TOKEN` and `META_IG_USER_ID` - Railway variables via
   `scripts/railway-set-secret.ps1`, never in the repo or in chat.

Cost: free at our volumes. Rate limits are generous for a handful of competitors
checked daily.

## Phase 2 - customer-facing, App Review required

Serving many businesses means Advanced Access, which means App Review: a working
product, a screencast of the flow, a privacy policy on our own domain, and Meta's
review queue (weeks, not days, and they can come back with questions). Sequence it
after the first paying customers rather than before - Phase 1 already unblocks the
product question of "can we watch an Instagram-only competitor at all".

## Build plan once the token exists (roughly one session)

- `src/sources/instagram/` implementing `Source` (`src/sources/types.ts`), registered
  in `src/app.ts`; the pipeline stays source-agnostic.
- Normalise into `FetchResult.text` as the recent captions joined newest-first, so
  diffing, price extraction and the analyser work unchanged.
- `meta`: `followers_count`, `media_count`, post permalinks and timestamps, so the
  detector can report "new post", "follower jump", "price changed in a caption".
- New failure mapping: a non-professional or missing target account is
  `auth_required` (never a silent empty page), surfaced as a translated explanation
  rather than a red error badge.
- Detect Instagram URLs at competitor-add time and route them to this source
  automatically; if no token is configured, say so in the user's language instead of
  pretending to monitor.

## Until then

Competitor Instagram links stay `ROBOTS_BLOCKED`. Worth a small separate change:
recognise social URLs and replace the generic "blocked by the site" badge with a
plain-language explanation of why, so it does not read as a bug.
