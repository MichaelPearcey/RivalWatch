import type { FC } from "hono/jsx";
import type { AgentNote, AgentRunRow, AgentStateRow } from "../agents/types.js";
import type { Approval } from "../approvals.js";
import type { Principal } from "../auth.js";
import type { Account, ApiKey, Business, Change, Competitor, EmailRow, Insight, InsightFeedback, MonitoredPage, PageSuggestion, Snapshot, User } from "../db/repo.js";
import type { EventRow } from "../events.js";
import { PLANS, getPlan } from "../plans.js";

const css = `
:root{--bg:#f7f7f5;--fg:#1c1c1c;--muted:#666;--card:#fff;--line:#e3e3df;--accent:#0b5fff;--warn:#b45309;--ok:#15803d;--bad:#b91c1c}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
header{background:#111;color:#fff;padding:.6rem 1.2rem;display:flex;gap:1.5rem;align-items:center}header a{color:#fff;text-decoration:none}
header .brand{font-weight:700;letter-spacing:.02em}header .right{margin-left:auto;display:flex;gap:1rem;align-items:center;font-size:.9em}
main{max-width:1000px;margin:0 auto;padding:1.2rem}h1{font-size:1.5rem;margin:.2rem 0 1rem}h2{font-size:1.1rem;margin:1.6rem 0 .6rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:1rem;margin-bottom:.8rem}
.muted{color:var(--muted);font-size:.9em}.row{display:flex;gap:1rem;flex-wrap:wrap;align-items:baseline}
.badge{display:inline-block;padding:.05rem .5rem;border-radius:999px;font-size:.75em;border:1px solid var(--line);background:#fafafa;white-space:nowrap}
.imp-5,.imp-4{border-color:var(--warn);color:var(--warn)}.cat{text-transform:uppercase;letter-spacing:.04em}
.st-ACTIVE{color:var(--ok);border-color:var(--ok)}.st-PAUSED{color:var(--muted)}
.st-ROBOTS_BLOCKED,.st-AUTH_REQUIRED,.st-RATE_LIMITED,.st-FETCH_ERROR,.st-CONTENT_UNREADABLE{color:var(--bad);border-color:var(--bad);background:#fef2f2}
form.inline{display:flex;gap:.5rem;flex-wrap:wrap;align-items:end}label{display:flex;flex-direction:column;font-size:.85em;color:var(--muted)}
input,select,textarea{font:inherit;padding:.4rem .5rem;border:1px solid var(--line);border-radius:6px;background:#fff}textarea{min-height:4rem;width:100%}
button{font:inherit;padding:.45rem .8rem;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
button.secondary{background:#fff;color:var(--fg);border-color:var(--line)}button.danger{background:#fff;color:var(--bad);border-color:#fca5a5}
button.tiny{padding:.15rem .5rem;font-size:.8em}button.active{background:#eef3ff;border-color:var(--accent);color:var(--accent)}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:.35rem .4rem;border-bottom:1px solid var(--line);vertical-align:top;font-size:.92em}
pre{background:#fafafa;border:1px solid var(--line);border-radius:6px;padding:.6rem;overflow:auto;font-size:.85em;white-space:pre-wrap}
.del{color:var(--bad)}.add{color:var(--ok)}.empty{padding:2rem;text-align:center;color:var(--muted)}
.alert{border-color:var(--bad);background:#fef2f2}.stat{display:inline-block;min-width:8rem;margin:.2rem 1rem .2rem 0}.stat b{display:block;font-size:1.4em}
.fb{display:inline-flex;gap:.3rem;flex-wrap:wrap}.fb form{display:inline}
`;

export const Layout: FC<{ title: string; children?: unknown; flash?: string | undefined; principal?: Principal | undefined }> = ({ title, children, flash, principal }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · RivalWatch</title>
      <style>{css}</style>
    </head>
    <body>
      <header>
        <a class="brand" href="/">RivalWatch</a>
        {principal ? <a href="/">Dashboard</a> : null}
        {principal ? <a href="/settings">Settings</a> : null}
        {principal?.isAdmin ? <a href="/admin">Admin</a> : null}
        <span class="right">
          {principal ? (
            <>
              <span class="muted" style="color:#bbb">
                {principal.user.email}
              </span>
              <form method="post" action="/auth/logout" style="display:inline">
                <button class="tiny secondary" type="submit">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <a href="/login">Sign in</a>
          )}
        </span>
      </header>
      <main>
        {flash ? <div class="card" style="border-color:var(--accent)">{flash}</div> : null}
        {children}
      </main>
    </body>
  </html>
);

export const LoginPage: FC<{ sent?: boolean; devLink?: string | undefined; error?: string | undefined; email?: string | undefined }> = ({ sent, devLink, error, email }) => (
  <Layout title="Sign in">
    <h1>Sign in</h1>
    {error ? <div class="card alert">{error}</div> : null}
    {sent ? (
      <div class="card">
        <p>
          If <strong>{email}</strong> is valid, a sign-in link is on its way. It expires in a few minutes.
        </p>
        <p class="muted">Not there after a minute? Check your spam folder — and mark it "not spam" so future digests arrive in your inbox.</p>
        {devLink ? (
          <p class="muted">
            Development mode (log email provider): <a href={devLink}>open the sign-in link</a>
          </p>
        ) : null}
      </div>
    ) : (
      <form method="post" action="/auth/login" class="card inline">
        <label>
          Email <input name="email" type="email" required autocomplete="email" style="min-width:18rem" />
        </label>
        <button type="submit">Email me a sign-in link</button>
        <p class="muted" style="width:100%">No password. New here? Signing in creates your account.</p>
      </form>
    )}
  </Layout>
);

const fmtDate = (iso: string | null | undefined) => (iso ? iso.replace("T", " ").slice(0, 16) + " UTC" : "—");
const fmtUsd = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(4)}`);

export const BusinessesPage: FC<{ principal: Principal; businesses: Business[]; account: Account; flash?: string | undefined }> = ({ principal, businesses, account, flash }) => (
  <Layout title="Businesses" principal={principal} flash={flash}>
    <div class="row">
      <h1>Your businesses</h1>
      <span class="badge">{getPlan(account.plan).name} plan</span>
    </div>
    {businesses.length === 0 ? <div class="card empty">Start by describing your own business below, then add competitors.</div> : null}
    {businesses.map((b) => (
      <div class="card row">
        <a href={`/b/${b.id}`}>
          <strong>{b.name}</strong>
        </a>
        <span class="muted">{b.website ?? ""}</span>
      </div>
    ))}
    <h2>Create a business</h2>
    <form method="post" action="/b" class="card">
      <div class="row">
        <label>
          Name <input name="name" required />
        </label>
        <label>
          Website <input name="website" type="url" placeholder="https://" />
        </label>
      </div>
      <label>
        What do you do? (helps the AI judge relevance)
        <textarea name="description" />
      </label>
      <label>
        Your pricing (free text, e.g. "Basic £29/month, Pro £59/month")
        <textarea name="pricing_notes" />
      </label>
      <p>
        <button type="submit">Create</button>
      </p>
    </form>
  </Layout>
);

export const StatusBadge: FC<{ page: MonitoredPage }> = ({ page }) => (
  <span class={`badge st-${page.status}`} title={page.status_message ?? ""}>
    {page.status}
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
        <h1>{business.name}</h1>
        <span class="badge">{plan.name} plan</span>
        <span class="muted">
          {competitors.length}/{plan.max_competitors} competitors
        </span>
        <form method="post" action={`/b/${business.id}/scan`} style="margin-left:auto">
          <button type="submit">Scan all now</button>
        </form>
      </div>
      {business.description ? <p class="muted">{business.description}</p> : null}
      {unhealthy.length ? (
        <div class="card alert">
          <strong>Monitoring problems:</strong> {unhealthy.length} page{unhealthy.length === 1 ? " is" : "s are"} not being monitored successfully. We do not treat these as healthy — see the status column below.
        </div>
      ) : null}

      <h2>Insights</h2>
      <p class="muted">
        {includeNoise ? <a href={`/b/${business.id}`}>Hide filtered-out changes</a> : <a href={`/b/${business.id}?noise=1`}>Show filtered-out changes too</a>}
        {" · "}Weekly digest: {business.digest_enabled ? `on (next ${fmtDate(business.next_digest_at)})` : "off"}{" "}
        <form method="post" action={`/b/${business.id}/digest`} style="display:inline">
          <input type="hidden" name="enabled" value={business.digest_enabled ? "0" : "1"} />
          <button class="tiny secondary" type="submit">
            {business.digest_enabled ? "turn off" : "turn on"}
          </button>
        </form>{" "}
        <form method="post" action={`/b/${business.id}/digest/send`} style="display:inline">
          <button class="tiny secondary" type="submit">
            send digest now
          </button>
        </form>
      </p>
      {insights.length === 0 ? <div class="card empty">Nothing yet. Add competitors and let the monitor run. Detected changes are confirmed on a follow-up fetch before you see them, to filter out A/B tests and glitches.</div> : null}
      {insights.map((i) => <InsightCard insight={i} competitorName={competitorNames[i.competitor_id] ?? "Competitor"} feedback={feedback[i.id] ?? []} />)}

      <h2>Competitors</h2>
      {competitors.map(({ competitor, pages, suggestions }) => (
        <div class="card">
          <div class="row">
            <strong>{competitor.name}</strong>
            <a class="muted" href={competitor.website} target="_blank" rel="noopener">
              {competitor.website}
            </a>
            <form method="post" action={`/competitors/${competitor.id}/discover`} style="margin-left:auto;display:inline">
              <button class="secondary tiny" type="submit">
                Find pages
              </button>
            </form>
            <form method="post" action={`/competitors/${competitor.id}/delete`} style="display:inline" onsubmit="return confirm('Remove competitor and all its data?')">
              <button class="danger tiny" type="submit">
                Remove
              </button>
            </form>
          </div>
          <table>
            <thead>
              <tr>
                <th>Page</th>
                <th>Kind</th>
                <th>Every</th>
                <th>Last checked</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr>
                  <td>
                    <a href={`/pages/${p.id}`}>{p.url}</a>
                    {p.status_message && p.status !== "ACTIVE" ? <div class="muted">{p.status_message}</div> : null}
                  </td>
                  <td>{p.kind}</td>
                  <td>{humanMinutes(p.check_interval_minutes)}</td>
                  <td class="muted">{fmtDate(p.last_checked_at)}</td>
                  <td>
                    <StatusBadge page={p} />
                  </td>
                  <td style="white-space:nowrap">
                    <form method="post" action={`/pages/${p.id}/scan`} style="display:inline">
                      <button class="secondary tiny" type="submit" disabled={!p.enabled}>
                        Scan
                      </button>
                    </form>{" "}
                    <form method="post" action={`/pages/${p.id}/${p.enabled ? "pause" : "resume"}`} style="display:inline">
                      <button class="secondary tiny" type="submit">
                        {p.enabled ? "Pause" : "Resume"}
                      </button>
                    </form>{" "}
                    <form method="post" action={`/pages/${p.id}/delete`} style="display:inline">
                      <button class="danger tiny" type="submit">
                        ×
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {suggestions.length ? (
            <div style="margin-top:.6rem">
              <div class="muted">Suggested pages to monitor (found on their site):</div>
              <table>
                <tbody>
                  {suggestions.map((s) => (
                    <tr>
                      <td>{s.url}</td>
                      <td>
                        <span class="badge">{s.kind}</span>
                      </td>
                      <td class="muted">{s.reason}</td>
                      <td style="white-space:nowrap">
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
          <form method="post" action={`/competitors/${competitor.id}/pages`} class="inline" style="margin-top:.6rem">
            <label>
              Add page URL <input name="url" type="url" required placeholder="https://competitor.com/pricing" style="min-width:20rem" />
            </label>
            <label>
              Kind
              <select name="kind">
                <option value="pricing">pricing</option>
                <option value="home">home</option>
                <option value="products">products</option>
                <option value="blog">blog</option>
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
          Name <input name="name" required />
        </label>
        <label>
          Website <input name="website" type="url" required placeholder="https://" style="min-width:18rem" />
        </label>
        <button type="submit">Add competitor</button>
        <p class="muted" style="width:100%">We monitor the home page immediately and suggest pricing/products/blog pages for you to confirm.</p>
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
    <div class="card">
      <div class="row">
        <span class={`badge cat imp-${insight.importance}`}>{insight.category}</span>
        <span class="badge">importance {insight.importance}/5</span>
        {insight.matters ? null : <span class="badge">filtered out</span>}
        <span class="muted">
          {competitorName} · {fmtDate(insight.created_at)} · {insight.provider}
          {insight.model ? ` (${insight.model})` : ""}
        </span>
      </div>
      <p style="margin:.5rem 0 .2rem">
        <a href={`/insights/${insight.id}`}>
          <strong>{insight.headline}</strong>
        </a>
      </p>
      <p style="margin:.2rem 0">{insight.summary}</p>
      <p style="margin:.2rem 0" class="muted">
        <strong>Why this matters:</strong> {insight.why_it_matters}
      </p>
      <div class="fb" style="margin-top:.4rem">
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
      <p class="muted">
        <a href={`/b/${business.id}`}>← {business.name}</a>
      </p>
      <InsightCard insight={insight} competitorName={competitor.name} feedback={feedback} />
      <h2>Evidence</h2>
      <p class="muted">
        <a href={page.url} target="_blank" rel="noopener">
          {page.url}
        </a>{" "}
        · detected {fmtDate(change.detected_at)} · confirmed {fmtDate(change.confirmed_at)} · significance {change.significance} · signals {JSON.parse(change.signals_json).join(", ") || "none"} · tokens{" "}
        {insight.input_tokens ?? 0}/{insight.output_tokens ?? 0} · est. cost {fmtUsd(insight.estimated_cost_usd)}
      </p>
      <pre>
        {removed.map((l) => (
          <div class="del">- {l}</div>
        ))}
        {added.map((l) => (
          <div class="add">+ {l}</div>
        ))}
      </pre>
      <form method="post" action={`/insights/${insight.id}/reanalyze`}>
        <button class="secondary" type="submit">
          Re-analyse
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
    <p class="muted">
      <a href={`/b/${competitor.business_id}`}>← back</a>
    </p>
    <h1>{page.url}</h1>
    <p class="row">
      <StatusBadge page={page} />
      <span class="muted">
        {competitor.name} · kind {page.kind} · every {humanMinutes(page.check_interval_minutes)} · next check {fmtDate(page.next_check_at)} · consecutive failures {page.consecutive_failures} · status since {fmtDate(page.status_since)}
      </span>
    </p>
    {page.status_message ? <p class="muted">{page.status_message}</p> : null}
    <h2>Snapshots ({snapshots.length})</h2>
    <table>
      <thead>
        <tr>
          <th>Fetched</th>
          <th>Last seen</th>
          <th>HTTP</th>
          <th>Title</th>
          <th>Hash</th>
        </tr>
      </thead>
      <tbody>
        {snapshots.map((s) => (
          <tr>
            <td>{fmtDate(s.fetched_at)}</td>
            <td>{fmtDate(s.last_seen_at)}</td>
            <td>{s.http_status}</td>
            <td>{s.title}</td>
            <td class="muted">{s.content_hash.slice(0, 12)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <h2>Changes ({changes.length})</h2>
    <table>
      <tbody>
        {changes.map((c) => (
          <tr>
            <td>{fmtDate(c.detected_at)}</td>
            <td>significance {c.significance}</td>
            <td>{JSON.parse(c.signals_json).join(", ")}</td>
            <td>
              <span class="badge">{c.analysis_status}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    <h2>Latest extracted text</h2>
    <pre>{latestText ?? "(no snapshot yet)"}</pre>
  </Layout>
);

export const SettingsPage: FC<{ principal: Principal; account: Account; users: User[]; keys: ApiKey[]; newKey?: string | undefined; flash?: string | undefined }> = ({ principal, account, users, keys, newKey, flash }) => (
  <Layout title="Settings" principal={principal} flash={flash}>
    <h1>Settings</h1>
    <div class="card">
      <div class="row">
        <strong>{account.name}</strong>
        <span class="badge">{getPlan(account.plan).name} plan</span>
        <span class="muted">account #{account.id} · created {fmtDate(account.created_at)}</span>
      </div>
      <p class="muted">Members: {users.map((u) => u.email).join(", ")}</p>
    </div>
    <h2>API keys</h2>
    <p class="muted">For scripts and agents. Send as <code>Authorization: Bearer rw_…</code>. Actions are attributed to <code>agent:&lt;name&gt;</code> in the audit log.</p>
    {newKey ? (
      <div class="card" style="border-color:var(--ok)">
        <strong>New key (shown once):</strong> <code>{newKey}</code>
      </div>
    ) : null}
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
            <td class="muted">{fmtDate(k.created_at)}</td>
            <td class="muted">{fmtDate(k.last_used_at)}</td>
            <td>
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
    <form method="post" action="/settings/api-keys" class="inline" style="margin-top:.6rem">
      <label>
        Key name <input name="name" required pattern="[A-Za-z0-9._-]{1,64}" placeholder="support-agent" />
      </label>
      <button class="secondary" type="submit">
        Create API key
      </button>
    </form>
  </Layout>
);

export type ApprovalView = Approval & { summary: string };

export interface AdminOverview {
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
    <div class={`card${o.pendingApprovals.length ? " alert" : ""}`} style={o.pendingApprovals.length ? "" : "border-color:var(--ok)"}>
      <h2 style="margin-top:0">Needs your attention ({o.pendingApprovals.length})</h2>
      {o.pendingApprovals.length === 0 ? <p class="muted" style="margin:0">No pending approvals. Agents and admins request consequential actions here; nothing runs until you decide.</p> : null}
      {o.pendingApprovals.map((a) => (
        <div class="card" style="margin:.5rem 0">
          <div class="row">
            <span class={`badge ${a.risk_level === "high" ? "imp-5" : ""}`}>{a.risk_level} risk</span>
            <strong>{a.summary}</strong>
            <span class="muted">
              #{a.id} · {a.action} · requested by {a.requested_by} · {fmtDate(a.created_at)} · expires {fmtDate(a.expires_at)}
            </span>
          </div>
          {a.reason ? <p style="margin:.3rem 0">Reason: {a.reason}</p> : null}
          <details>
            <summary class="muted">payload</summary>
            <pre>{a.payload}</pre>
          </details>
          <div class="row" style="margin-top:.4rem">
            <form method="post" action={`/admin/approvals/${a.id}/approve`} class="inline">
              <input name="note" placeholder="note (optional)" style="min-width:16rem" />
              <button type="submit">Approve &amp; execute</button>
            </form>
            <form method="post" action={`/admin/approvals/${a.id}/deny`} class="inline">
              <input name="note" placeholder="why not? (optional)" style="min-width:16rem" />
              <button class="danger" type="submit">
                Deny
              </button>
            </form>
          </div>
        </div>
      ))}
      {o.recentApprovals.length ? (
        <details style="margin-top:.5rem">
          <summary class="muted">Recent decisions ({o.recentApprovals.length})</summary>
          <table>
            <tbody>
              {o.recentApprovals.map((a) => (
                <tr>
                  <td class="muted">{fmtDate(a.decided_at ?? a.created_at)}</td>
                  <td>
                    <span class="badge">{a.status}</span>
                  </td>
                  <td>{a.summary}</td>
                  <td class="muted">
                    by {a.decided_by ?? "—"} · requested by {a.requested_by}
                  </td>
                  <td class="muted">{a.status === "failed" ? a.result : a.decision_note}</td>
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
        <span class={`badge ${o.agents.enabled ? "st-ACTIVE" : ""}`}>{o.agents.enabled ? "enabled" : "disabled (AGENTS_ENABLED=false or no Anthropic provider)"}</span>
        <span class="muted">agent spend 24h {fmtUsd(o.agents.cost24h)}</span>
      </div>
      <table>
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
                <div class="muted">{a.description}</div>
              </td>
              <td>{a.interval_hours}h</td>
              <td class="muted">
                {fmtDate(a.last_run_at)} {a.last_status ? <span class="badge">{a.last_status}</span> : null}
              </td>
              <td class="muted">{a.enabled ? fmtDate(a.next_run_at) : "—"}</td>
              <td>{a.enabled ? <span class="badge st-ACTIVE">on</span> : <span class="badge st-PAUSED">off</span>}</td>
              <td style="white-space:nowrap">
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
          <h3 style="margin:1rem 0 .3rem">Agent notes</h3>
          {o.agents.notes.map((n) => (
            <details class="card" style={n.read_at ? "opacity:.75" : "border-color:var(--accent)"}>
              <summary>
                <span class="badge">{n.kind}</span> <strong>{n.title}</strong> <span class="muted">· {n.agent} · {fmtDate(n.created_at)}</span>
              </summary>
              <pre style="white-space:pre-wrap">{n.body}</pre>
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
        <p class="muted" style="margin:.6rem 0 0">No agent notes yet.</p>
      )}
      {o.agents.runs.length ? (
        <details style="margin-top:.5rem">
          <summary class="muted">Recent runs ({o.agents.runs.length})</summary>
          <table>
            <tbody>
              {o.agents.runs.map((r) => (
                <tr>
                  <td class="muted">{fmtDate(r.started_at)}</td>
                  <td>{r.agent}</td>
                  <td>
                    <span class="badge">{r.status}</span>
                  </td>
                  <td class="muted">
                    {r.turns} turns · {r.tool_calls} tools · {fmtUsd(r.estimated_cost_usd)}
                  </td>
                  <td>{r.summary ?? r.error}</td>
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
          <span class="muted">{k}</span>
        </span>
      ))}
    </div>
    <div class="row">
      <div class="card" style="flex:1;min-width:18rem">
        <h2 style="margin-top:0">Fetch health (24h)</h2>
        <span class="stat">
          <b>{o.fetch24h.fetched}</b>
          <span class="muted">fetched</span>
        </span>
        <span class="stat">
          <b style={o.fetch24h.failed ? "color:var(--bad)" : ""}>{o.fetch24h.failed}</b>
          <span class="muted">failed</span>
        </span>
        <div>
          {Object.entries(o.pagesByStatus).map(([s, n]) => (
            <span class={`badge st-${s}`} style="margin:.2rem .2rem 0 0">
              {s}: {n}
            </span>
          ))}
        </div>
      </div>
      <div class="card" style="flex:1;min-width:18rem">
        <h2 style="margin-top:0">Insights</h2>
        <span class="stat">
          <b>{o.insights.d1}</b>
          <span class="muted">24h</span>
        </span>
        <span class="stat">
          <b>{o.insights.d7}</b>
          <span class="muted">7d</span>
        </span>
        <span class="stat">
          <b>{o.insights.d30}</b>
          <span class="muted">30d</span>
        </span>
        <div class="muted">
          Feedback: {Object.entries(o.feedback).map(([k, v]) => `${k} ${v}`).join(" · ") || "none yet"}
        </div>
      </div>
      <div class="card" style="flex:1;min-width:18rem">
        <h2 style="margin-top:0">LLM</h2>
        <span class="stat">
          <b>{o.ai.calls24h}</b>
          <span class="muted">calls 24h (cap {o.ai.callCap || "∞"})</span>
        </span>
        <span class="stat">
          <b>{fmtUsd(o.ai.cost24h)}</b>
          <span class="muted">est. cost 24h (cap ${o.ai.costCapUsd || "∞"})</span>
        </span>
        <span class="stat">
          <b>{fmtUsd(o.ai.cost7d)}</b>
          <span class="muted">7d</span>
        </span>
        <span class="stat">
          <b>{fmtUsd(o.ai.cost30d)}</b>
          <span class="muted">30d</span>
        </span>
        <div class="muted">
          provider {o.ai.provider} · model {o.ai.model} · cap hit {o.ai.capReached24h}× in 24h
        </div>
      </div>
    </div>

    <h2>Unhealthy pages ({o.unhealthyPages.length})</h2>
    {o.unhealthyPages.length === 0 ? <p class="muted">All monitored pages are ACTIVE.</p> : null}
    <table>
      <tbody>
        {o.unhealthyPages.map((p) => (
          <tr>
            <td>
              <StatusBadge page={p} />
            </td>
            <td>{p.url}</td>
            <td class="muted">{p.status_message}</td>
            <td class="muted">since {fmtDate(p.status_since)} · account #{p.account_id}</td>
          </tr>
        ))}
      </tbody>
    </table>

    <h2>Users ({o.users.length})</h2>
    <p class="muted">Changing a plan is a tier-3 (human) action; it is recorded with you as approver. Billing will drive this automatically later.</p>
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
              {u.account_name} <span class="muted">#{u.account_id}</span>
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
            <td class="muted">{fmtDate(u.created_at)}</td>
            <td class="muted">{fmtDate(u.last_login_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>

    <h2>Recent errors / failed events ({o.errors.length})</h2>
    <EventsTable events={o.errors} />

    <h2>Recent emails</h2>
    <table>
      <tbody>
        {o.emails.map((e) => (
          <tr>
            <td class="muted">{fmtDate(e.created_at)}</td>
            <td>{e.kind}</td>
            <td>{e.to_address}</td>
            <td>
              <span class="badge">{e.status}</span> {e.provider}
            </td>
            <td class="muted">{e.error}</td>
          </tr>
        ))}
      </tbody>
    </table>

    <h2>Recent events</h2>
    <p class="muted">
      Scheduler: {JSON.stringify(o.scheduler)} · JSON at <a href="/api/admin/overview">/api/admin/overview</a> and <a href="/api/admin/events">/api/admin/events</a>
    </p>
    <EventsTable events={o.recent} />
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
          <td class="muted" style="white-space:nowrap">
            {fmtDate(e.ts)}
          </td>
          <td>{e.type}</td>
          <td>{e.actor}</td>
          <td>
            {e.entity_type ? `${e.entity_type}#${e.entity_id}` : ""}
            {e.account_id ? <span class="muted"> a{e.account_id}</span> : null}
          </td>
          <td>{e.risk_level}</td>
          <td style={e.result === "failed" ? "color:var(--bad)" : ""}>{e.result}</td>
          <td class="muted">{e.estimated_cost_usd != null ? fmtUsd(e.estimated_cost_usd) : ""}</td>
          <td>
            <code style="font-size:.8em">{e.payload}</code>
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
