import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import type { AgentNote, AgentRunRow, AgentStateRow } from "../agents/types.js";
import type { Approval } from "../approvals.js";
import type { Principal } from "../auth.js";
import type { Account, ApiKey, Business, Change, Competitor, EmailRow, Insight, InsightFeedback, MonitoredPage, PageSuggestion, Snapshot, User } from "../db/repo.js";
import type { EventRow } from "../events.js";
import { COMPANY, LEGAL_VERSION } from "../legal.js";
import { PLANS, getPlan } from "../plans.js";
import { renderMarkdown } from "./md.js";
import { CSS } from "./theme.js";

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export const Layout: FC<{ title: string; children?: unknown; flash?: string | undefined; principal?: Principal | undefined; description?: string; wide?: boolean }> = ({ title, children, flash, principal, description, wide }) => (
  <html lang="en-GB">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · RivalWatch</title>
      <meta name="description" content={description ?? "RivalWatch watches your competitors' websites and tells you, in plain English, when something happens that actually matters."} />
      <meta name="color-scheme" content="light" />
      <style>{CSS}</style>
    </head>
    <body>
      <nav class="nav">
        <div class="nav-in">
          <a class="brand" href="/">
            <span class="logo" aria-hidden="true"></span>RivalWatch
          </a>
          {principal ? (
            <>
              <a class="link" href="/">Dashboard</a>
              <a class="link hide-sm" href="/settings">Settings</a>
              {principal.isAdmin ? <a class="link" href="/admin">Admin</a> : null}
            </>
          ) : (
            <>
              <a class="link hide-sm" href="/#how">How it works</a>
              <a class="link" href="/pricing">Pricing</a>
            </>
          )}
          <span class="right">
            {principal ? (
              <>
                <span class="muted small hide-sm">{principal.user.email}</span>
                <form method="post" action="/auth/logout" style="display:inline">
                  <button class="tiny secondary" type="submit">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <>
                <a class="link" href="/login">Sign in</a>
                <a class="btn tiny" href="/login?mode=signup" style="padding:.4rem .8rem;font-size:.85rem">
                  Start free
                </a>
              </>
            )}
          </span>
        </div>
      </nav>
      <main class={`wrap${wide ? "" : ""}`}>
        {flash ? <div class="card info">{flash}</div> : null}
        {children}
      </main>
      <Footer />
    </body>
  </html>
);

const Footer: FC = () => (
  <footer class="footer">
    <div class="footer-in">
      <span>© {new Date().getFullYear()} RivalWatch</span>
      <a href="/pricing">Pricing</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/bot">Our crawler</a>
      <a href={`mailto:${COMPANY.contact}`}>Contact</a>
      <span class="ml tiny">Made in the UK. No tracking cookies.</span>
    </div>
  </footer>
);

const fmtDate = (iso: string | null | undefined) => (iso ? iso.replace("T", " ").slice(0, 16) + " UTC" : "—");
const fmtUsd = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(4)}`);
const gbp = (pence: number) => (pence === 0 ? "Free" : `£${(pence / 100).toFixed(2)}`);

// ---------------------------------------------------------------------------
// Public pages
// ---------------------------------------------------------------------------

const ExampleInsight: FC = () => (
  <div class="card insight" style="text-align:left;max-width:640px;margin:2rem auto 0">
    <div class="row small">
      <span class="badge cat imp-4">pricing</span>
      <span class="badge">importance 4/5</span>
      <span class="muted">Acme Studio · pricing page · confirmed 2 hours ago</span>
    </div>
    <h3>Acme Studio raised its Professional plan from £49 to £59/month and added a £399/year option</h3>
    <p>Their main monthly tier went up 20%. The new annual plan works out at about £33/month for customers who commit for a year.</p>
    <div class="why">
      <strong>Why this matters to you:</strong> your Studio tier (£55/month) is now cheaper than their monthly price, which you can use in positioning. But their annual option undercuts you for committed buyers — worth deciding whether to offer one.
    </div>
  </div>
);

export const LandingPage: FC = () => (
  <Layout title="Know when your competitors move" description="AI-filtered competitor monitoring for small businesses. We watch their pricing, products and announcements and tell you only what matters.">
    <section class="hero">
      <span class="eyebrow">Competitor monitoring for small businesses</span>
      <h1>Know when your competitors move — without watching them yourself.</h1>
      <p class="lead">Tell us who your competitors are. We quietly check their pricing, product and announcement pages and tell you, in plain English, when something changes that actually matters to your business.</p>
      <div class="row" style="justify-content:center">
        <a class="btn big" href="/login?mode=signup">
          Start free — 2 competitors
        </a>
        <a class="btn big secondary" href="/pricing">
          See pricing
        </a>
      </div>
      <p class="muted small">No card needed. Cancel any time. Your data is yours — export or delete it in one click.</p>
      <ExampleInsight />
    </section>

    <section id="how">
      <h2 class="center">How it works</h2>
      <div class="grid g3 steps">
        <div class="card step">
          <h3>Tell us about you and them</h3>
          <p class="muted">Describe your business and your prices, then add competitor websites. We find their pricing, product and news pages for you to confirm.</p>
        </div>
        <div class="card step">
          <h3>We watch, politely</h3>
          <p class="muted">Our crawler checks the pages you chose on a schedule, respects every site's rules, and confirms each change on a second visit so A/B tests and glitches never reach you.</p>
        </div>
        <div class="card step">
          <h3>You get only what matters</h3>
          <p class="muted">An AI analyst reads each confirmed change against <em>your</em> pricing and positioning and writes a short note: what changed, and why it matters to you. Weekly digest, or alerts for the big ones.</p>
        </div>
      </div>
    </section>

    <section>
      <h2 class="center">Not another "page changed" alert</h2>
      <div class="grid g2">
        <div class="card flat">
          <h3>Signal, not noise</h3>
          <p class="muted">Rotating testimonials, dates, cookie banners and counters are filtered out before anything reaches you. Every insight links to the exact before/after text so you can verify it.</p>
        </div>
        <div class="card flat">
          <h3>Built for people, not analysts</h3>
          <p class="muted">No dashboards to learn. One page per business, one card per meaningful change, and a Monday email you can read in two minutes.</p>
        </div>
        <div class="card flat">
          <h3>Honest about coverage</h3>
          <p class="muted">If a site blocks automated access or we can't read it, you see that clearly on your dashboard. We never show a broken monitor as healthy.</p>
        </div>
        <div class="card flat">
          <h3>Your data, your rules</h3>
          <p class="muted">UK-based, GDPR-aligned. One necessary cookie, no trackers. Export everything as JSON or delete your account and all its data from Settings.</p>
        </div>
      </div>
    </section>

    <section class="center" style="padding:2rem 0 1rem">
      <h2>Start watching today</h2>
      <p class="muted">Two competitors free, forever. Upgrade when you need more.</p>
      <a class="btn big" href="/login?mode=signup">
        Create your free account
      </a>
    </section>
  </Layout>
);

export const PricingPage: FC<{ principal?: Principal | undefined }> = ({ principal }) => (
  <Layout title="Pricing" principal={principal} description="Simple pricing for competitor monitoring: free for 2 competitors, £9.99/month for 10, £19.99/month for 25.">
    <section class="hero" style="padding-bottom:1rem">
      <h1>Simple, honest pricing</h1>
      <p class="lead">Prices in GBP, VAT included where applicable. Monthly, cancel any time.</p>
    </section>
    <div class="grid g3">
      {Object.values(PLANS).map((p) => (
        <div class={`card plan${p.id === "pro" ? " featured" : ""}`}>
          {p.id === "pro" ? <span class="badge brand">Most popular</span> : null}
          <h3 style="margin-top:.5rem">{p.name}</h3>
          <div class="price">
            {gbp(p.price_pence_monthly)}
            {p.price_pence_monthly ? <small>/month</small> : null}
          </div>
          <ul class="tick">
            <li>
              Up to <strong>{p.max_competitors}</strong> competitor{p.max_competitors === 1 ? "" : "s"}
            </li>
            <li>{p.max_pages_per_competitor} pages per competitor</li>
            <li>Checked every {p.check_interval_minutes >= 1440 ? `${p.check_interval_minutes / 1440} day${p.check_interval_minutes / 1440 === 1 ? "" : "s"}` : `${p.check_interval_minutes / 60} hours`}</li>
            <li>AI analysis of every confirmed change</li>
            <li>Weekly email digest</li>
            {p.features.alerts ? <li>Instant alerts for important changes</li> : null}
            {p.features.history_trends ? <li>Historical trends</li> : null}
            {p.features.comparisons ? <li>You-vs-them comparisons</li> : null}
            {p.features.monthly_strategic_analysis ? <li>Monthly strategic analysis</li> : null}
          </ul>
          <a class={`btn${p.id === "pro" ? "" : " secondary"}`} href="/login?mode=signup" style="width:100%;justify-content:center">
            {p.price_pence_monthly ? `Start with ${p.name}` : "Start free"}
          </a>
        </div>
      ))}
    </div>
    <p class="muted small center" style="margin-top:1.5rem">
      Paid plans are in early access: create a free account and we'll upgrade you on request while billing is being finalised. Questions? <a href={`mailto:${COMPANY.contact}`}>{COMPANY.contact}</a>
    </p>
  </Layout>
);

export const LegalPage: FC<{ title: string; markdown: string; principal?: Principal | undefined }> = ({ title, markdown, principal }) => (
  <Layout title={title} principal={principal}>
    <article class="card prose narrow" style="margin:0 auto">
      {raw(renderMarkdown(markdown))}
    </article>
  </Layout>
);

export const LoginPage: FC<{ mode?: "signin" | "signup"; sent?: boolean; devLink?: string | undefined; error?: string | undefined; email?: string | undefined; next?: string | undefined }> = ({ mode = "signin", sent, devLink, error, email, next }) => (
  <Layout title={mode === "signup" ? "Create your account" : "Sign in"}>
    <div class="narrow" style="margin:2rem auto">
      <h1 class="center">{mode === "signup" ? "Create your free account" : "Sign in"}</h1>
      {error ? <div class="card alert">{error}</div> : null}
      {sent ? (
        <div class="card good">
          <p>
            If <strong>{email}</strong> is valid, a sign-in link is on its way. It expires in a few minutes and works once.
          </p>
          <p class="muted small">Not there after a minute? Check your spam folder and mark it "not spam" so future emails arrive in your inbox.</p>
          {devLink ? (
            <p class="muted small">
              Development mode: <a href={devLink}>open the sign-in link</a>
            </p>
          ) : null}
        </div>
      ) : (
        <div class="grid g2">
          <form method="post" action="/auth/login" class="card">
            <h3 style="margin-top:0">{mode === "signup" ? "Sign up with your email" : "Email me a sign-in link"}</h3>
            <p class="muted small">No password to remember. We email you a one-time link.</p>
            <input type="hidden" name="next" value={next ?? ""} />
            <label>
              Email <input name="email" type="email" required autocomplete="email" value={email ?? ""} />
            </label>
            <p>
              <button type="submit" style="width:100%;justify-content:center">
                {mode === "signup" ? "Create account" : "Send link"}
              </button>
            </p>
            {mode === "signup" ? (
              <p class="tiny muted">
                By continuing you'll be asked to accept our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.
              </p>
            ) : null}
          </form>
          <form method="post" action="/auth/password" class="card">
            <h3 style="margin-top:0">Sign in with a password</h3>
            <p class="muted small">If you've set one in Settings. Forgotten it? Use the email link instead.</p>
            <input type="hidden" name="next" value={next ?? ""} />
            <label>
              Email <input name="email" type="email" required autocomplete="username" />
            </label>
            <label>
              Password <input name="password" type="password" required autocomplete="current-password" minlength={1} />
            </label>
            <p>
              <button type="submit" class="secondary" style="width:100%;justify-content:center">
                Sign in
              </button>
            </p>
          </form>
        </div>
      )}
      <p class="center muted small">
        {mode === "signup" ? (
          <>
            Already have an account? <a href="/login">Sign in</a>
          </>
        ) : (
          <>
            New here? <a href="/login?mode=signup">Create a free account</a>
          </>
        )}
      </p>
    </div>
  </Layout>
);

export const ConsentPage: FC<{ principal: Principal; next?: string | undefined; error?: string | undefined; firstTime: boolean }> = ({ principal, next, error, firstTime }) => (
  <Layout title="Terms and privacy" principal={principal}>
    <div class="narrow" style="margin:2rem auto">
      <h1>{firstTime ? "One last thing" : "We've updated our terms"}</h1>
      <p class="muted">
        {firstTime ? "Before you start, please read and accept how the service works and how we look after your data." : `Version ${LEGAL_VERSION} of our Terms and Privacy Policy is now in force. Please review and accept to continue.`}
      </p>
      {error ? <div class="card alert">{error}</div> : null}
      <form method="post" action="/legal/accept" class="card">
        <input type="hidden" name="next" value={next ?? "/"} />
        <label class="check">
          <input type="checkbox" name="terms" value="1" required />
          <span>
            I have read and accept the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a>.
          </span>
        </label>
        <label class="check">
          <input type="checkbox" name="privacy" value="1" required />
          <span>
            I have read the <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a> and understand how my data is used, including AI analysis of the competitor pages I choose to monitor.
          </span>
        </label>
        <p>
          <button type="submit">Accept and continue</button>{" "}
          <a class="btn secondary" href="/auth/logout-get">
            Not now — sign out
          </a>
        </p>
      </form>
    </div>
  </Layout>
);

// ---------------------------------------------------------------------------
// App pages
// ---------------------------------------------------------------------------

export const BusinessesPage: FC<{ principal: Principal; businesses: Business[]; account: Account; flash?: string | undefined }> = ({ principal, businesses, account, flash }) => (
  <Layout title="Dashboard" principal={principal} flash={flash}>
    <div class="row">
      <h1 style="margin:0">Your businesses</h1>
      <span class="badge brand">{getPlan(account.plan).name} plan</span>
    </div>
    {account.delete_after ? (
      <div class="card alert">
        <strong>This account is scheduled for deletion</strong> on {fmtDate(account.delete_after)}. Monitoring is paused.{" "}
        <form method="post" action="/settings/delete/cancel" style="display:inline">
          <button class="tiny secondary" type="submit">
            Cancel deletion
          </button>
        </form>
      </div>
    ) : null}
    {businesses.length === 0 ? (
      <div class="card">
        <h2 style="margin-top:0">Welcome — let's set you up</h2>
        <p class="muted">Start by describing your own business. The AI uses this to explain why a competitor's change matters <em>to you</em>, so a sentence or two about what you sell and what you charge goes a long way.</p>
      </div>
    ) : null}
    {businesses.map((b) => (
      <a href={`/b/${b.id}`} class="card row" style="display:flex;color:inherit;text-decoration:none">
        <strong>{b.name}</strong>
        <span class="muted small">{b.website ?? ""}</span>
        <span class="ml muted small">Open →</span>
      </a>
    ))}
    <h2>{businesses.length ? "Add another business" : "Describe your business"}</h2>
    <form method="post" action="/b" class="card">
      <div class="grid g2">
        <label>
          Business name <input name="name" required placeholder="e.g. Bright Pixel Design" />
        </label>
        <label>
          Website <input name="website" type="url" placeholder="https://" />
        </label>
      </div>
      <label>
        What do you do, and for whom?
        <textarea name="description" placeholder="Freelance brand and web design for small UK businesses" />
      </label>
      <label>
        Your pricing (free text)
        <textarea name="pricing_notes" placeholder="Starter £25/month, Studio £55/month. No annual plan." />
      </label>
      <p>
        <button type="submit">Create business</button>
      </p>
    </form>
  </Layout>
);

export const StatusBadge: FC<{ page: MonitoredPage }> = ({ page }) => (
  <span class={`badge st-${page.status}`} title={page.status_message ?? ""}>
    {page.status.replace(/_/g, " ")}
  </span>
);

export const BusinessPage: FC<{
  principal: Principal;
  business: Business;
  account: Account;
  competitors: { competitor: Competitor; pages: MonitoredPage[]; suggestions: PageSuggestion[] }[];
  insights: Insight[];
  feedback: Record<number, InsightFeedback[]>;
  competitorNames: Record<number, string>;
  includeNoise: boolean;
  flash?: string | undefined;
}> = ({ principal, business, account, competitors, insights, feedback, competitorNames, includeNoise, flash }) => {
  const plan = getPlan(account.plan);
  const unhealthy = competitors.flatMap((c) => c.pages).filter((p) => p.status !== "ACTIVE" && p.status !== "PAUSED");
  return (
    <Layout title={business.name} principal={principal} flash={flash}>
      <div class="row">
        <div class="grow">
          <p class="muted small" style="margin:0">
            <a href="/">Dashboard</a> / {business.name}
          </p>
          <h1 style="margin:0">{business.name}</h1>
          <p class="muted small" style="margin:.2rem 0 0">
            {plan.name} plan · {competitors.length}/{plan.max_competitors} competitors · digest {business.digest_enabled ? `on, next ${fmtDate(business.next_digest_at)}` : "off"}
          </p>
        </div>
        <form method="post" action={`/b/${business.id}/scan`}>
          <button type="submit" class="secondary">
            Check all now
          </button>
        </form>
      </div>
      {unhealthy.length ? (
        <div class="card alert">
          <strong>Monitoring problem:</strong> {unhealthy.length} page{unhealthy.length === 1 ? " is" : "s are"} not being checked successfully. See the status column below — we never treat a broken monitor as healthy.
        </div>
      ) : null}

      <div class="row" style="margin-top:1.5rem">
        <h2 style="margin:0">Insights</h2>
        <span class="ml small">
          {includeNoise ? <a href={`/b/${business.id}`}>Hide filtered-out changes</a> : <a href={`/b/${business.id}?noise=1`}>Show filtered-out changes</a>}
          {" · "}
          <form method="post" action={`/b/${business.id}/digest`} style="display:inline">
            <input type="hidden" name="enabled" value={business.digest_enabled ? "0" : "1"} />
            <button class="tiny secondary" type="submit">
              digest {business.digest_enabled ? "off" : "on"}
            </button>
          </form>{" "}
          <form method="post" action={`/b/${business.id}/digest/send`} style="display:inline">
            <button class="tiny secondary" type="submit">
              email me a digest now
            </button>
          </form>
        </span>
      </div>
      {insights.length === 0 ? (
        <div class="card empty">
          {competitors.length === 0 ? "Add a competitor below to start." : "Nothing yet. We take a baseline first, then confirm every change on a second visit before it appears here — so the first insights typically arrive within a day or two of a competitor actually changing something."}
        </div>
      ) : null}
      {insights.map((i) => <InsightCard insight={i} competitorName={competitorNames[i.competitor_id] ?? "Competitor"} feedback={feedback[i.id] ?? []} />)}

      <h2>Competitors</h2>
      {competitors.map(({ competitor, pages, suggestions }) => (
        <div class="card">
          <div class="row">
            <strong style="font-size:1.05rem">{competitor.name}</strong>
            <a class="muted small" href={competitor.website} target="_blank" rel="noopener">
              {competitor.website}
            </a>
            <span class="ml"></span>
            <form method="post" action={`/competitors/${competitor.id}/discover`} style="display:inline">
              <button class="secondary tiny" type="submit">
                Find more pages
              </button>
            </form>
            <form method="post" action={`/competitors/${competitor.id}/delete`} style="display:inline" onsubmit="return confirm('Remove this competitor and everything we collected about it?')">
              <button class="danger tiny" type="submit">
                Remove
              </button>
            </form>
          </div>
          <table style="margin-top:.75rem">
            <thead>
              <tr>
                <th>Page</th>
                <th>Type</th>
                <th>Checked</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr>
                  <td>
                    <a href={`/pages/${p.id}`}>{p.url.replace(/^https?:\/\//, "")}</a>
                    {p.status_message && p.status !== "ACTIVE" ? <div class="muted tiny">{p.status_message}</div> : null}
                  </td>
                  <td>{p.kind}</td>
                  <td class="muted small">
                    every {humanMinutes(p.check_interval_minutes)}
                    <br />
                    last {fmtDate(p.last_checked_at)}
                  </td>
                  <td>
                    <StatusBadge page={p} />
                  </td>
                  <td style="white-space:nowrap;text-align:right">
                    <form method="post" action={`/pages/${p.id}/scan`} style="display:inline">
                      <button class="secondary tiny" type="submit" disabled={!p.enabled}>
                        Check
                      </button>
                    </form>{" "}
                    <form method="post" action={`/pages/${p.id}/${p.enabled ? "pause" : "resume"}`} style="display:inline">
                      <button class="secondary tiny" type="submit">
                        {p.enabled ? "Pause" : "Resume"}
                      </button>
                    </form>{" "}
                    <form method="post" action={`/pages/${p.id}/delete`} style="display:inline">
                      <button class="danger tiny" type="submit" aria-label="Remove page">
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
              <strong class="small">We found pages on their site worth monitoring — add the ones you care about:</strong>
              <table>
                <tbody>
                  {suggestions.map((s) => (
                    <tr>
                      <td>{s.url.replace(/^https?:\/\//, "")}</td>
                      <td>
                        <span class="badge">{s.kind}</span>
                      </td>
                      <td class="muted small">{s.reason}</td>
                      <td style="white-space:nowrap;text-align:right">
                        <form method="post" action={`/suggestions/${s.id}/accept`} style="display:inline">
                          <button class="tiny" type="submit">
                            Monitor
                          </button>
                        </form>{" "}
                        <form method="post" action={`/suggestions/${s.id}/dismiss`} style="display:inline">
                          <button class="secondary tiny" type="submit">
                            Dismiss
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
              Add a page URL <input name="url" type="url" required placeholder="https://competitor.com/pricing" />
            </label>
            <label>
              Type
              <select name="kind">
                <option value="pricing">pricing</option>
                <option value="home">home</option>
                <option value="products">products</option>
                <option value="blog">blog / news</option>
                <option value="other">other</option>
              </select>
            </label>
            <button class="secondary" type="submit">
              Add page
            </button>
          </form>
        </div>
      ))}

      <h2>Add a competitor</h2>
      <form method="post" action={`/b/${business.id}/competitors`} class="card inline">
        <label>
          Name <input name="name" required placeholder="Acme Studio" />
        </label>
        <label class="grow">
          Website <input name="website" type="url" required placeholder="https://acme.example" />
        </label>
        <button type="submit">Add competitor</button>
        <p class="muted tiny" style="width:100%;margin:0">We monitor their home page straight away and suggest pricing, product and news pages for you to confirm.</p>
      </form>
    </Layout>
  );
};

const VERDICTS: { v: string; label: string }[] = [
  { v: "useful", label: "Useful" },
  { v: "not_useful", label: "Not useful" },
  { v: "incorrect", label: "Incorrect" },
  { v: "too_noisy", label: "Too noisy" },
];

export const InsightCard: FC<{ insight: Insight; competitorName: string; feedback: InsightFeedback[] }> = ({ insight, competitorName, feedback }) => {
  const mine = feedback[0]?.verdict;
  return (
    <div class={`card insight${insight.matters ? "" : " filtered"}`}>
      <div class="row small">
        <span class={`badge cat imp-${insight.importance}`}>{insight.category}</span>
        <span class="badge">importance {insight.importance}/5</span>
        {insight.matters ? null : <span class="badge">filtered out</span>}
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
        <strong>Why this matters to you:</strong> {insight.why_it_matters}
      </div>
      <div class="fb small" style="margin-top:.6rem">
        <span class="muted">Was this helpful?</span>
        {VERDICTS.map(({ v, label }) => (
          <form method="post" action={`/insights/${insight.id}/feedback`}>
            <input type="hidden" name="verdict" value={v} />
            <button class={`tiny secondary${mine === v ? " active" : ""}`} type="submit">
              {label}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
};

export const InsightDetailPage: FC<{ principal: Principal; insight: Insight; change: Change; page: MonitoredPage; competitor: Competitor; business: Business; feedback: InsightFeedback[] }> = ({
  principal,
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
    <Layout title={insight.headline} principal={principal}>
      <p class="muted small">
        <a href="/">Dashboard</a> / <a href={`/b/${business.id}`}>{business.name}</a> / insight
      </p>
      <InsightCard insight={insight} competitorName={competitor.name} feedback={feedback} />
      <h2>Evidence</h2>
      <p class="muted small">
        <a href={page.url} target="_blank" rel="noopener">
          {page.url}
        </a>{" "}
        · detected {fmtDate(change.detected_at)} · confirmed {fmtDate(change.confirmed_at)} · significance {change.significance} · signals {JSON.parse(change.signals_json).join(", ") || "none"}
        {principal.isAdmin ? ` · ${insight.provider}${insight.model ? ` (${insight.model})` : ""} · tokens ${insight.input_tokens ?? 0}/${insight.output_tokens ?? 0} · ${fmtUsd(insight.estimated_cost_usd)}` : ""}
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
          Re-analyse this change
        </button>
      </form>
    </Layout>
  );
};

export const PageDetailPage: FC<{ principal: Principal; page: MonitoredPage; competitor: Competitor; snapshots: Omit<Snapshot, "raw_gzip" | "text">[]; changes: Change[]; latestText: string | null }> = ({
  principal,
  page,
  competitor,
  snapshots,
  changes,
  latestText,
}) => (
  <Layout title={page.url} principal={principal}>
    <p class="muted small">
      <a href="/">Dashboard</a> / <a href={`/b/${competitor.business_id}`}>back</a> / page
    </p>
    <h1 style="font-size:1.3rem;word-break:break-all">{page.url}</h1>
    <p class="row small">
      <StatusBadge page={page} />
      <span class="muted">
        {competitor.name} · {page.kind} · every {humanMinutes(page.check_interval_minutes)} · next check {fmtDate(page.next_check_at)} · consecutive failures {page.consecutive_failures} · status since {fmtDate(page.status_since)}
      </span>
    </p>
    {page.status_message ? <div class="card alert small">{page.status_message}</div> : null}
    <h2>Snapshots ({snapshots.length})</h2>
    <div class="card flat">
      <table>
        <thead>
          <tr>
            <th>Fetched</th>
            <th>Last seen</th>
            <th>HTTP</th>
            <th>Title</th>
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
    <h2>Changes ({changes.length})</h2>
    <div class="card flat">
      <table>
        <tbody>
          {changes.map((c) => (
            <tr>
              <td>{fmtDate(c.detected_at)}</td>
              <td>significance {c.significance}</td>
              <td>{JSON.parse(c.signals_json).join(", ")}</td>
              <td>
                <span class="badge">{c.analysis_status.replace(/_/g, " ")}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <h2>Latest extracted text</h2>
    <pre>{latestText ?? "(no snapshot yet)"}</pre>
  </Layout>
);

export const SettingsPage: FC<{ principal: Principal; account: Account; users: User[]; keys: ApiKey[]; newKey?: string | undefined; flash?: string | undefined; error?: string | undefined }> = ({ principal, account, users, keys, newKey, flash, error }) => (
  <Layout title="Settings" principal={principal} flash={flash}>
    <h1>Settings</h1>
    {error ? <div class="card alert">{error}</div> : null}
    <div class="grid g2">
      <div class="card">
        <h3 style="margin-top:0">Account</h3>
        <p>
          <strong>{account.name}</strong> <span class="badge brand">{getPlan(account.plan).name} plan</span>
        </p>
        <p class="muted small">Members: {users.map((u) => u.email).join(", ")}</p>
        <p class="muted small">
          Need a bigger plan? Email <a href={`mailto:${COMPANY.contact}`}>{COMPANY.contact}</a> while billing is in early access.
        </p>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Password</h3>
        <p class="muted small">{principal.user.password_hash ? `A password is set (since ${fmtDate(principal.user.password_set_at)}). You can still sign in with an email link.` : "Optional. You can always sign in with an email link; a password just adds a second way in."}</p>
        <form method="post" action="/settings/password">
          <label>
            {principal.user.password_hash ? "New password" : "Choose a password"}
            <input name="password" type="password" required minlength={12} maxlength={128} autocomplete="new-password" />
          </label>
          <p class="tiny muted">At least 12 characters. A short sentence is easier to remember than symbols.</p>
          <div class="row">
            <button type="submit" class="secondary tiny">
              {principal.user.password_hash ? "Change password" : "Set password"}
            </button>
            {principal.user.password_hash ? (
              <button type="submit" class="danger tiny" formaction="/settings/password/remove">
                Remove password
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>

    <h2>API keys</h2>
    <div class="card">
      <p class="muted small">
        For scripts and AI agents. Send as <code>Authorization: Bearer rw_…</code>. Actions are attributed to <code>agent:&lt;name&gt;</code> in your audit trail and are limited to this account.
      </p>
      {newKey ? (
        <div class="card good">
          <strong>New key (shown once):</strong> <code>{newKey}</code>
        </div>
      ) : null}
      {keys.length ? (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Created</th>
              <th>Last used</th>
              <th></th>
            </tr>
          </thead>
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
                    <span class="badge">revoked</span>
                  ) : (
                    <form method="post" action={`/settings/api-keys/${k.id}/revoke`}>
                      <button class="danger tiny" type="submit">
                        Revoke
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
          Key name <input name="name" required pattern="[A-Za-z0-9._-]{1,64}" placeholder="my-script" />
        </label>
        <button class="secondary" type="submit">
          Create API key
        </button>
      </form>
    </div>

    <h2>Your data</h2>
    <div class="grid g2">
      <div class="card">
        <h3 style="margin-top:0">Export</h3>
        <p class="muted small">Download everything we hold about this account as a single JSON file: businesses, competitors, pages, snapshots (text), insights, feedback, emails, audit events.</p>
        <a class="btn secondary tiny" href="/settings/export">
          Download my data (JSON)
        </a>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Delete account</h3>
        {account.delete_after ? (
          <>
            <p class="small">
              <strong>Deletion scheduled</strong> for {fmtDate(account.delete_after)}. Monitoring is paused. All data will be permanently removed after that date.
            </p>
            <form method="post" action="/settings/delete/cancel">
              <button class="secondary tiny" type="submit">
                Cancel deletion
              </button>
            </form>
          </>
        ) : (
          <>
            <p class="muted small">Removes this account and all its data after a 7-day grace period (you can cancel within that window). Audit records are kept without any personal identifiers.</p>
            <form method="post" action="/settings/delete" onsubmit="return confirm('Delete this account and all of its data after 7 days?')">
              <label class="check small">
                <input type="checkbox" name="confirm" value="1" required /> <span>I understand this is permanent.</span>
              </label>
              <button class="danger tiny" type="submit">
                Delete my account
              </button>
            </form>
          </>
        )}
      </div>
    </div>
    <p class="muted tiny">
      Legal: <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · accepted version {LEGAL_VERSION}
    </p>
  </Layout>
);

// ---------------------------------------------------------------------------
// Admin
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
