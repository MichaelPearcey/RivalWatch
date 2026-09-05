import type { FC } from "hono/jsx";
import type { Business, Change, Competitor, Insight, MonitoredPage, Snapshot } from "../db/repo.js";
import type { EventRow } from "../events.js";
import { getPlan } from "../plans.js";

const css = `
:root{--bg:#f7f7f5;--fg:#1c1c1c;--muted:#666;--card:#fff;--line:#e3e3df;--accent:#0b5fff;--warn:#b45309;--ok:#15803d}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
header{background:#111;color:#fff;padding:.6rem 1.2rem;display:flex;gap:1.5rem;align-items:center}header a{color:#fff;text-decoration:none}
header .brand{font-weight:700;letter-spacing:.02em}main{max-width:1000px;margin:0 auto;padding:1.2rem}
h1{font-size:1.5rem;margin:.2rem 0 1rem}h2{font-size:1.1rem;margin:1.6rem 0 .6rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:1rem;margin-bottom:.8rem}
.muted{color:var(--muted);font-size:.9em}.row{display:flex;gap:1rem;flex-wrap:wrap;align-items:baseline}
.badge{display:inline-block;padding:.05rem .5rem;border-radius:999px;font-size:.75em;border:1px solid var(--line);background:#fafafa}
.imp-5,.imp-4{border-color:var(--warn);color:var(--warn)}.cat{text-transform:uppercase;letter-spacing:.04em}
form.inline{display:flex;gap:.5rem;flex-wrap:wrap;align-items:end}label{display:flex;flex-direction:column;font-size:.85em;color:var(--muted)}
input,select,textarea{font:inherit;padding:.4rem .5rem;border:1px solid var(--line);border-radius:6px;background:#fff}textarea{min-height:4rem;width:100%}
button{font:inherit;padding:.45rem .8rem;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
button.secondary{background:#fff;color:var(--fg);border-color:var(--line)}button.danger{background:#fff;color:#b91c1c;border-color:#fca5a5}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:.35rem .4rem;border-bottom:1px solid var(--line);vertical-align:top;font-size:.92em}
pre{background:#fafafa;border:1px solid var(--line);border-radius:6px;padding:.6rem;overflow:auto;font-size:.85em;white-space:pre-wrap}
.del{color:#b91c1c}.add{color:var(--ok)}.status-ok{color:var(--ok)}.status-error,.status-blocked{color:#b91c1c}
.empty{padding:2rem;text-align:center;color:var(--muted)}
`;

export const Layout: FC<{ title: string; children?: unknown; flash?: string | undefined }> = ({ title, children, flash }) => (
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
        <a href="/">Businesses</a>
        <a href="/events">Events</a>
        <a href="/api/stats">Stats (JSON)</a>
        <a href="/health">Health</a>
      </header>
      <main>
        {flash ? <div class="card" style="border-color:var(--accent)">{flash}</div> : null}
        {children}
      </main>
    </body>
  </html>
);

export const BusinessesPage: FC<{ businesses: Business[] }> = ({ businesses }) => (
  <Layout title="Businesses">
    <h1>Your businesses</h1>
    {businesses.length === 0 ? <div class="card empty">No business yet. Create one below.</div> : null}
    {businesses.map((b) => (
      <div class="card row">
        <a href={`/b/${b.id}`}>
          <strong>{b.name}</strong>
        </a>
        <span class="muted">{b.website ?? ""}</span>
        <span class="badge">{getPlan(b.plan).name}</span>
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
        <label>
          Plan
          <select name="plan">
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="plus">Plus</option>
          </select>
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

const fmtDate = (iso: string | null) => (iso ? iso.replace("T", " ").slice(0, 16) + " UTC" : "—");

export const BusinessPage: FC<{
  business: Business;
  competitors: { competitor: Competitor; pages: MonitoredPage[] }[];
  insights: Insight[];
  competitorNames: Record<number, string>;
  includeNoise: boolean;
  flash?: string | undefined;
}> = ({ business, competitors, insights, competitorNames, includeNoise, flash }) => {
  const plan = getPlan(business.plan);
  return (
    <Layout title={business.name} flash={flash}>
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

      <h2>Insights</h2>
      <p class="muted">
        {includeNoise ? <a href={`/b/${business.id}`}>Hide filtered-out changes</a> : <a href={`/b/${business.id}?noise=1`}>Show filtered-out changes too</a>}
      </p>
      {insights.length === 0 ? (
        <div class="card empty">
          Nothing yet. Add competitors, then scan at least twice — the first scan takes a baseline, later scans detect changes.
        </div>
      ) : null}
      {insights.map((i) => <InsightCard insight={i} competitorName={competitorNames[i.competitor_id] ?? "Competitor"} />)}

      <h2>Competitors</h2>
      {competitors.map(({ competitor, pages }) => (
        <div class="card">
          <div class="row">
            <strong>{competitor.name}</strong>
            <a class="muted" href={competitor.website} target="_blank" rel="noopener">
              {competitor.website}
            </a>
            <form method="post" action={`/competitors/${competitor.id}/delete`} style="margin-left:auto" onsubmit="return confirm('Remove competitor and all its data?')">
              <button class="danger" type="submit">
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
                  </td>
                  <td>{p.kind}</td>
                  <td>{humanMinutes(p.check_interval_minutes)}</td>
                  <td class="muted">{fmtDate(p.last_checked_at)}</td>
                  <td class={`status-${p.last_status ?? ""}`}>{p.last_status ?? "never"}</td>
                  <td>
                    <form method="post" action={`/pages/${p.id}/scan`} style="display:inline">
                      <button class="secondary" type="submit">
                        Scan
                      </button>
                    </form>{" "}
                    <form method="post" action={`/pages/${p.id}/delete`} style="display:inline">
                      <button class="danger" type="submit">
                        ×
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
        <label>
          Pricing page (optional) <input name="pricing_url" type="url" placeholder="https://…/pricing" style="min-width:18rem" />
        </label>
        <button type="submit">Add competitor</button>
      </form>
    </Layout>
  );
};

export const InsightCard: FC<{ insight: Insight; competitorName: string }> = ({ insight, competitorName }) => (
  <div class="card">
    <div class="row">
      <span class={`badge cat imp-${insight.importance}`}>{insight.category}</span>
      <span class="badge">importance {insight.importance}/5</span>
      {insight.matters ? null : <span class="badge">filtered out</span>}
      <span class="muted">
        {competitorName} · {fmtDate(insight.created_at)} · {insight.provider}
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
  </div>
);

export const InsightDetailPage: FC<{ insight: Insight; change: Change; page: MonitoredPage; competitor: Competitor; business: Business }> = ({
  insight,
  change,
  page,
  competitor,
  business,
}) => {
  const added = JSON.parse(change.added_json) as string[];
  const removed = JSON.parse(change.removed_json) as string[];
  return (
    <Layout title={insight.headline}>
      <p class="muted">
        <a href={`/b/${business.id}`}>← {business.name}</a>
      </p>
      <InsightCard insight={insight} competitorName={competitor.name} />
      <h2>Evidence</h2>
      <p class="muted">
        <a href={page.url} target="_blank" rel="noopener">
          {page.url}
        </a>{" "}
        · detected {fmtDate(change.detected_at)} · significance {change.significance} · signals {JSON.parse(change.signals_json).join(", ") || "none"}
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

export const PageDetailPage: FC<{ page: MonitoredPage; competitor: Competitor; snapshots: Omit<Snapshot, "raw_gzip" | "text">[]; changes: Change[]; latestText: string | null }> = ({
  page,
  competitor,
  snapshots,
  changes,
  latestText,
}) => (
  <Layout title={page.url}>
    <p class="muted">
      <a href={`/b/${competitor.business_id}`}>← back</a>
    </p>
    <h1>{page.url}</h1>
    <p class="muted">
      {competitor.name} · kind {page.kind} · every {humanMinutes(page.check_interval_minutes)} · next check {fmtDate(page.next_check_at)} · failures {page.consecutive_failures}
    </p>
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
            <td>{c.analysis_status}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <h2>Latest extracted text</h2>
    <pre>{latestText ?? "(no snapshot yet)"}</pre>
  </Layout>
);

export const EventsPage: FC<{ events: EventRow[]; counts: Record<string, number> }> = ({ events, counts }) => (
  <Layout title="Events">
    <h1>Events</h1>
    <p class="muted">Structured event log — the same data agents and the future owner dashboard read via /api/events.</p>
    <div class="card row">
      {Object.entries(counts)
        .sort()
        .map(([t, c]) => (
          <span class="badge">
            {t}: {c}
          </span>
        ))}
      {Object.keys(counts).length === 0 ? <span class="muted">No events in the last 24h.</span> : null}
    </div>
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Type</th>
          <th>Actor</th>
          <th>Entity</th>
          <th>Payload</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <tr>
            <td class="muted">{fmtDate(e.ts)}</td>
            <td>{e.type}</td>
            <td>{e.actor}</td>
            <td>{e.entity_type ? `${e.entity_type}#${e.entity_id}` : ""}</td>
            <td>
              <code style="font-size:.8em">{e.payload}</code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </Layout>
);

function humanMinutes(m: number): string {
  if (m % 1440 === 0) return `${m / 1440}d`;
  if (m % 60 === 0) return `${m / 60}h`;
  return `${m}m`;
}
