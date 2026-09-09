# VP Engineering report

Patch notes from Devin (VP of Engineering) for Michael (CTO) and Maria (CEO).
Newest entry first. Every push to `production` adds an entry here.

Conventions:

- **Live** = deployed to Railway (`https://rivalwatch-production-8a8f.up.railway.app`).
- Commits listed are on the `production` branch; the matching PR is the readable history.
- "Not covered" is deliberate: it says what was *not* tested, so nobody assumes more than was checked.

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
