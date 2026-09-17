# VP Engineering report

Patch notes from Devin (VP of Engineering) for Michael (CTO) and Maria (CEO).
Newest entry first. Every push to `production` adds an entry here.

Conventions:

- **Live** = deployed to Railway (`https://rivalwatch-production-8a8f.up.railway.app`).
- Commits listed are on the `production` branch; the matching PR is the readable history.
- "Not covered" is deliberate: it says what was *not* tested, so nobody assumes more than was checked.

---

## 2026-09-09 — Instagram-only competitors: what it would take (docs only, no code)

**Live:** n/a — documentation.

Maria's real case: comparing dance studios where one has a website and two have only Instagram.
Those two competitors currently sit as "blocked by the site" and collect nothing, because
Instagram's robots.txt is `Disallow: /` for everyone and its notice forbids automated collection
without written permission. We obey it and will not work around it.

`docs/08-instagram-source.md` sets out the only legitimate route — Meta's `business_discovery` API —
split into Phase 1 (works for a business we own, **no App Review**, free: needs an IG Professional
account, a linked Facebook Page, an app and a token in `META_IG_TOKEN` / `META_IG_USER_ID`) and
Phase 2 (customer-facing, needs Meta App Review, weeks of queue). It also names the two limits worth
knowing before we promise anything: the competitor must be a Business/Creator account, and prices
are only visible when they are typed in captions — we do not read text in images.

**Michael:** Phase 1 is four account steps and no spend; the build is roughly one session after the
token exists.

Not covered: nothing was built or called against Meta. Token cost, rate limits and whether Maria's
two studios are professional accounts are all unverified.

---

## 2026-09-09 — Text no longer stops mid-word ("GPU-інстанси £20")

**Live:** pending deploy

With the AI producing Ukrainian again, QA found sentences ending mid-word or mid-price. Cause: the
length limits on each field chop at the exact character, and they were sized for English — Ukrainian
says the same thing in noticeably more characters. The limits are now roughly double, and when text
does have to be shortened it stops at the end of a sentence or word with a "…" instead of slicing
through a word or a price. The AI is also now told never to relabel a monthly price as yearly.

Not covered: QA also saw a monthly discount presented as a yearly figure and two clumsy Ukrainian
phrases. Only the instruction changed; whether the model obeys it needs another look. Nothing forces
grammatical prose — a native speaker still has to judge it.

---

## 2026-09-09 — A stuck profile can be retried from the page

**Live:** pending deploy

If profile generation was interrupted (a deploy restart mid-request, for example), the competitor
was left saying "Створюємо профіль…" forever with no button to try again — the retry button only
existed once a profile had been produced. The button now also appears when there is no profile yet,
and the card opens by default in that state instead of hiding it behind a collapsed heading.

Not covered: nothing retries automatically; the customer still has to press the button.

---

## 2026-09-09 — Root cause of the missing AI text: Ukrainian ran out of room

**Live:** pending deploy

The retry added earlier made the real cause visible: `stop_reason: max_tokens`. Cyrillic costs two
to three times as many tokens per character as English, so the length limits — set while the product
was English-only — cut Ukrainian profiles and briefings off mid-sentence, the JSON never closed, and
the page silently fell back to the no-AI version. Profiles now get 2200 tokens (was 900), the
landscape 4000 (was 1600), and a retry after a truncated reply doubles the budget again and asks for
shorter fields.

Not covered: this costs more per briefing (still inside the daily spend cap), and it has not yet
been observed producing a full Ukrainian briefing end to end — that is the next thing to check.

---

## 2026-09-09 — A malformed AI reply no longer costs the whole briefing

**Live:** pending deploy

QA showed two competitor profiles and one landscape silently falling back to the no-AI version:
the events say the model's reply was not valid JSON (once prose instead of JSON, once a broken
array), and we gave up on the first failure. Now the reply is prefilled with the opening brace so
the model cannot preface it with chat, and one retry is made with an explicit "JSON only" reminder
before falling back. The failure event records the attempt number and the stop reason, so the next
occurrence is diagnosable.

Not covered: cost — a retry is a second model call, still inside the existing daily call and spend
caps. Genuinely bad replies twice in a row still fall back to the no-AI version, by design.

---

## 2026-09-09 — AI told not to mix currencies, and to write proper Ukrainian

**Live:** pending deploy

QA of the generated landscape found the model describing a pound price as "набагато більше" than a
hryvnia one (no conversion exists, and none should), mislabelling an annual total as monthly, and
producing broken agreement ("з простим пропозицією", "вашу позиціонування"). The three prompts
(landscape, competitor profile, change analysis) now forbid comparing or converting across
currencies, require the source's own currency and billing period, and ask explicitly for
grammatically correct prose in the target language rather than a word-by-word translation.

Not covered: this steers the model, it does not guarantee the output — the wording still needs a
native-speaker eye, and Maria's review is the real test.

---

## 2026-09-09 — Long prices are no longer truncated

**Live:** pending deploy

QA on a real Ukrainian host found "31200грн" stored as "200грн": the amount pattern only allowed
three digits before a separator, so a price written without thousands separators lost its leading
digits. Amounts may now be any length, and matching can no longer start in the middle of a number.
While fixing it: "9,99 EUR" was read as 999, and is now 9.99 — a comma with one or two digits at the
end is a decimal, not a thousands separator.

Not covered: no rounding or currency conversion; we still store the price as the site writes it.

---

## 2026-09-09 — "100 Gbps" is no longer read as a price

**Live:** pending deploy

QA against a real host (krystal.io) showed the new currency matcher recording "100 Gbp" and
"2,000 Gbp" as prices, from "100 Gbps connectivity" and "2,000 Gbps DDoS protection". Currency codes
now have to end a word, so bandwidth, EURO-zone and similar near-misses are ignored. Real prices on
the same page were extracted correctly before and after.

Not covered: the AI analyser had already been ignoring these false prices, so the visible damage was
limited to the stored page data.

---

## 2026-09-09 — Legacy page encodings (windows-1251) decoded correctly

**Live:** pending deploy

Found while QA-ing the hryvnia work against a real Ukrainian host (hostprom.com): the fetcher decoded
every page as UTF-8, so any site served in windows-1251 — still common across the Ukrainian and
Russian web — arrived as replacement characters. The profile was unreadable and prices were reported
as "not published" even though the page shows them. The fetcher now honours the charset declared in
the `Content-Type` header or the document's own `<meta charset>` and falls back to UTF-8.

Pre-existing bug, not caused by the currency change; it only became visible because we started
looking at Ukrainian sites. Affected competitors need a re-scan to pick up readable text.

Not covered: no encoding *sniffing* — a page that declares nothing and is not UTF-8 is still read as
UTF-8.

---

## 2026-09-09 — Hryvnia (and other currencies) recognised in prices

**Live:** pending deploy

Maria asked for hryvnia support so Ukrainian businesses can use the product. Price recognition was
hard-coded to £/$/€ written before the amount, so "800 грн/міс." was invisible to the extractor, the
change detector and the profile fallback. Currency matching now lives in one place (`src/money.ts`)
and understands ₴/грн/UAH and zł/PLN, amounts written before the symbol, spaces as thousands
separators, and period words in Ukrainian and Russian (міс./мес./рік/год).

Two consequences worth knowing:

- The heuristic analyser now only compares a competitor's price with *your* price when both are in
  the same currency — before, it would happily have told a Ukrainian customer their hryvnia tier was
  "20% above" a pound one.
- The example text in the "Your pricing" field is now local: hryvnia for uk/ru, euro for de/fr/es.

Not covered: no currency conversion (we compare like with like, we do not convert), and the AI
analyser was not re-tested against a live Ukrainian pricing page — only the offline heuristics.

---

## 2026-09-08 — Message from the CEO to the CTO

Maria asks it be minuted that the second cheesecake, the one nominally allocated to Michael, was
consumed as taste-based market research. The company acknowledges the liability and will fund a
replacement cheesecake out of first profit.

---

## 2026-09-08 — New pricing headline wording

**Live:** yes

Maria rewrote the pricing headline: Ukrainian now reads "Чесні ціни. Без зайвого". Because the
three-part split (`pricing.h1a/b/c`) only existed to colour the middle word, it collapsed into a
single `pricing.h1` key, and the other five locales got the same two-sentence phrasing
(en "Honest pricing. Nothing extra", ru "Честные цены. Без лишнего", plus de/fr/es).

Not covered: only Ukrainian wording is native-speaker approved; the other five are my translations.

---

## 2026-09-08 — Plain pricing headline

**Live:** yes

Maria asked for the coloured word in the pricing headline to go: "Прості, **чесні** ціни" is now one
solid colour (the gradient span was removed from the pricing `h1`). The gradient stays on the home-page
hero, which is the brand element — say if that one should go plain too.

---

## 2026-09-07 — Ukrainian runtime localization fixes

**Commits:** `fb3534e`, `74f634d`, `4e3d9c7`, `9f6fe8f` · **PR:** [#7](https://github.com/MichaelPearcey/RivalWatch/pull/7) · **Live:** yes

Live Ukrainian QA found that translations were correct but the *runtime* leaked English. Fixed:

- **Language now sticks from signup.** The locale a visitor is reading in is stored on the new user
  (`auth.signupWithPassword` / `auth.verify` → `repo.createUser`), so the first AI profile and the first
  landscape briefing are generated in their language instead of English.
- **Plural-aware counts.** New `t.plural(key, n)` with `one` / `few` / `many` forms in all six locales,
  covering dashboard stats, plan limits, check cadence and the profile source caption
  ("На основі 1 сторінки" / "На основі 2 сторінок"). A compile-time check fails the build if a form is missing.
- **App-authored English removed** from generated content: profile fallbacks ("Not determined automatically",
  "Prices mentioned"), discovery reasons (now stored as locale-neutral codes), form placeholders and email labels.
- **Validation errors are readable.** Browsers get one translated sentence instead of raw Zod diagnostics;
  the JSON API still returns the structured issues.
- **Landscape prompt** no longer forces the English phrase "Not known yet" — the model writes unknown-value
  wording in the reader's language.
- **Heuristic landscape** no longer counts a price-free prose summary as "pricing we have read".
- **Settings reachable on mobile** (the link was hidden below 640px) and misleading "add a competitor below"
  empty-state wording corrected in every locale.

Verified by browser QA on the live site plus local fixtures: signup locale, validation, counts, profile
fallbacks, exports, Settings language round-trip, 390px layout. Full evidence in the PR comment.

**Not covered:** real email delivery, opening the export in Microsoft Word itself, the News feed on a
brand-new (empty) account, and native-speaker sign-off on the new strings.

---

## 2026-09-07 — Ukrainian wording review from Maria

**Commit:** `21c2dbc` · **PR:** [#6](https://github.com/MichaelPearcey/RivalWatch/pull/6) · **Live:** yes

Applied all 45 native-speaker corrections from Maria's review document, plus a few obvious typo fixes
flagged back to her. One known limit at the time: number agreement — now fixed in the entry above.

---

## 2026-09-07 — Dashboard redesign, landscape briefing, exports

**Commits:** `97739a7`…`7183ce7`, `6adbe39` · **PR:** [#5](https://github.com/MichaelPearcey/RivalWatch/pull/5) · **Live:** yes

- Competitor dashboard rebuilt around four tabs: Overview, News, Competitors, Landscape.
- One combined feed of website changes and competitor news; tabular competitor and monitoring views.
- New AI-generated "competitor landscape" briefing, persisted and regenerable, with a deterministic
  heuristic version when AI is unavailable or capped.
- Download the briefing as a Word document, or print it to PDF from the browser (no PDF library on the server).
- Locale audit across all six languages; raw internals (`pending_confirmation`, `1d`) no longer leak into the UI.

**Not covered:** live AI providers were exercised only later; legal pages and the admin console stay English on purpose.

---

## 2026-09-07 — Brand palette

**PR:** [#4](https://github.com/MichaelPearcey/RivalWatch/pull/4) · **Live:** yes

Violet/fuchsia palette replacing blue, in one theme file.

---

## Operating notes

- Railway auto-deploys from `main`; live deploys are run from `production` with the Railway CLI
  (`railway up --detach --service RivalWatch`). If anything lands on `main`, the site must be re-deployed.
- The `RAILWAY_TOKEN` in use is a project token: it can deploy but cannot change Railway configuration.
- `npm run check` (typecheck + tests, offline, in-memory SQLite) runs before every commit.
