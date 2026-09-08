# VP Engineering report

Patch notes from Devin (VP of Engineering) for Michael (CTO) and Maria (CEO).
Newest entry first. Every push to `production` adds an entry here.

Conventions:

- **Live** = deployed to Railway (`https://rivalwatch-production-8a8f.up.railway.app`).
- Commits listed are on the `production` branch; the matching PR is the readable history.
- "Not covered" is deliberate: it says what was *not* tested, so nobody assumes more than was checked.

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
