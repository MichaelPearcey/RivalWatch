import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import type { AgentNote, AgentRunRow, AgentStateRow } from "../agents/types.js";
import type { Approval } from "../approvals.js";
import type { Principal } from "../auth.js";
import type {
  Account,
  ApiKey,
  Business,
  Change,
  Competitor,
  CompetitorProfile,
  EmailRow,
  Insight,
  InsightFeedback,
  Landscape,
  LandscapeDoc,
  MonitoredPage,
  NewsItem,
  PageSuggestion,
  Snapshot,
  User,
} from "../db/repo.js";
import type { EventRow } from "../events.js";
import { LOCALES, translator, type Locale, type Translate } from "../i18n/index.js";
import { COMPANY, LEGAL_VERSION } from "../legal.js";
import { PLANS, getPlan } from "../plans.js";
import { renderMarkdown } from "./md.js";
import { CSS, JS } from "./theme.js";

const EN = translator("en");

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export const Layout: FC<{ title: string; children?: unknown; flash?: string | undefined; principal?: Principal | undefined; description?: string; t?: Translate }> = ({ title, children, flash, principal, description, t = EN }) => (
  <>
    {raw("<!DOCTYPE html>")}
    <html lang={t.locale}>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · RivalWatch</title>
      <meta name="description" content={description ?? t("meta.description")} />
      <meta name="color-scheme" content="dark light" />
      <style>{raw(CSS)}</style>
      <script>{raw(THEME_BOOT)}</script>
    </head>
    <body>
      <div class="bg" aria-hidden="true">
        <div class="grid"></div>
        <div class="orb a"></div>
        <div class="orb b"></div>
        <div class="orb c"></div>
      </div>
      <nav class="nav">
        <div class="nav-in">
          <a class="brand" href="/">
            <span class="logo" aria-hidden="true"></span>RivalWatch
          </a>
          {principal ? (
            <>
              <a class="link" href="/">{t("nav.dashboard")}</a>
              <a class="link hide-sm" href="/settings">{t("nav.settings")}</a>
              {principal.isAdmin ? <a class="link" href="/admin">{t("nav.admin")}</a> : null}
              {principal.isAdmin ? <a class="link hide-sm" href="/admin/founder">Founder</a> : null}
            </>
          ) : (
            <>
              <a class="link hide-sm" href="/#how">{t("nav.how")}</a>
              <a class="link" href="/pricing">{t("nav.pricing")}</a>
            </>
          )}
          <span class="right">
            <LangPicker t={t} />
            <ThemeToggle t={t} />
            {principal ? (
              <>
                <span class="muted small hide-sm">{principal.user.email}</span>
                <form method="post" action="/auth/logout" style="display:inline">
                  <button class="tiny secondary" type="submit">
                    {t("nav.signout")}
                  </button>
                </form>
              </>
            ) : (
              <>
                <a class="link" href="/login">{t("nav.signin")}</a>
                <a class="btn tiny" href="/login?mode=signup" style="padding:.45rem .9rem;font-size:.85rem">
                  {t("nav.start")}
                </a>
              </>
            )}
          </span>
        </div>
      </nav>
      <main class="wrap">
        {flash ? <div class="card info">{flash}</div> : null}
        {principal && principal.via === "session" && !principal.user.email_verified_at ? (
          <div class="card info row small" style="padding:.7rem 1rem">
            <span class="grow">{t("verify.banner", { email: principal.user.email })}</span>
            <form method="post" action="/auth/resend-verification">
              <button class="tiny secondary" type="submit">
                {t("verify.resend")}
              </button>
            </form>
          </div>
        ) : null}
        {children}
      </main>
      <Footer t={t} />
      <script>{raw(JS)}</script>
    </body>
  </html>
  </>
);

const THEME_BOOT = `try{if(localStorage.getItem('rw-theme')==='light')document.documentElement.setAttribute('data-theme','light')}catch(e){}`;

const ThemeToggle: FC<{ t: Translate }> = ({ t }) => (
  <button type="button" class="theme" onclick="rwToggleTheme()" aria-label={t("nav.theme")} title={t("nav.theme")}>
    <svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
    </svg>
    <svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  </button>
);

/** Plain GET form so it works without JS; the server sets the cookie and redirects back. */
const LangPicker: FC<{ t: Translate }> = ({ t }) => (
  <form method="get" action="/lang" class="lang">
    <select name="lang" aria-label={t("nav.language")} onchange="this.form.submit()">
      {LOCALES.map((l) => (
        <option value={l} selected={l === t.locale}>
          {translator(l)("lang.name")}
        </option>
      ))}
    </select>
    <noscript>
      <button class="tiny secondary" type="submit">
        OK
      </button>
    </noscript>
  </form>
);

const Footer: FC<{ t: Translate }> = ({ t }) => (
  <footer class="footer">
    <div class="footer-in">
      <span>© {new Date().getFullYear()} RivalWatch</span>
      <a href="/pricing">{t("nav.pricing")}</a>
      <a href="/privacy">{t("footer.privacy")}</a>
      <a href="/terms">{t("footer.terms")}</a>
      <a href="/bot">{t("footer.bot")}</a>
      <a href={`mailto:${COMPANY.contact}`}>{t("footer.contact")}</a>
      <span class="ml tiny">{t("footer.tag")}</span>
    </div>
  </footer>
);

const Icon: FC<{ d: string }> = ({ d }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const fmtDate = (iso: string | null | undefined) => (iso ? iso.replace("T", " ").slice(0, 16) + " UTC" : "—");
const fmtUsd = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(4)}`);
const gbp = (pence: number, t: Translate) => (pence === 0 ? t("pricing.free") : `£${(pence / 100).toFixed(2)}`);

// ---------------------------------------------------------------------------
// Public pages
// ---------------------------------------------------------------------------

const ExampleInsight: FC<{ t: Translate }> = ({ t }) => (
  <div class="card insight" style="margin:0">
    <div class="row small">
      <span class="badge cat imp-4">{t("kind.pricing")}</span>
      <span class="badge">{t("ins.importance", { n: 4 })}</span>
      <span class="badge ok">{t("ins.confirmed")}</span>
      <span class="muted">{t("example.meta")}</span>
    </div>
    <h3>{t("example.headline")}</h3>
    <p class="small">{t("example.summary")}</p>
    <div class="why small">
      <strong>{t("ins.why")}</strong> {t("example.why")}
    </div>
    <div class="row small" style="margin-top:.6rem;gap:.4rem">
      <span class="muted">{t("example.evidence")}</span>
      <code style="color:var(--bad)">- £49/month</code>
      <code style="color:var(--ok)">+ £59/month</code>
      <code style="color:var(--ok)">+ £399/year</code>
    </div>
  </div>
);

const ICONS = {
  radar: "M12 12 21 7M12 12v9M12 12 4.5 16.5M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0zm5 0a4 4 0 1 0 8 0 4 4 0 0 0-8 0z",
  filter: "M3 5h18l-7 8v6l-4 2v-8L3 5z",
  brain: "M9 3a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5 3 3 0 0 0 1 6 3 3 0 0 0 4 3h1V3H9zm6 0a3 3 0 0 1 3 3v1a3 3 0 0 1 2 5 3 3 0 0 1-1 6 3 3 0 0 1-4 3h-1V3h1z",
  shield: "M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6l-8-3zm-3 9 2 2 4-4",
  eye: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5V11zm7 4v3",
};

export const LandingPage: FC<{ t: Translate }> = ({ t }) => (
  <Layout title={t("hero.h1a") + " " + t("hero.h1b")} t={t}>
    <section class="hero">
      <span class="eyebrow">
        <span class="dot"></span> {t("hero.eyebrow")}
      </span>
      <h1>
        {t("hero.h1a")} <span class="gradient">{t("hero.h1b")}</span>
      </h1>
      <p class="lead">{t("hero.lead")}</p>
      <div class="row" style="justify-content:center">
        <a class="btn big" href="/login?mode=signup">
          {t("hero.cta")}
        </a>
        <a class="btn big secondary" href="#how">
          {t("hero.how")}
        </a>
      </div>
      <div class="mock reveal">
        <div class="bar">
          <i></i>
          <i></i>
          <i></i>
          <span class="url">{t("hero.mock.url")}</span>
        </div>
        <div class="body">
          <ExampleInsight t={t} />
        </div>
      </div>
      <div class="stats reveal">
        <div>
          <b>{t("stats.confirm.b")}</b>
          {t("stats.confirm")}
        </div>
        <div>
          <b>{t("stats.cookies.b")}</b>
          {t("stats.cookies")}
        </div>
        <div>
          <b>{t("stats.digest.b")}</b>
          {t("stats.digest")}
        </div>
        <div>
          <b>{t("stats.evidence.b")}</b>
          {t("stats.evidence")}
        </div>
      </div>
    </section>

    <section id="how" class="block">
      <div class="center reveal">
        <span class="eyebrow">{t("how.eyebrow")}</span>
        <h2 style="font-size:2rem;margin-top:0">{t("how.h2")}</h2>
      </div>
      <div class="grid g3 steps">
        {([1, 2, 3] as const).map((n) => (
          <div class="card step reveal">
            <h3>{t(`how.${n}.h`)}</h3>
            <p class="muted">{t(`how.${n}.p`)}</p>
          </div>
        ))}
      </div>
    </section>

    <section class="block">
      <div class="center reveal">
        <span class="eyebrow">{t("diff.eyebrow")}</span>
        <h2 style="font-size:2rem;margin-top:0">{t("diff.h2")}</h2>
      </div>
      <div class="grid g3">
        {(["filter", "brain", "eye", "radar", "shield", "lock"] as const).map((k) => (
          <div class="card feature reveal">
            <Icon d={ICONS[k]} />
            <h3>{t(`f.${k}.h`)}</h3>
            <p class="muted small">{t(`f.${k}.p`)}</p>
          </div>
        ))}
      </div>
    </section>

    <section class="block">
      <div class="cta reveal">
        <h2 style="font-size:2rem;margin-top:0">{t("cta.h2")}</h2>
        <p class="muted">{t("cta.p")}</p>
        <a class="btn big" href="/login?mode=signup">
          {t("cta.btn")}
        </a>
        <p class="muted tiny" style="margin-top:1rem">
          {t("cta.fine")} · <a href="/privacy">{t("footer.privacy")}</a>
        </p>
      </div>
    </section>
  </Layout>
);

export const PricingPage: FC<{ principal?: Principal | undefined; t: Translate }> = ({ principal, t }) => (
  <Layout title={t("nav.pricing")} principal={principal} t={t}>
    <section class="center" style="padding:3rem 0 2rem">
      <span class="eyebrow">{t("pricing.eyebrow")}</span>
      <h1 style="font-size:clamp(2rem,5vw,3.2rem);letter-spacing:-.03em">
        {t("pricing.h1a")} <span class="gradient">{t("pricing.h1b")}</span> {t("pricing.h1c")}
      </h1>
      <p class="muted" style="font-size:1.1rem">{t("pricing.lead")}</p>
    </section>
    <div class="grid g3">
      {Object.values(PLANS).map((p) => (
        <div class={`card plan${p.id === "pro" ? " featured" : ""}`}>
          {p.id === "pro" ? <span class="badge brand">{t("pricing.popular")}</span> : null}
          <h3 style="margin-top:.5rem">{p.name}</h3>
          <div class="price">
            {gbp(p.price_pence_monthly, t)}
            {p.price_pence_monthly ? <small>{t("pricing.month")}</small> : null}
          </div>
          <ul class="tick">
            <li>{t("pricing.competitors", { n: p.max_competitors })}</li>
            <li>{t("pricing.pages", { n: p.max_pages_per_competitor })}</li>
            <li>{p.check_interval_minutes >= 1440 ? t("pricing.every.days", { n: p.check_interval_minutes / 1440 }) : t("pricing.every.hours", { n: p.check_interval_minutes / 60 })}</li>
            <li>{t("pricing.ai")}</li>
            <li>{t("pricing.digest")}</li>
            {p.features.alerts ? <li>{t("pricing.alerts")}</li> : null}
            {p.features.history_trends ? <li>{t("pricing.trends")}</li> : null}
            {p.features.comparisons ? <li>{t("pricing.compare")}</li> : null}
            {p.features.monthly_strategic_analysis ? <li>{t("pricing.strategic")}</li> : null}
          </ul>
          <a class={`btn${p.id === "pro" ? "" : " secondary"}`} href="/login?mode=signup" style="width:100%;justify-content:center">
            {p.price_pence_monthly ? t("pricing.start", { plan: p.name }) : t("pricing.startfree")}
          </a>
        </div>
      ))}
    </div>
    <p class="muted small center" style="margin-top:1.5rem">
      {t("pricing.note")} <a href={`mailto:${COMPANY.contact}`}>{COMPANY.contact}</a>
    </p>
  </Layout>
);

export const LegalPage: FC<{ title: string; markdown: string; principal?: Principal | undefined; t: Translate }> = ({ title, markdown, principal, t }) => (
  <Layout title={title} principal={principal} t={t}>
    {t.locale !== "en" ? <p class="muted small center">{t("consent.english")}</p> : null}
    <article class="card prose narrow" style="margin:0 auto">
      {raw(renderMarkdown(markdown))}
    </article>
  </Layout>
);

export const LoginPage: FC<{ t: Translate; mode?: "signin" | "signup"; sent?: boolean; devLink?: string | undefined; error?: string | undefined; email?: string | undefined; next?: string | undefined }> = ({ t, mode = "signin", sent, devLink, error, email, next }) => (
  <Layout title={mode === "signup" ? t("signup.title") : t("login.title")} t={t}>
    <div class="narrow" style="margin:2rem auto">
      <h1 class="center">{mode === "signup" ? t("signup.title") : t("login.title")}</h1>
      {error ? <div class="card alert">{error}</div> : null}
      {sent ? (
        <div class="card good">
          <p>{t("login.sent", { email: email ?? "" })}</p>
          <p class="muted small">{t("login.spam")}</p>
          {devLink ? (
            <p class="muted small">
              {t("login.dev")} <a href={devLink}>{t("login.devlink")}</a>
            </p>
          ) : null}
        </div>
      ) : (
        <div class="grid g2">
          <form method="post" action="/auth/login" class="card">
            <h3 style="margin-top:0">{mode === "signup" ? t("signup.link.h") : t("login.link.h")}</h3>
            <p class="muted small">{t("login.link.p")}</p>
            <input type="hidden" name="next" value={next ?? ""} />
            <label>
              {t("login.email")} <input name="email" type="email" required autocomplete="email" value={email ?? ""} />
            </label>
            <p>
              <button type="submit" style="width:100%;justify-content:center">
                {mode === "signup" ? t("signup.create") : t("login.send")}
              </button>
            </p>
            {mode === "signup" ? (
              <p class="tiny muted">
                {t("signup.agree")} <a href="/terms">{t("consent.terms.link")}</a> {t("login.and")} <a href="/privacy">{t("consent.privacy.link")}</a>.
              </p>
            ) : null}
          </form>
          {mode === "signup" ? (
            <form method="post" action="/auth/signup" class="card">
              <h3 style="margin-top:0">{t("signup.pw.h")}</h3>
              <p class="muted small">{t("signup.pw.p")}</p>
              <input type="hidden" name="next" value={next ?? ""} />
              <label>
                {t("login.email")} <input name="email" type="email" required autocomplete="username" value={email ?? ""} />
              </label>
              <label>
                {t("signup.pw.password")} <input name="password" type="password" required autocomplete="new-password" minlength={12} maxlength={128} />
              </label>
              <p>
                <button type="submit" class="secondary" style="width:100%;justify-content:center">
                  {t("signup.pw.btn")}
                </button>
              </p>
            </form>
          ) : (
            <form method="post" action="/auth/password" class="card">
              <h3 style="margin-top:0">{t("login.pw.h")}</h3>
              <p class="muted small">{t("login.pw.p")}</p>
              <input type="hidden" name="next" value={next ?? ""} />
              <label>
                {t("login.email")} <input name="email" type="email" required autocomplete="username" />
              </label>
              <label>
                {t("login.password")} <input name="password" type="password" required autocomplete="current-password" minlength={1} />
              </label>
              <p>
                <button type="submit" class="secondary" style="width:100%;justify-content:center">
                  {t("login.pw.btn")}
                </button>
              </p>
            </form>
          )}
        </div>
      )}
      <p class="center muted small">
        {mode === "signup" ? (
          <>
            {t("login.have")} <a href="/login">{t("login.title")}</a>
          </>
        ) : (
          <>
            {t("login.new")} <a href="/login?mode=signup">{t("login.newlink")}</a>
          </>
        )}
      </p>
    </div>
  </Layout>
);

export const ConsentPage: FC<{ principal: Principal; t: Translate; next?: string | undefined; error?: string | undefined; firstTime: boolean }> = ({ principal, t, next, error, firstTime }) => (
  <Layout title={t("consent.terms.link")} principal={principal} t={t}>
    <div class="narrow" style="margin:2rem auto">
      <h1>{firstTime ? t("consent.first.h") : t("consent.update.h")}</h1>
      <p class="muted">{firstTime ? t("consent.first.p") : t("consent.update.p", { version: LEGAL_VERSION })}</p>
      {t.locale !== "en" ? <p class="muted small">{t("consent.english")}</p> : null}
      {error ? <div class="card alert">{error}</div> : null}
      <form method="post" action="/legal/accept" class="card">
        <input type="hidden" name="next" value={next ?? "/"} />
        <label class="check">
          <input type="checkbox" name="terms" value="1" required />
          <span>
            {t("consent.terms")}{" "}
            <a href="/terms" target="_blank" rel="noopener">
              {t("consent.terms.link")}
            </a>
            .
          </span>
        </label>
        <label class="check">
          <input type="checkbox" name="privacy" value="1" required />
          <span>
            {t("consent.privacy")}{" "}
            <a href="/privacy" target="_blank" rel="noopener">
              {t("consent.privacy.link")}
            </a>{" "}
            {t("consent.privacy.tail")}
          </span>
        </label>
        <p>
          <button type="submit">{t("consent.accept")}</button>{" "}
          <a class="btn secondary" href="/auth/logout-get">
            {t("consent.later")}
          </a>
        </p>
      </form>
    </div>
  </Layout>
);

// ---------------------------------------------------------------------------
// App pages
// ---------------------------------------------------------------------------

export const BusinessesPage: FC<{ principal: Principal; t: Translate; businesses: Business[]; account: Account; flash?: string | undefined }> = ({ principal, t, businesses, account, flash }) => (
  <Layout title={t("dash.title")} principal={principal} flash={flash} t={t}>
    <div class="row">
      <h1 style="margin:0">{t("dash.h1")}</h1>
      <span class="badge brand">{t("dash.plan", { plan: getPlan(account.plan).name })}</span>
    </div>
    {account.delete_after ? (
      <div class="card alert">
        <strong>{t("dash.deleting", { date: fmtDate(account.delete_after) })}</strong>{" "}
        <form method="post" action="/settings/delete/cancel" style="display:inline">
          <button class="tiny secondary" type="submit">
            {t("dash.cancel.deletion")}
          </button>
        </form>
      </div>
    ) : null}
    {businesses.length === 0 ? (
      <div class="card">
        <h2 style="margin-top:0">{t("dash.welcome.h")}</h2>
        <p class="muted">{t("dash.welcome.p")}</p>
      </div>
    ) : null}
    {businesses.map((b) => (
      <a href={`/b/${b.id}`} class="card row" style="display:flex;color:inherit;text-decoration:none">
        <strong>{b.name}</strong>
        <span class="muted small">{b.website ?? ""}</span>
        <span class="ml muted small">{t("dash.open")}</span>
      </a>
    ))}
    <h2>{businesses.length ? t("dash.add.h") : t("dash.describe.h")}</h2>
    <form method="post" action="/b" class="card">
      <div class="grid g2">
        <label>
          {t("biz.name")} <input name="name" required placeholder="e.g. Bright Pixel Design" />
        </label>
        <label>
          {t("biz.website")} <input name="website" type="url" placeholder="https://" />
        </label>
      </div>
      <label>
        {t("biz.desc")}
        <textarea name="description" />
      </label>
      <label>
        {t("biz.pricing")}
        <textarea name="pricing_notes" placeholder="Starter £25/month, Studio £55/month" />
      </label>
      <p>
        <button type="submit">{t("biz.create")}</button>
      </p>
    </form>
  </Layout>
);

export const StatusBadge: FC<{ page: MonitoredPage; t?: Translate }> = ({ page, t = EN }) => (
  <span class={`badge st-${page.status}`} title={page.status_message ?? ""}>
    {t(`status.${page.status}`)}
  </span>
);

/** Insight and news categories are stored as English enum values; show them in the reader's language. */
const CategoryBadge: FC<{ t: Translate; category: string; className?: string }> = ({ t, category, className = "badge cat" }) => {
  const key = `cat.${category}` as const;
  const label = t(key as never);
  return <span class={className}>{label === key ? category.replace(/_/g, " ") : label}</span>;
};

export const BUSINESS_TABS = ["overview", "news", "competitors", "landscape"] as const;
export type BusinessTab = (typeof BUSINESS_TABS)[number];

/** One row of the unified feed: a confirmed website change, or a news headline. */
type FeedItem = { at: string; competitorId: number; kind: "change" | "news" } & ({ kind: "change"; insight: Insight } | { kind: "news"; news: NewsItem });

function buildFeed(insights: Insight[], news: NewsItem[]): FeedItem[] {
  const items: FeedItem[] = [
    ...insights.map((i) => ({ at: i.created_at, competitorId: i.competitor_id, kind: "change" as const, insight: i })),
    ...news.filter((n) => n.about_competitor !== 0).map((n) => ({ at: n.published_at ?? n.fetched_at, competitorId: n.competitor_id, kind: "news" as const, news: n })),
  ];
  return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

const importanceOf = (item: FeedItem) => (item.kind === "change" ? item.insight.importance : (item.news.magnitude ?? 0));

const Tabs: FC<{ t: Translate; businessId: number; tab: BusinessTab }> = ({ t, businessId, tab }) => (
  <div class="row" style="gap:.4rem;margin:1rem 0 .5rem;flex-wrap:wrap">
    {BUSINESS_TABS.map((name) => (
      <a class={`btn tiny${name === tab ? "" : " secondary"}`} href={`/b/${businessId}?tab=${name}`} aria-current={name === tab ? "page" : undefined}>
        {t(`tab.${name}`)}
      </a>
    ))}
  </div>
);

const Stat: FC<{ n: number | string; label: string }> = ({ n, label }) => (
  <div class="card flat" style="text-align:center;margin:0">
    <div style="font-size:1.7rem;font-weight:700;line-height:1.1">{n}</div>
    <div class="muted tiny">{label}</div>
  </div>
);

const FeedTable: FC<{ t: Translate; items: FeedItem[]; competitorNames: Record<number, string> }> = ({ t, items, competitorNames }) => (
  <div class="card flat" style="overflow-x:auto">
    <table>
      <thead>
        <tr>
          <th>{t("feed.col.when")}</th>
          <th>{t("feed.col.competitor")}</th>
          <th>{t("feed.col.what")}</th>
          <th>{t("feed.col.type")}</th>
          <th>{t("feed.col.impact")}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr>
            <td class="muted small" style="white-space:nowrap">{item.at.slice(0, 10)}</td>
            <td class="small">{competitorNames[item.competitorId] ?? ""}</td>
            <td>
              {item.kind === "change" ? (
                <>
                  <a href={`/insights/${item.insight.id}`} style="font-weight:600;color:inherit">
                    {item.insight.headline}
                  </a>
                  <div class="muted tiny">{item.insight.why_it_matters}</div>
                </>
              ) : (
                <>
                  <a href={item.news.url} target="_blank" rel="noopener noreferrer" style="font-weight:600;color:inherit">
                    {item.news.title}
                  </a>
                  <div class="muted tiny">
                    {item.news.source ?? ""}
                    {item.news.summary && item.news.summary !== item.news.title ? ` · ${item.news.summary}` : ""}
                  </div>
                </>
              )}
            </td>
            <td class="small" style="white-space:nowrap">
              <span class="badge">{t(`feed.kind.${item.kind}`)}</span>{" "}
              <CategoryBadge t={t} category={item.kind === "change" ? item.insight.category : (item.news.category ?? "other")} />
            </td>
            <td style="white-space:nowrap">
              <span class={`badge${importanceOf(item) >= 4 ? " imp-5" : ""}`}>{importanceOf(item)}/5</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    {items.length === 0 ? <p class="muted small" style="margin:.5rem">{t("feed.empty")}</p> : null}
  </div>
);

const CompetitorTable: FC<{
  t: Translate;
  rows: { competitor: Competitor; pages: MonitoredPage[]; news: NewsItem[] }[];
  changeCounts: Record<number, number>;
}> = ({ t, rows, changeCounts }) => (
  <div class="card flat" style="overflow-x:auto">
    <table>
      <thead>
        <tr>
          <th>{t("comp.col.name")}</th>
          <th>{t("comp.col.pages")}</th>
          <th>{t("comp.col.health")}</th>
          <th>{t("comp.col.checked")}</th>
          <th>{t("comp.col.changes")}</th>
          <th>{t("comp.col.news")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ competitor, pages, news }) => {
          const bad = pages.filter((p) => p.status !== "ACTIVE" && p.status !== "PAUSED").length;
          const checked = pages.map((p) => p.last_checked_at).filter(Boolean).sort().at(-1) ?? null;
          return (
            <tr>
              <td>
                <a href={`#competitor-${competitor.id}`} style="font-weight:600;color:inherit">
                  {competitor.name}
                </a>
                <div class="muted tiny">{competitor.website.replace(/^https?:\/\//, "")}</div>
              </td>
              <td>{pages.length}</td>
              <td>{bad ? <span class="badge st-FETCH_ERROR">{t("comp.unhealthy", { n: bad })}</span> : <span class="badge ok">{t("comp.healthy")}</span>}</td>
              <td class="muted small" style="white-space:nowrap">{fmtDate(checked)}</td>
              <td>{changeCounts[competitor.id] ?? 0}</td>
              <td>{news.filter((n) => n.about_competitor !== 0).length}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

function parseDoc(json: string | null): LandscapeDoc | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as LandscapeDoc;
  } catch {
    return null;
  }
}

const LandscapeCard: FC<{ t: Translate; businessId: number; landscape: Landscape | null; hasCompetitors: boolean }> = ({ t, businessId, landscape, hasCompetitors }) => {
  const doc = parseDoc(landscape?.doc_json ?? null);
  return (
    <div class="card">
      <div class="row">
        <div class="grow">
          <h2 style="margin:0">{t("ls.h")}</h2>
          <p class="muted small" style="margin:.2rem 0 0">{t("ls.p")}</p>
        </div>
        {hasCompetitors ? (
          <form method="post" action={`/b/${businessId}/landscape`}>
            <button type="submit" class={doc ? "secondary" : ""}>
              {doc ? t("ls.regenerate") : t("ls.generate")}
            </button>
          </form>
        ) : null}
      </div>
      {!hasCompetitors ? <p class="muted small">{t("ls.nocomp")}</p> : null}
      {landscape?.status === "pending" ? <p class="muted small">{t("ls.pending")}</p> : null}
      {landscape?.status === "failed" ? <div class="card alert small">{t("ls.failed")}</div> : null}
      {!doc && hasCompetitors && landscape?.status !== "pending" ? <p class="muted small">{t("ls.none")}</p> : null}
      {doc ? (
        <>
          <p class="muted tiny" style="margin:.6rem 0 0">
            {t("ls.generated", { date: fmtDate(landscape?.generated_at), n: landscape?.competitor_count ?? doc.competitors.length })}
            {doc.provider === "heuristic" ? ` · ${t("ls.heuristic")}` : ""}
          </p>
          <h3 style="margin:.6rem 0 .2rem">{doc.headline}</h3>
          <p style="margin:0 0 .8rem">{doc.summary}</p>
          <div style="overflow-x:auto">
            <table>
              <thead>
                <tr>
                  <th>{t("ls.col.competitor")}</th>
                  <th>{t("ls.col.positioning")}</th>
                  <th>{t("ls.col.pricing")}</th>
                  <th>{t("ls.col.strengths")}</th>
                  <th>{t("ls.col.watch")}</th>
                </tr>
              </thead>
              <tbody>
                {doc.competitors.map((c) => (
                  <tr>
                    <td style="font-weight:600">{c.name}</td>
                    <td class="small">{c.positioning}</td>
                    <td class="small">{c.pricing}</td>
                    <td class="small">{c.strengths}</td>
                    <td class="small">{c.watch_out}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="grid g3" style="margin-top:1rem">
            {(
              [
                ["ls.opportunities", doc.opportunities],
                ["ls.threats", doc.threats],
                ["ls.actions", doc.recommendations],
              ] as const
            ).map(([key, items]) =>
              items.length ? (
                <div class="card flat" style="margin:0">
                  <strong class="small">{t(key)}</strong>
                  <ul class="small" style="margin:.4rem 0 0;padding-left:1.1rem">
                    {items.map((i) => (
                      <li>{i}</li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          </div>
        </>
      ) : null}
    </div>
  );
};

export const BusinessPage: FC<{
  principal: Principal;
  t: Translate;
  business: Business;
  account: Account;
  competitors: { competitor: Competitor; pages: MonitoredPage[]; suggestions: PageSuggestion[]; news: NewsItem[] }[];
  bigNews: NewsItem[];
  insights: Insight[];
  feedback: Record<number, InsightFeedback[]>;
  competitorNames: Record<number, string>;
  includeNoise: boolean;
  tab?: BusinessTab;
  landscape?: Landscape | null;
  flash?: string | undefined;
}> = ({ principal, t, business, account, competitors, bigNews, insights, feedback, competitorNames, includeNoise, tab = "overview", landscape = null, flash }) => {
  const plan = getPlan(account.plan);
  const pages = competitors.flatMap((c) => c.pages);
  const unhealthy = pages.filter((p) => p.status !== "ACTIVE" && p.status !== "PAUSED");
  const allNews = competitors.flatMap((c) => c.news);
  const feed = buildFeed(insights, allNews);
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const recent = feed.filter((f) => f.at >= since30);
  const changeCounts: Record<number, number> = {};
  for (const f of recent) if (f.kind === "change") changeCounts[f.competitorId] = (changeCounts[f.competitorId] ?? 0) + 1;
  const noProfile = competitors.filter(({ competitor }) => competitor.profile_status !== "ready").length;
  const tabHref = (name: BusinessTab) => `/b/${business.id}?tab=${name}`;
  return (
    <Layout title={business.name} principal={principal} flash={flash} t={t}>
      <div class="row">
        <div class="grow">
          <p class="muted small" style="margin:0">
            <a href="/">{t("nav.dashboard")}</a> / {business.name}
          </p>
          <h1 style="margin:0">{business.name}</h1>
          <p class="muted small" style="margin:.2rem 0 0">
            {t("biz.meta", { plan: plan.name, n: competitors.length, max: plan.max_competitors, digest: business.digest_enabled ? t("biz.digest.on", { date: fmtDate(business.next_digest_at) }) : t("biz.digest.off") })}
          </p>
        </div>
        <form method="post" action={`/b/${business.id}/scan`}>
          <button type="submit" class="secondary">
            {t("biz.checkall")}
          </button>
        </form>
      </div>

      <Tabs t={t} businessId={business.id} tab={tab} />

      {tab === "overview" ? (
        <>
          <h2 style="margin:1.25rem 0 .5rem">{t("ov.h")}</h2>
          <div class="grid g4" style="gap:.6rem">
            <Stat n={competitors.length} label={t("ov.competitors")} />
            <Stat n={pages.length} label={t("ov.pages")} />
            <Stat n={recent.filter((f) => f.kind === "change").length} label={t("ov.insights")} />
            <Stat n={recent.filter((f) => f.kind === "news").length} label={t("ov.news")} />
          </div>
          <div class="card">
            <h2 style="margin:0 0 .4rem">{t("ov.attention.h")}</h2>
            <ul class="small" style="margin:0;padding-left:1.1rem">
              {unhealthy.length ? <li>{t("ov.attention.pages", { n: unhealthy.length })}</li> : null}
              {noProfile ? <li>{t("ov.attention.profile", { n: noProfile })}</li> : null}
              {competitors.length && !landscape?.doc_json ? (
                <li>
                  {t("ov.attention.landscape")} <a href={tabHref("landscape")}>{t("ls.generate")}</a>
                </li>
              ) : null}
              {!unhealthy.length && !noProfile && (landscape?.doc_json || !competitors.length) ? <li class="muted">{t("ov.attention.none")}</li> : null}
            </ul>
          </div>
          {bigNews.length ? (
            <div class="card glow" style="border-color:var(--warn)">
              <h2 style="margin:0 0 .25rem">{t("news.big.h")}</h2>
              <p class="muted small" style="margin:0 0 .5rem">{t("news.big.p")}</p>
              {bigNews.slice(0, 5).map((n) => (
                <NewsRow t={t} item={n} competitorName={competitorNames[n.competitor_id] ?? ""} big />
              ))}
            </div>
          ) : null}
          <div class="row" style="margin-top:1.5rem">
            <h2 style="margin:0">{t("ov.latest.h")}</h2>
            <a class="ml small" href={tabHref("news")}>
              {t("ov.seeall")}
            </a>
          </div>
          {feed.length === 0 ? <div class="card empty">{competitors.length === 0 ? t("biz.empty.nocomp") : t("ov.quiet")}</div> : <FeedTable t={t} items={feed.slice(0, 8)} competitorNames={competitorNames} />}
        </>
      ) : null}

      {tab === "news" ? (
        <>
          <div class="row">
            <div class="grow">
              <h2 style="margin:0">{t("feed.h")}</h2>
              <p class="muted small" style="margin:.2rem 0 0">{t("feed.p")}</p>
            </div>
            <span class="small">
              {includeNoise ? <a href={tabHref("news")}>{t("biz.hidenoise")}</a> : <a href={`${tabHref("news")}&noise=1`}>{t("biz.shownoise")}</a>}
            </span>
          </div>
          <FeedTable t={t} items={feed} competitorNames={competitorNames} />
          <div class="row" style="margin-top:1rem">
            <h2 style="margin:0">{t("biz.insights")}</h2>
            <span class="ml small">
              <form method="post" action={`/b/${business.id}/digest`} style="display:inline">
                <input type="hidden" name="enabled" value={business.digest_enabled ? "0" : "1"} />
                <button class="tiny secondary" type="submit">
                  {business.digest_enabled ? t("biz.digest.toggle.off") : t("biz.digest.toggle.on")}
                </button>
              </form>{" "}
              <form method="post" action={`/b/${business.id}/digest/send`} style="display:inline">
                <button class="tiny secondary" type="submit">
                  {t("biz.digest.now")}
                </button>
              </form>
            </span>
          </div>
          {insights.length === 0 ? <div class="card empty">{competitors.length === 0 ? t("biz.empty.nocomp") : t("biz.empty")}</div> : null}
          {insights.slice(0, 20).map((i) => (
            <InsightCard t={t} insight={i} competitorName={competitorNames[i.competitor_id] ?? ""} feedback={feedback[i.id] ?? []} />
          ))}
        </>
      ) : null}

      {tab === "landscape" ? <LandscapeCard t={t} businessId={business.id} landscape={landscape} hasCompetitors={competitors.length > 0} /> : null}

      {tab !== "competitors" ? null : (
        <>
          {unhealthy.length ? <div class="card alert">{t("biz.problem", { n: unhealthy.length })}</div> : null}
          {competitors.length ? <CompetitorTable t={t} rows={competitors} changeCounts={changeCounts} /> : null}
          <h2>{t("biz.competitors")}</h2>
          {competitors.map(({ competitor, pages: cPages, suggestions, news }) => (
        <div class="card" id={`competitor-${competitor.id}`}>
          <div class="row">
            <strong style="font-size:1.05rem">{competitor.name}</strong>
            <a class="muted small" href={competitor.website} target="_blank" rel="noopener">
              {competitor.website}
            </a>
            <span class="ml"></span>
            <form method="post" action={`/competitors/${competitor.id}/discover`} style="display:inline">
              <button class="secondary tiny" type="submit">
                {t("comp.findmore")}
              </button>
            </form>
            <form method="post" action={`/competitors/${competitor.id}/delete`} style="display:inline" onsubmit={`return confirm(${JSON.stringify(t("comp.remove.confirm"))})`}>
              <button class="danger tiny" type="submit">
                {t("comp.remove")}
              </button>
            </form>
          </div>
          <ProfileCard t={t} competitor={competitor} />
          <details class="card flat" style="margin:.75rem 0 0" open={news.some((n) => (n.magnitude ?? 0) >= 4 && n.about_competitor === 1)}>
            <summary>
              <strong class="small">
                {t("news.h")} <span class="muted">({news.filter((n) => n.about_competitor !== 0).length})</span>
              </strong>{" "}
              <span class="muted tiny">{competitor.news_checked_at ? fmtDate(competitor.news_checked_at) : ""}</span>
            </summary>
            {news.length === 0 ? <p class="muted small">{t("news.none", { name: competitor.name })}</p> : news.filter((n) => n.about_competitor !== 0).slice(0, 10).map((n) => <NewsRow t={t} item={n} competitorName={competitor.name} />)}
            <form method="post" action={`/competitors/${competitor.id}/news`} style="margin-top:.5rem">
              <button class="tiny secondary" type="submit">
                {t("news.refresh")}
              </button>
            </form>
          </details>
          <table style="margin-top:.75rem">
            <thead>
              <tr>
                <th>{t("page.col.page")}</th>
                <th>{t("page.col.type")}</th>
                <th>{t("page.col.checked")}</th>
                <th>{t("page.col.status")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cPages.map((p) => (
                <tr>
                  <td>
                    <a href={`/pages/${p.id}`}>{p.url.replace(/^https?:\/\//, "")}</a>
                    {p.status_message && p.status !== "ACTIVE" ? <div class="muted tiny">{p.status_message}</div> : null}
                  </td>
                  <td>{t(`kind.${p.kind}`)}</td>
                  <td class="muted small">
                    {t("page.every", { interval: humanMinutes(p.check_interval_minutes) })}
                    <br />
                    {t("page.last", { date: fmtDate(p.last_checked_at) })}
                  </td>
                  <td>
                    <StatusBadge page={p} t={t} />
                  </td>
                  <td style="white-space:nowrap;text-align:right">
                    <form method="post" action={`/pages/${p.id}/scan`} style="display:inline">
                      <button class="secondary tiny" type="submit" disabled={!p.enabled}>
                        {t("page.check")}
                      </button>
                    </form>{" "}
                    <form method="post" action={`/pages/${p.id}/${p.enabled ? "pause" : "resume"}`} style="display:inline">
                      <button class="secondary tiny" type="submit">
                        {p.enabled ? t("page.pause") : t("page.resume")}
                      </button>
                    </form>{" "}
                    <form method="post" action={`/pages/${p.id}/delete`} style="display:inline">
                      <button class="danger tiny" type="submit" aria-label={t("page.remove")}>
                        ×
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {suggestions.length ? (
            <div class="card info flat" style="margin:.75rem 0 0">
              <strong class="small">{t("sugg.h")}</strong>
              <table>
                <tbody>
                  {suggestions.map((s) => (
                    <tr>
                      <td>{s.url.replace(/^https?:\/\//, "")}</td>
                      <td>
                        <span class="badge">{t(`kind.${s.kind}`)}</span>
                      </td>
                      <td class="muted small">{s.reason}</td>
                      <td style="white-space:nowrap;text-align:right">
                        <form method="post" action={`/suggestions/${s.id}/accept`} style="display:inline">
                          <button class="tiny" type="submit">
                            {t("sugg.monitor")}
                          </button>
                        </form>{" "}
                        <form method="post" action={`/suggestions/${s.id}/dismiss`} style="display:inline">
                          <button class="secondary tiny" type="submit">
                            {t("sugg.dismiss")}
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <form method="post" action={`/competitors/${competitor.id}/pages`} class="inline" style="margin-top:.75rem">
            <label class="grow">
              {t("page.add.url")} <input name="url" type="url" required placeholder="https://competitor.com/pricing" />
            </label>
            <label>
              {t("page.add.type")}
              <select name="kind">
                {(["pricing", "home", "products", "blog", "other"] as const).map((k) => (
                  <option value={k}>{t(`kind.${k}`)}</option>
                ))}
              </select>
            </label>
            <button class="secondary" type="submit">
              {t("page.add")}
            </button>
          </form>
        </div>
          ))}

          <h2>{t("comp.add.h")}</h2>
          <form method="post" action={`/b/${business.id}/competitors`} class="card inline">
            <label>
              {t("comp.add.name")} <input name="name" required placeholder="Acme Studio" />
            </label>
            <label class="grow">
              {t("comp.add.website")} <input name="website" type="url" required placeholder="https://acme.example" />
            </label>
            <button type="submit">{t("comp.add.btn")}</button>
            <p class="muted tiny" style="width:100%;margin:0">{t("comp.add.note")}</p>
          </form>
        </>
      )}
    </Layout>
  );
};

const NewsRow: FC<{ t: Translate; item: NewsItem; competitorName: string; big?: boolean }> = ({ t, item, competitorName, big }) => (
  <div class="small" style={`padding:.55rem 0;border-top:1px solid var(--line)${big ? "" : ""}`}>
    <div class="row" style="gap:.4rem">
      {item.category ? <CategoryBadge t={t} category={item.category} className={`badge cat${(item.magnitude ?? 0) >= 4 ? " imp-5" : ""}`} /> : null}
      {item.magnitude ? <span class={`badge${(item.magnitude ?? 0) >= 4 ? " imp-5" : ""}`}>{t("news.magnitude", { n: item.magnitude })}</span> : null}
      {item.about_competitor === 0 ? <span class="badge">{t("news.notabout")}</span> : null}
      <span class="muted tiny">
        {big ? `${competitorName} · ` : ""}
        {item.source ?? ""} · {item.published_at ? item.published_at.slice(0, 10) : fmtDate(item.fetched_at).slice(0, 10)}
      </span>
    </div>
    <a href={item.url} target="_blank" rel="noopener noreferrer" style="color:inherit;font-weight:600">
      {item.title}
    </a>
    {item.summary && item.summary !== item.title ? <div class="muted">{item.summary}</div> : null}
    {item.why_it_matters && (item.magnitude ?? 0) >= 3 ? (
      <div class="why tiny" style="margin-top:.3rem">
        <strong>{t("ins.why")}</strong> {item.why_it_matters}
      </div>
    ) : null}
  </div>
);

const ProfileCard: FC<{ t: Translate; competitor: Competitor }> = ({ t, competitor }) => {
  const profile = competitor.profile_json ? (JSON.parse(competitor.profile_json) as CompetitorProfile) : null;
  if (competitor.profile_status === "none" && !profile) return null;
  return (
    <details class="card flat" style="margin:.75rem 0 0" open={competitor.profile_status === "ready"}>
      <summary>
        <strong class="small">{t("profile.h", { name: competitor.name })}</strong>{" "}
        {competitor.profile_status === "pending" ? <span class="muted small">{t("profile.pending")}</span> : null}
        {competitor.profile_status === "failed" ? <span class="muted small">{t("profile.failed")}</span> : null}
      </summary>
      {profile ? (
        <div class="small" style="margin-top:.5rem">
          <p style="margin:0 0 .5rem">{profile.summary}</p>
          <div class="grid g2" style="gap:.6rem">
            <div>
              <div class="muted tiny" style="text-transform:uppercase;letter-spacing:.06em">{t("profile.target")}</div>
              <div>{profile.target_customers}</div>
            </div>
            <div>
              <div class="muted tiny" style="text-transform:uppercase;letter-spacing:.06em">{t("profile.positioning")}</div>
              <div>{profile.positioning}</div>
            </div>
            <div>
              <div class="muted tiny" style="text-transform:uppercase;letter-spacing:.06em">{t("profile.pricing")}</div>
              <div>{profile.pricing_summary}</div>
            </div>
            {profile.products.length ? (
              <div>
                <div class="muted tiny" style="text-transform:uppercase;letter-spacing:.06em">{t("profile.products")}</div>
                <div>{profile.products.join(" · ")}</div>
              </div>
            ) : null}
          </div>
          {profile.usps.length ? (
            <div style="margin-top:.6rem">
              <div class="muted tiny" style="text-transform:uppercase;letter-spacing:.06em">{t("profile.usps")}</div>
              <div class="row" style="gap:.35rem;margin-top:.25rem">
                {profile.usps.map((u) => (
                  <span class="badge">{u}</span>
                ))}
              </div>
            </div>
          ) : null}
          <div class="row tiny muted" style="margin-top:.6rem">
            <span>{t("profile.sources", { n: profile.sources.length })}</span>
            {profile.provider === "heuristic" ? <span>· {t("profile.heuristic")}</span> : null}
            <form method="post" action={`/competitors/${competitor.id}/profile`} class="ml">
              <button class="tiny secondary" type="submit">
                {t("profile.refresh")}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </details>
  );
};

const VERDICTS = ["useful", "not_useful", "incorrect", "too_noisy"] as const;

export const InsightCard: FC<{ t: Translate; insight: Insight; competitorName: string; feedback: InsightFeedback[] }> = ({ t, insight, competitorName, feedback }) => {
  const mine = feedback[0]?.verdict;
  return (
    <div class={`card insight${insight.matters ? "" : " filtered"}`}>
      <div class="row small">
        <CategoryBadge t={t} category={insight.category} className={`badge cat imp-${insight.importance}`} />
        <span class="badge">{t("ins.importance", { n: insight.importance })}</span>
        {insight.matters ? null : <span class="badge">{t("ins.filtered")}</span>}
        <span class="muted">
          {competitorName} · {fmtDate(insight.created_at)}
        </span>
      </div>
      <h3>
        <a href={`/insights/${insight.id}`} style="color:inherit">
          {insight.headline}
        </a>
      </h3>
      <p style="margin:.2rem 0">{insight.summary}</p>
      <div class="why small">
        <strong>{t("ins.why")}</strong> {insight.why_it_matters}
      </div>
      <div class="fb small" style="margin-top:.6rem">
        <span class="muted">{t("ins.helpful")}</span>
        {VERDICTS.map((v) => (
          <form method="post" action={`/insights/${insight.id}/feedback`}>
            <input type="hidden" name="verdict" value={v} />
            <button class={`tiny secondary${mine === v ? " active" : ""}`} type="submit">
              {t(`fb.${v}`)}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
};

export const InsightDetailPage: FC<{ principal: Principal; t: Translate; insight: Insight; change: Change; page: MonitoredPage; competitor: Competitor; business: Business; feedback: InsightFeedback[] }> = ({
  principal,
  t,
  insight,
  change,
  page,
  competitor,
  business,
  feedback,
}) => {
  const added = JSON.parse(change.added_json) as string[];
  const removed = JSON.parse(change.removed_json) as string[];
  return (
    <Layout title={insight.headline} principal={principal} t={t}>
      <p class="muted small">
        <a href="/">{t("nav.dashboard")}</a> / <a href={`/b/${business.id}`}>{business.name}</a>
      </p>
      <InsightCard t={t} insight={insight} competitorName={competitor.name} feedback={feedback} />
      <h2>{t("ins.evidence")}</h2>
      <p class="muted small">
        <a href={page.url} target="_blank" rel="noopener">
          {page.url}
        </a>{" "}
        · {t("ins.detected", { date: fmtDate(change.detected_at) })} · {t("ins.confirmedat", { date: fmtDate(change.confirmed_at) })}
        {principal.isAdmin ? ` · ${insight.provider}${insight.model ? ` (${insight.model})` : ""} · tokens ${insight.input_tokens ?? 0}/${insight.output_tokens ?? 0} · ${fmtUsd(insight.estimated_cost_usd)} · significance ${change.significance}` : ""}
      </p>
      <pre class="diff">
        {removed.map((l) => (
          <div class="del">- {l}</div>
        ))}
        {added.map((l) => (
          <div class="add">+ {l}</div>
        ))}
      </pre>
      <form method="post" action={`/insights/${insight.id}/reanalyze`}>
        <button class="secondary tiny" type="submit">
          {t("ins.reanalyse")}
        </button>
      </form>
    </Layout>
  );
};

export const PageDetailPage: FC<{ principal: Principal; t: Translate; page: MonitoredPage; competitor: Competitor; snapshots: Omit<Snapshot, "raw_gzip" | "text">[]; changes: Change[]; latestText: string | null }> = ({
  principal,
  t,
  page,
  competitor,
  snapshots,
  changes,
  latestText,
}) => (
  <Layout title={page.url} principal={principal} t={t}>
    <p class="muted small">
      <a href="/">{t("nav.dashboard")}</a> / <a href={`/b/${competitor.business_id}`}>{competitor.name}</a>
    </p>
    <h1 style="font-size:1.3rem;word-break:break-all">{page.url}</h1>
    <p class="row small">
      <StatusBadge page={page} t={t} />
      <span class="muted">
        {competitor.name} · {t(`kind.${page.kind}`)} · {t("page.every", { interval: humanMinutes(page.check_interval_minutes) })} · {t("pd.next", { date: fmtDate(page.next_check_at) })} · {t("pd.failures", { n: page.consecutive_failures })} ·{" "}
        {t("pd.since", { date: fmtDate(page.status_since) })}
      </span>
    </p>
    {page.status_message ? <div class="card alert small">{page.status_message}</div> : null}
    <h2>{t("pd.snapshots", { n: snapshots.length })}</h2>
    <div class="card flat">
      <table>
        <thead>
          <tr>
            <th>{t("pd.fetched")}</th>
            <th>{t("pd.lastseen")}</th>
            <th>{t("pd.http")}</th>
            <th>{t("pd.title")}</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map((s) => (
            <tr>
              <td>{fmtDate(s.fetched_at)}</td>
              <td>{fmtDate(s.last_seen_at)}</td>
              <td>{s.http_status}</td>
              <td>{s.title}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <h2>{t("pd.changes", { n: changes.length })}</h2>
    <div class="card flat">
      <table>
        <tbody>
          {changes.map((c) => (
            <tr>
              <td>{fmtDate(c.detected_at)}</td>
              <td>{t("pd.significance", { n: c.significance })}</td>
              <td>{JSON.parse(c.signals_json).join(", ")}</td>
              <td>
                <span class="badge">{c.analysis_status.replace(/_/g, " ")}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <h2>{t("pd.latest")}</h2>
    <pre>{latestText ?? t("pd.nosnap")}</pre>
  </Layout>
);

export const SettingsPage: FC<{ principal: Principal; t: Translate; account: Account; users: User[]; keys: ApiKey[]; newKey?: string | undefined; flash?: string | undefined; error?: string | undefined }> = ({ principal, t, account, users, keys, newKey, flash, error }) => (
  <Layout title={t("set.title")} principal={principal} flash={flash} t={t}>
    <h1>{t("set.title")}</h1>
    {error ? <div class="card alert">{error}</div> : null}
    <div class="grid g3">
      <div class="card">
        <h3 style="margin-top:0">{t("set.account")}</h3>
        <p>
          <strong>{account.name}</strong> <span class="badge brand">{t("dash.plan", { plan: getPlan(account.plan).name })}</span>
        </p>
        <p class="muted small">{t("set.members", { list: users.map((u) => u.email).join(", ") })}</p>
        <p class="muted small">{t("set.bigger", { email: COMPANY.contact })}</p>
      </div>
      <div class="card">
        <h3 style="margin-top:0">{t("set.language")}</h3>
        <p class="muted small">{t("set.language.p")}</p>
        <form method="post" action="/settings/language" class="inline">
          <select name="lang">
            {LOCALES.map((l: Locale) => (
              <option value={l} selected={l === t.locale}>
                {translator(l)("lang.name")}
              </option>
            ))}
          </select>
          <button class="secondary tiny" type="submit">
            {t("set.language.save")}
          </button>
        </form>
      </div>
      <div class="card">
        <h3 style="margin-top:0">{t("set.pw.h")}</h3>
        <p class="muted small">{principal.user.password_hash ? t("set.pw.set", { date: fmtDate(principal.user.password_set_at) }) : t("set.pw.unset")}</p>
        <form method="post" action="/settings/password">
          <label>
            {principal.user.password_hash ? t("set.pw.new") : t("set.pw.choose")}
            <input name="password" type="password" required minlength={12} maxlength={128} autocomplete="new-password" />
          </label>
          <p class="tiny muted">{t("set.pw.hint")}</p>
          <div class="row">
            <button type="submit" class="secondary tiny">
              {principal.user.password_hash ? t("set.pw.change") : t("set.pw.setbtn")}
            </button>
            {principal.user.password_hash ? (
              <button type="submit" class="danger tiny" formaction="/settings/password/remove">
                {t("set.pw.remove")}
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>

    <h2>{t("set.keys.h")}</h2>
    <div class="card">
      <p class="muted small">{t("set.keys.p")}</p>
      {newKey ? (
        <div class="card good">
          <strong>{t("set.keys.new")}</strong> <code>{newKey}</code>
        </div>
      ) : null}
      {keys.length ? (
        <table>
          <tbody>
            {keys.map((k) => (
              <tr>
                <td>{k.name}</td>
                <td>
                  <code>{k.key_prefix}…</code>
                </td>
                <td class="muted small">{fmtDate(k.created_at)}</td>
                <td class="muted small">{fmtDate(k.last_used_at)}</td>
                <td style="text-align:right">
                  {k.revoked_at ? (
                    <span class="badge">{t("set.keys.revoked")}</span>
                  ) : (
                    <form method="post" action={`/settings/api-keys/${k.id}/revoke`}>
                      <button class="danger tiny" type="submit">
                        {t("set.keys.revoke")}
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <form method="post" action="/settings/api-keys" class="inline" style="margin-top:.75rem">
        <label>
          {t("set.keys.name")} <input name="name" required pattern="[A-Za-z0-9._-]{1,64}" placeholder="my-script" />
        </label>
        <button class="secondary" type="submit">
          {t("set.keys.create")}
        </button>
      </form>
    </div>

    <h2>{t("set.data.h")}</h2>
    <div class="grid g2">
      <div class="card">
        <h3 style="margin-top:0">{t("set.export.h")}</h3>
        <p class="muted small">{t("set.export.p")}</p>
        <a class="btn secondary tiny" href="/settings/export">
          {t("set.export.btn")}
        </a>
      </div>
      <div class="card">
        <h3 style="margin-top:0">{t("set.delete.h")}</h3>
        {account.delete_after ? (
          <>
            <p class="small">
              <strong>{t("set.delete.scheduled", { date: fmtDate(account.delete_after) })}</strong>
            </p>
            <form method="post" action="/settings/delete/cancel">
              <button class="secondary tiny" type="submit">
                {t("set.delete.cancel")}
              </button>
            </form>
          </>
        ) : (
          <>
            <p class="muted small">{t("set.delete.p")}</p>
            <form method="post" action="/settings/delete" onsubmit={`return confirm(${JSON.stringify(t("set.delete.js"))})`}>
              <label class="check small">
                <input type="checkbox" name="confirm" value="1" required /> <span>{t("set.delete.confirm")}</span>
              </label>
              <button class="danger tiny" type="submit">
                {t("set.delete.btn")}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
    <p class="muted tiny">
      {t("set.legal")}: <a href="/terms">{t("footer.terms")}</a> · <a href="/privacy">{t("footer.privacy")}</a> · v{LEGAL_VERSION}
    </p>
  </Layout>
);

// ---------------------------------------------------------------------------
// Admin (operator-facing, English only)
// ---------------------------------------------------------------------------

export type ApprovalView = Approval & { summary: string };

export interface AdminOverview {
  backups: { offsite: boolean; lastAt: string | null; lastOk: boolean | null; local: number };
  agents: { enabled: boolean; state: (AgentStateRow & { title: string; description: string; interval_hours: number })[]; runs: AgentRunRow[]; notes: AgentNote[]; cost24h: number };
  pendingApprovals: ApprovalView[];
  recentApprovals: ApprovalView[];
  totals: Record<string, number>;
  pagesByStatus: Record<string, number>;
  fetch24h: { fetched: number; failed: number };
  insights: { d1: number; d7: number; d30: number };
  ai: { calls24h: number; calls7d: number; cost24h: number; cost7d: number; cost30d: number; capReached24h: number; provider: string; model: string; callCap: number; costCapUsd: number };
  feedback: Record<string, number>;
  scheduler: Record<string, unknown>;
  errors: EventRow[];
  unhealthyPages: MonitoredPage[];
  users: (User & { account_name: string; account_plan: string })[];
  emails: EmailRow[];
  recent: EventRow[];
}

export const AdminPage: FC<{ principal: Principal; o: AdminOverview; flash?: string | undefined }> = ({ principal, o, flash }) => (
  <Layout title="Admin" principal={principal} flash={flash}>
    <h1>Owner dashboard</h1>

    <div class={`card${o.pendingApprovals.length ? " alert" : " good"}`}>
      <h2 style="margin-top:0">Needs your attention ({o.pendingApprovals.length})</h2>
      {o.pendingApprovals.length === 0 ? <p class="muted small" style="margin:0">No pending approvals. Agents and admins request consequential actions here; nothing runs until you decide.</p> : null}
      {o.pendingApprovals.map((a) => (
        <div class="card flat" style="margin:.5rem 0">
          <div class="row small">
            <span class={`badge ${a.risk_level === "high" ? "bad" : ""}`}>{a.risk_level} risk</span>
            <strong>{a.summary}</strong>
            <span class="muted">
              #{a.id} · {a.action} · by {a.requested_by} · {fmtDate(a.created_at)} · expires {fmtDate(a.expires_at)}
            </span>
          </div>
          {a.reason ? <p class="small">Reason: {a.reason}</p> : null}
          <details>
            <summary class="muted tiny">payload</summary>
            <pre>{a.payload}</pre>
          </details>
          <div class="row" style="margin-top:.4rem">
            <form method="post" action={`/admin/approvals/${a.id}/approve`} class="inline">
              <input name="note" placeholder="note (optional)" />
              <button type="submit" class="tiny">
                Approve &amp; execute
              </button>
            </form>
            <form method="post" action={`/admin/approvals/${a.id}/deny`} class="inline">
              <input name="note" placeholder="why not? (optional)" />
              <button class="danger tiny" type="submit">
                Deny
              </button>
            </form>
          </div>
        </div>
      ))}
      {o.recentApprovals.length ? (
        <details style="margin-top:.5rem">
          <summary class="muted small">Recent decisions ({o.recentApprovals.length})</summary>
          <table>
            <tbody>
              {o.recentApprovals.map((a) => (
                <tr>
                  <td class="muted small">{fmtDate(a.decided_at ?? a.created_at)}</td>
                  <td>
                    <span class="badge">{a.status}</span>
                  </td>
                  <td>{a.summary}</td>
                  <td class="muted small">
                    by {a.decided_by ?? "—"} · requested by {a.requested_by}
                  </td>
                  <td class="muted small">{a.status === "failed" ? a.result : a.decision_note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </div>

    <div class="card">
      <div class="row">
        <h2 style="margin:0">Agents</h2>
        <span class={`badge ${o.agents.enabled ? "ok" : ""}`}>{o.agents.enabled ? "enabled" : "disabled (AGENTS_ENABLED=false or no Anthropic provider)"}</span>
        <span class="muted small">agent spend 24h {fmtUsd(o.agents.cost24h)}</span>
      </div>
      <table style="margin-top:.5rem">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Every</th>
            <th>Last run</th>
            <th>Next run</th>
            <th>State</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {o.agents.state.map((a) => (
            <tr>
              <td>
                <strong>{a.title}</strong>
                <div class="muted tiny">{a.description}</div>
              </td>
              <td>{a.interval_hours}h</td>
              <td class="muted small">
                {fmtDate(a.last_run_at)} {a.last_status ? <span class="badge">{a.last_status}</span> : null}
              </td>
              <td class="muted small">{a.enabled ? fmtDate(a.next_run_at) : "—"}</td>
              <td>{a.enabled ? <span class="badge ok">on</span> : <span class="badge">off</span>}</td>
              <td style="white-space:nowrap;text-align:right">
                <form method="post" action={`/admin/agents/${a.name}/run`} style="display:inline">
                  <button class="tiny secondary" type="submit" disabled={!o.agents.enabled}>
                    Run now
                  </button>
                </form>{" "}
                <form method="post" action={`/admin/agents/${a.name}/${a.enabled ? "disable" : "enable"}`} style="display:inline">
                  <button class="tiny secondary" type="submit">
                    {a.enabled ? "Disable" : "Enable"}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {o.agents.notes.length ? (
        <>
          <h3>Agent notes</h3>
          {o.agents.notes.map((n) => (
            <details class="card flat" style={n.read_at ? "opacity:.75" : "border-color:var(--brand)"}>
              <summary>
                <span class="badge">{n.kind}</span> <strong>{n.title}</strong>{" "}
                <span class="muted small">
                  · {n.agent} · {fmtDate(n.created_at)}
                </span>
              </summary>
              <div class="prose small">{raw(renderMarkdown(n.body))}</div>
              {n.read_at ? null : (
                <form method="post" action={`/admin/notes/${n.id}/read`}>
                  <button class="tiny secondary" type="submit">
                    Mark read
                  </button>
                </form>
              )}
            </details>
          ))}
        </>
      ) : (
        <p class="muted small" style="margin:.6rem 0 0">No agent notes yet.</p>
      )}
      {o.agents.runs.length ? (
        <details style="margin-top:.5rem">
          <summary class="muted small">Recent runs ({o.agents.runs.length})</summary>
          <table>
            <tbody>
              {o.agents.runs.map((r) => (
                <tr>
                  <td class="muted small">{fmtDate(r.started_at)}</td>
                  <td>{r.agent}</td>
                  <td>
                    <span class="badge">{r.status}</span>
                  </td>
                  <td class="muted small">
                    {r.turns} turns · {r.tool_calls} tools · {fmtUsd(r.estimated_cost_usd)}
                  </td>
                  <td class="small">{r.summary ?? r.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </div>

    <div class="card">
      {Object.entries(o.totals).map(([k, v]) => (
        <span class="stat">
          <b>{v}</b>
          <span class="muted small">{k}</span>
        </span>
      ))}
    </div>
    <div class="grid g3">
      <div class="card">
        <h3 style="margin-top:0">Fetch health (24h)</h3>
        <span class="stat">
          <b>{o.fetch24h.fetched}</b>
          <span class="muted small">fetched</span>
        </span>
        <span class="stat">
          <b style={o.fetch24h.failed ? "color:var(--bad)" : ""}>{o.fetch24h.failed}</b>
          <span class="muted small">failed</span>
        </span>
        <div>
          {Object.entries(o.pagesByStatus).map(([s, n]) => (
            <span class={`badge st-${s}`} style="margin:.2rem .2rem 0 0">
              {s}: {n}
            </span>
          ))}
        </div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Insights</h3>
        <span class="stat">
          <b>{o.insights.d1}</b>
          <span class="muted small">24h</span>
        </span>
        <span class="stat">
          <b>{o.insights.d7}</b>
          <span class="muted small">7d</span>
        </span>
        <span class="stat">
          <b>{o.insights.d30}</b>
          <span class="muted small">30d</span>
        </span>
        <div class="muted small">Feedback (30d): {Object.entries(o.feedback).map(([k, v]) => `${k} ${v}`).join(" · ") || "none yet"}</div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">LLM</h3>
        <span class="stat">
          <b>{o.ai.calls24h}</b>
          <span class="muted small">calls 24h (cap {o.ai.callCap || "∞"})</span>
        </span>
        <span class="stat">
          <b>{fmtUsd(o.ai.cost24h)}</b>
          <span class="muted small">24h (cap ${o.ai.costCapUsd || "∞"})</span>
        </span>
        <span class="stat">
          <b>{fmtUsd(o.ai.cost7d)}</b>
          <span class="muted small">7d</span>
        </span>
        <span class="stat">
          <b>{fmtUsd(o.ai.cost30d)}</b>
          <span class="muted small">30d</span>
        </span>
        <div class="muted small">
          {o.ai.provider} · {o.ai.model} · cap hit {o.ai.capReached24h}× in 24h
        </div>
      </div>
    </div>

    <div class={`card${o.backups.lastOk === false || (o.backups.lastAt && Date.now() - new Date(o.backups.lastAt).getTime() > 2 * 86_400_000) ? " alert" : ""}`}>
      <div class="row">
        <h2 style="margin:0">Backups</h2>
        <span class="muted small">
          last: {o.backups.lastAt ? `${fmtDate(o.backups.lastAt)} (${o.backups.lastOk ? "ok" : "FAILED"})` : "never"} · local copies: {o.backups.local} · off-site: {o.backups.offsite ? "configured" : <span style="color:var(--warn)">not configured — volume loss would lose all data</span>}
        </span>
        <form method="post" action="/admin/backups/run" class="ml">
          <button class="tiny secondary" type="submit">
            Back up now
          </button>
        </form>
      </div>
    </div>

    <h2>Unhealthy pages ({o.unhealthyPages.length})</h2>
    {o.unhealthyPages.length === 0 ? <p class="muted small">All monitored pages are ACTIVE.</p> : null}
    {o.unhealthyPages.length ? (
      <div class="card flat">
        <table>
          <tbody>
            {o.unhealthyPages.map((p) => (
              <tr>
                <td>
                  <StatusBadge page={p} />
                </td>
                <td>{p.url}</td>
                <td class="muted small">{p.status_message}</td>
                <td class="muted small">
                  since {fmtDate(p.status_since)} · account #{p.account_id}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : null}

    <h2>Users ({o.users.length})</h2>
    <p class="muted small">Changing a plan is a tier-3 (human) action routed through approvals with you as approver.</p>
    <div class="card flat">
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Account</th>
            <th>Plan</th>
            <th>Lang</th>
            <th>Admin</th>
            <th>Joined</th>
            <th>Last login</th>
          </tr>
        </thead>
        <tbody>
          {o.users.map((u) => (
            <tr>
              <td>{u.email}</td>
              <td>
                {u.account_name} <span class="muted small">#{u.account_id}</span>
              </td>
              <td>
                <form method="post" action={`/admin/accounts/${u.account_id}/plan`} class="inline" style="gap:.3rem">
                  <select name="plan">
                    {Object.values(PLANS).map((p) => (
                      <option value={p.id} selected={p.id === u.account_plan}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button class="tiny secondary" type="submit">
                    Set
                  </button>
                </form>
              </td>
              <td class="muted small">{u.locale ?? "—"}</td>
              <td>{u.is_admin ? "yes" : ""}</td>
              <td class="muted small">{fmtDate(u.created_at)}</td>
              <td class="muted small">{fmtDate(u.last_login_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <h2>Recent errors / failed events ({o.errors.length})</h2>
    <div class="card flat">
      <EventsTable events={o.errors} />
    </div>

    <h2>Recent emails</h2>
    <div class="card flat">
      <table>
        <tbody>
          {o.emails.map((e) => (
            <tr>
              <td class="muted small">{fmtDate(e.created_at)}</td>
              <td>{e.kind}</td>
              <td>{e.to_address}</td>
              <td>
                <span class="badge">{e.status}</span> {e.provider}
              </td>
              <td class="muted small">{e.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <h2>Recent events</h2>
    <p class="muted small">
      Scheduler: {JSON.stringify(o.scheduler)} · JSON at <a href="/api/admin/overview">/api/admin/overview</a> and <a href="/api/admin/events">/api/admin/events</a>
    </p>
    <div class="card flat">
      <EventsTable events={o.recent} />
    </div>
  </Layout>
);

export const EventsTable: FC<{ events: EventRow[] }> = ({ events }) => (
  <table>
    <thead>
      <tr>
        <th>Time</th>
        <th>Action</th>
        <th>Actor</th>
        <th>Target</th>
        <th>Risk</th>
        <th>Result</th>
        <th>Cost</th>
        <th>Metadata</th>
      </tr>
    </thead>
    <tbody>
      {events.map((e) => (
        <tr>
          <td class="muted small" style="white-space:nowrap">
            {fmtDate(e.ts)}
          </td>
          <td>{e.type}</td>
          <td class="small">{e.actor}</td>
          <td class="small">
            {e.entity_type ? `${e.entity_type}#${e.entity_id}` : ""}
            {e.account_id ? <span class="muted"> a{e.account_id}</span> : null}
          </td>
          <td class="small">{e.risk_level}</td>
          <td class="small" style={e.result === "failed" ? "color:var(--bad)" : ""}>
            {e.result}
          </td>
          <td class="muted small">{e.estimated_cost_usd != null ? fmtUsd(e.estimated_cost_usd) : ""}</td>
          <td>
            <code style="font-size:.75rem">{e.payload}</code>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

function humanMinutes(m: number): string {
  if (m % 1440 === 0) return `${m / 1440}d`;
  if (m % 60 === 0) return `${m / 60}h`;
  return `${m}m`;
}
