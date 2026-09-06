import type { Config } from "./config.js";
import type { Business, Insight, NewsItem, Repo } from "./db/repo.js";
import type { Events } from "./events.js";
import { isLocale, translator, type Translate } from "./i18n/index.js";
import { errorFields, log } from "./logger.js";
import type { Mailer } from "./mail/index.js";

/** Next occurrence of the configured weekday/hour (UTC), strictly after `from`. */
export function nextDigestTime(from: Date, weekday: number, hourUtc: number): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hourUtc, 0, 0, 0));
  const isoDay = ((from.getUTCDay() + 6) % 7) + 1; // 1=Mon..7=Sun
  let delta = (weekday - isoDay + 7) % 7;
  if (delta === 0 && d <= from) delta = 7;
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

export interface DigestContent {
  subject: string;
  text: string;
  html: string;
  insightCount: number;
}

export function buildDigest(business: Business, insights: Insight[], competitorNames: Record<number, string>, publicUrl: string, pageHealth: { url: string; status: string }[], t: Translate = translator("en"), bigNews: NewsItem[] = []): DigestContent {
  const sorted = [...insights].sort((a, b) => b.importance - a.importance || b.created_at.localeCompare(a.created_at));
  const top = sorted.slice(0, 10);
  const lines: string[] = [];
  const html: string[] = [];
  const title = t("digest.title", { business: business.name });
  lines.push(title, "");
  html.push(`<h2 style="margin:0 0 .5rem">${esc(title)}</h2>`);
  if (top.length === 0) {
    lines.push(t("digest.none"));
    html.push(`<p>${esc(t("digest.none"))}</p>`);
  } else {
    lines.push(t("digest.count", { n: insights.length }), "");
    html.push(`<p>${esc(t("digest.count", { n: insights.length }))}</p>`);
    for (const i of top) {
      const who = competitorNames[i.competitor_id] ?? "Competitor";
      lines.push(`[${i.category.toUpperCase()} ${i.importance}/5] ${i.headline}`, `  ${i.summary}`, `  ${t("digest.why")} ${i.why_it_matters}`, `  ${publicUrl}/insights/${i.id}`, "");
      html.push(
        `<div style="border:1px solid #e3e3df;border-radius:8px;padding:.8rem;margin:.6rem 0">
           <div style="font-size:.8em;color:#666">${esc(who)} · ${esc(i.category)} · ${esc(t("ins.importance", { n: i.importance }))}</div>
           <p style="margin:.3rem 0"><a href="${publicUrl}/insights/${i.id}"><strong>${esc(i.headline)}</strong></a></p>
           <p style="margin:.3rem 0">${esc(i.summary)}</p>
           <p style="margin:.3rem 0;color:#444"><strong>${esc(t("digest.why"))}</strong> ${esc(i.why_it_matters)}</p>
         </div>`,
      );
    }
  }
  if (bigNews.length) {
    lines.push(t("digest.news"), "");
    html.push(`<h3 style="margin:1rem 0 .3rem">${esc(t("digest.news"))}</h3>`);
    for (const n of bigNews) {
      const who = competitorNames[n.competitor_id] ?? "";
      lines.push(`[${(n.category ?? "news").toUpperCase()} ${n.magnitude}/5] ${who}: ${n.title}`, `  ${n.summary ?? ""}`, `  ${t("digest.why")} ${n.why_it_matters ?? ""}`, `  ${n.url}`, "");
      html.push(`<div style="border:1px solid #fcd34d;border-radius:8px;padding:.8rem;margin:.6rem 0"><div style="font-size:.8em;color:#666">${esc(who)} · ${esc(n.category ?? "")} · ${n.magnitude}/5 · ${esc(n.source ?? "")}</div><p style="margin:.3rem 0"><a href="${n.url}"><strong>${esc(n.title)}</strong></a></p><p style="margin:.3rem 0">${esc(n.summary ?? "")}</p><p style="margin:.3rem 0;color:#444"><strong>${esc(t("digest.why"))}</strong> ${esc(n.why_it_matters ?? "")}</p></div>`);
    }
  }
  const unhealthy = pageHealth.filter((p) => p.status !== "ACTIVE");
  if (unhealthy.length) {
    lines.push(`${t("digest.problems")}: ${t("digest.problems.p")}`);
    html.push(`<h3 style="margin:1rem 0 .3rem">${esc(t("digest.problems"))}</h3><p style="color:#b45309">${esc(t("digest.problems.p"))}</p><ul>`);
    for (const p of unhealthy) {
      lines.push(`  ${p.status}: ${p.url}`);
      html.push(`<li><code>${esc(p.status)}</code> ${esc(p.url)}</li>`);
    }
    html.push("</ul>");
    lines.push("");
  }
  lines.push(`${t("digest.manage")}: ${publicUrl}/b/${business.id}`);
  html.push(`<p style="font-size:.85em;color:#666"><a href="${publicUrl}/b/${business.id}">${esc(t("digest.manage"))}</a></p>`);
  return {
    subject: top.length ? t("digest.subject.some", { n: insights.length, business: business.name }) : t("digest.subject.quiet", { business: business.name }),
    text: lines.join("\n"),
    html: `<div style="font:15px/1.5 system-ui,sans-serif;max-width:640px">${html.join("")}</div>`,
    insightCount: insights.length,
  };
}

export class DigestJob {
  constructor(
    private readonly cfg: Config,
    private readonly repo: Repo,
    private readonly events: Events,
    private readonly mailer: Mailer,
  ) {}

  scheduleIfUnset(business: Business): void {
    if (!business.next_digest_at) this.repo.setDigestSchedule(business.id, nextDigestTime(new Date(), this.cfg.DIGEST_WEEKDAY, this.cfg.DIGEST_HOUR_UTC).toISOString(), false);
  }

  /** Sends due digests. Returns the number sent. */
  async runDue(now = new Date()): Promise<number> {
    let sent = 0;
    for (const business of this.repo.businessesDueForDigest(now.toISOString())) {
      try {
        const result = await this.sendFor(business, "system", true);
        if (result.sent) sent++;
      } catch (err) {
        log.error("digest failed", { business_id: business.id, ...errorFields(err) });
        this.events.record({ type: "digest.sent", accountId: business.account_id, entity: { type: "business", id: business.id }, result: "failed", payload: errorFields(err) });
        this.repo.setDigestSchedule(business.id, nextDigestTime(now, this.cfg.DIGEST_WEEKDAY, this.cfg.DIGEST_HOUR_UTC).toISOString(), false);
      }
    }
    return sent;
  }

  /** Composes and sends the digest for one business to every user on the account. */
  async sendFor(business: Business, actor: string, reschedule: boolean, force = false): Promise<{ sent: boolean; insightCount: number; recipients: number }> {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const insights = this.repo.listInsights(business.account_id, business.id, { since, limit: 200 });
    const competitors = this.repo.listCompetitors(business.account_id, business.id);
    const names = Object.fromEntries(competitors.map((c) => [c.id, c.name]));
    const pageHealth = competitors.flatMap((c) => this.repo.listPages(business.account_id, c.id)).map((p) => ({ url: p.url, status: p.status }));
    // Only verified addresses receive digests: an unverified password sign-up could be a typo pointing at a stranger.
    const users = this.repo.listUsers(business.account_id).filter((u) => u.email_verified_at);
    const next = nextDigestTime(new Date(), this.cfg.DIGEST_WEEKDAY, this.cfg.DIGEST_HOUR_UTC).toISOString();

    const bigNews = this.repo.bigNews(business.account_id, business.id, { since });
    const anyProblem = pageHealth.some((p) => p.status !== "ACTIVE");
    if (!force && insights.length === 0 && !anyProblem && bigNews.length === 0) {
      this.events.record({ type: "digest.skipped", actor, accountId: business.account_id, entity: { type: "business", id: business.id }, result: "skipped", payload: { reason: "nothing_to_report" } });
      if (reschedule) this.repo.setDigestSchedule(business.id, next, false);
      return { sent: false, insightCount: 0, recipients: 0 };
    }

    let ok = 0;
    let insightCount = 0;
    for (const u of users) {
      // Each recipient gets the digest in their own language.
      const digest = buildDigest(business, insights, names, this.cfg.publicUrl, pageHealth, translator(isLocale(u.locale) ? u.locale : "en"), bigNews);
      insightCount = digest.insightCount;
      const r = await this.mailer.send({ to: u.email, subject: digest.subject, text: digest.text, html: digest.html, kind: "weekly_digest", accountId: business.account_id }, actor);
      if (r.ok) ok++;
    }
    this.events.record({
      type: "digest.sent",
      actor,
      accountId: business.account_id,
      entity: { type: "business", id: business.id },
      result: ok > 0 ? "ok" : "failed",
      payload: { insights: insightCount, recipients: users.length, delivered: ok, provider: this.mailer.providerName },
    });
    if (reschedule) this.repo.setDigestSchedule(business.id, next, ok > 0);
    return { sent: ok > 0, insightCount, recipients: ok };
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
