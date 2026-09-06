import { createHash } from "node:crypto";
import type { App } from "../app.js";
import type { Competitor, NewsItem } from "../db/repo.js";
import { LANGUAGE_NAMES, isLocale, translator, type Locale } from "../i18n/index.js";
import { errorFields, log } from "../logger.js";
import { getPlan } from "../plans.js";
import { BIG_MAGNITUDE, classifyHeadlines } from "./classify.js";
import type { NewsSource } from "./source.js";

export interface NewsRefreshResult {
  fetched: number;
  added: number;
  big: NewsItem[];
  provider: string;
  error?: string;
}

/**
 * Fetches recent headlines for a competitor, stores the new ones, classifies
 * them (LLM with heuristic fallback) and alerts on big items. One search per
 * competitor per NEWS_INTERVAL_HOURS; cost ≈ one small LLM call per batch.
 */
export class NewsMonitor {
  constructor(
    private readonly app: App,
    private readonly source: NewsSource,
  ) {}

  private query(c: Competitor): string {
    if (c.news_query) return c.news_query;
    // Quoted name; add the bare domain as an alternative when the name is short/generic.
    const domain = safeHost(c.website);
    return c.name.length <= 5 && domain ? `"${c.name}" OR "${domain}"` : `"${c.name}"`;
  }

  async refresh(competitorId: number, actor = "system"): Promise<NewsRefreshResult> {
    const { repo, events, llm } = this.app;
    const c = repo.getCompetitorAny(competitorId);
    if (!c) return { fetched: 0, added: 0, big: [], provider: "none", error: "competitor not found" };
    const business = repo.getBusiness(c.account_id, c.business_id);
    const owner = repo.listUsers(c.account_id).find((u) => u.role === "owner");
    const locale: Locale = isLocale(owner?.locale) ? owner!.locale : "en";
    const next = new Date(Date.now() + this.app.cfg.NEWS_INTERVAL_HOURS * 3_600_000).toISOString();

    let headlines;
    try {
      headlines = await this.source.search(this.query(c), { locale, limit: 25 });
    } catch (err) {
      repo.markNewsChecked(c.id, next);
      events.record({ type: "news.fetch_failed", actor, accountId: c.account_id, entity: { type: "competitor", id: c.id }, result: "failed", payload: { source: this.source.name, ...errorFields(err) } });
      return { fetched: 0, added: 0, big: [], provider: "none", error: (err as Error).message };
    }

    const fresh: { item: NewsItem; idx: number }[] = [];
    for (const h of headlines) {
      const row = repo.insertNewsItem({ account_id: c.account_id, competitor_id: c.id, url: h.url, url_hash: createHash("sha256").update(h.url).digest("hex"), title: h.title, source: h.source, published_at: h.publishedAt, snippet: h.snippet });
      if (row) fresh.push({ item: row, idx: fresh.length });
    }
    events.record({ type: "news.fetched", actor, accountId: c.account_id, entity: { type: "competitor", id: c.id }, payload: { source: this.source.name, fetched: headlines.length, new: fresh.length } });

    let provider = "none";
    const big: NewsItem[] = [];
    if (fresh.length) {
      const profile = c.profile_json ? (JSON.parse(c.profile_json) as { summary?: string }).summary : undefined;
      const { verdicts, provider: p } = await classifyHeadlines(
        llm,
        { name: c.name, website: c.website, profile },
        { name: business?.name ?? "the customer", description: business?.description ?? null },
        fresh.map((f) => ({ url: f.item.url, title: f.item.title, source: f.item.source, publishedAt: f.item.published_at, snippet: f.item.snippet })),
        { language: LANGUAGE_NAMES[locale], accountId: c.account_id },
      );
      provider = p;
      for (const v of verdicts) {
        const f = fresh[v.index];
        if (!f) continue;
        repo.classifyNewsItem(f.item.id, { ...v, provider });
        if (v.about_competitor && v.magnitude >= BIG_MAGNITUDE) {
          const item = { ...f.item, ...v, about_competitor: 1, provider } as unknown as NewsItem;
          big.push(item);
          events.record({ type: "news.big", actor, accountId: c.account_id, entity: { type: "news", id: f.item.id }, riskLevel: "medium", payload: { competitor_id: c.id, category: v.category, magnitude: v.magnitude, title: f.item.title, url: f.item.url } });
        }
      }
    }
    repo.markNewsChecked(c.id, next);
    if (big.length && business) await this.alert(c, business.id, business.name, big, locale);
    return { fetched: headlines.length, added: fresh.length, big, provider };
  }

  /** Instant email for big news, on plans with alerts, to verified users. */
  private async alert(c: Competitor, businessId: number, businessName: string, big: NewsItem[], locale: Locale): Promise<void> {
    const { repo, cfg, mailer, events } = this.app;
    const account = repo.getAccount(c.account_id);
    if (!account || !getPlan(account.plan).features.alerts) return;
    const users = repo.listUsers(c.account_id).filter((u) => u.email_verified_at);
    if (users.length === 0) return;
    for (const u of users) {
      const t = translator(isLocale(u.locale) ? u.locale : locale);
      const subject = t("news.alert.subject", { competitor: c.name });
      const lines = big.map((n) => `• ${n.title}${n.source ? ` (${n.source})` : ""}\n  ${n.summary ?? ""}\n  ${t("digest.why")} ${n.why_it_matters ?? ""}\n  ${n.url}`).join("\n\n");
      const text = `${t("news.alert.intro", { competitor: c.name, business: businessName })}\n\n${lines}\n\n${cfg.publicUrl}/b/${businessId}`;
      const html = `<div style="font:15px/1.5 system-ui,sans-serif;max-width:640px"><h2>${esc(t("news.alert.intro", { competitor: c.name, business: businessName }))}</h2>${big
        .map((n) => `<div style="border:1px solid #e3e3df;border-radius:8px;padding:.8rem;margin:.6rem 0"><div style="font-size:.8em;color:#666">${esc(n.source ?? "")} · ${esc(n.category ?? "")} · ${n.magnitude}/5</div><p style="margin:.3rem 0"><a href="${n.url}"><strong>${esc(n.title)}</strong></a></p><p style="margin:.3rem 0">${esc(n.summary ?? "")}</p><p style="margin:.3rem 0;color:#444"><strong>${esc(t("digest.why"))}</strong> ${esc(n.why_it_matters ?? "")}</p></div>`)
        .join("")}<p><a href="${cfg.publicUrl}/b/${businessId}">${esc(t("digest.manage"))}</a></p></div>`;
      const r = await mailer.send({ to: u.email, subject, text, html, kind: "news_alert", accountId: c.account_id }, "system");
      events.record({ type: "alert.sent", accountId: c.account_id, entity: { type: "competitor", id: c.id }, result: r.ok ? "ok" : "failed", payload: { kind: "news", items: big.length, provider: r.provider } });
    }
    for (const n of big) repo.markNewsAlerted(n.id);
  }

  /** Scheduler job: refresh a few due competitors per tick. */
  async runDue(now = new Date(), limit = 3): Promise<number> {
    if (!this.app.cfg.NEWS_ENABLED) return 0;
    const due = this.app.repo.competitorsDueForNews(now.toISOString(), limit);
    for (const c of due) {
      try {
        await this.refresh(c.id);
      } catch (err) {
        log.error("news refresh failed", { competitor_id: c.id, ...errorFields(err) });
        this.app.repo.markNewsChecked(c.id, new Date(Date.now() + this.app.cfg.NEWS_INTERVAL_HOURS * 3_600_000).toISOString());
      }
    }
    return due.length;
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
