import { z } from "zod";
import type { App } from "../app.js";
import type { Principal } from "../auth.js";
import { FEEDBACK_VERDICTS, PAGE_KINDS, type Business, type Competitor, type Insight, type InsightFeedback, type MonitoredPage, type PageSuggestion } from "../db/repo.js";
import { errorFields } from "../logger.js";
import type { ProcessOutcome } from "../monitor/pipeline.js";
import { getPlan } from "../plans.js";
import { discoverPages } from "../sources/website/discover.js";

/**
 * Use-case functions shared by the JSON API and the HTML forms so business
 * rules (tenant scoping, plan limits, events) live in exactly one place.
 * Every function takes the authenticated Principal; nothing here trusts ids
 * from the request without checking they belong to the principal's account.
 */

export class ActionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const url = z.string().trim().url().max(2000);

export const BusinessInput = z.object({
  name: z.string().trim().min(1).max(200),
  website: url.optional().or(z.literal("").transform(() => undefined)),
  description: z.string().trim().max(4000).optional(),
  pricing_notes: z.string().trim().max(4000).optional(),
});
export const BusinessPatch = BusinessInput.partial().extend({ digest_enabled: z.coerce.boolean().optional() });

export const CompetitorInput = z.object({
  name: z.string().trim().min(1).max(200),
  website: url,
  notes: z.string().trim().max(4000).optional(),
  /** Convenience: create these pages at the same time. */
  pages: z.array(z.object({ url, kind: z.enum(PAGE_KINDS).default("other") })).optional(),
  /** Run page discovery immediately (default true). */
  discover: z.boolean().default(true),
});

export const PageInput = z.object({
  url,
  kind: z.enum(PAGE_KINDS).default("other"),
  check_interval_minutes: z.coerce.number().int().min(5).max(60 * 24 * 30).optional(),
});

export const FeedbackInput = z.object({
  verdict: z.enum(FEEDBACK_VERDICTS),
  comment: z.string().trim().max(2000).optional(),
});

function notFound(what: string): never {
  throw new ActionError(404, `${what} not found`);
}

// ---------- Businesses ----------

export function createBusiness(app: App, p: Principal, input: z.infer<typeof BusinessInput>): Business {
  const b = app.repo.createBusiness({ account_id: p.accountId, ...stripUndefined(input) });
  app.digests.scheduleIfUnset(b);
  app.events.record({ type: "business.created", actor: p.actor, accountId: p.accountId, entity: { type: "business", id: b.id }, payload: { name: b.name } });
  return app.repo.getBusiness(p.accountId, b.id)!;
}

export function getBusiness(app: App, p: Principal, id: number): Business {
  return app.repo.getBusiness(p.accountId, id) ?? notFound("business");
}

export function updateBusiness(app: App, p: Principal, id: number, patch: z.infer<typeof BusinessPatch>): Business {
  const clean = stripUndefined(patch);
  const b = app.repo.updateBusiness(p.accountId, id, { ...clean, ...(clean.digest_enabled !== undefined ? { digest_enabled: clean.digest_enabled ? 1 : 0 } : {}) } as never) ?? notFound("business");
  app.events.record({ type: "business.updated", actor: p.actor, accountId: p.accountId, entity: { type: "business", id }, payload: { fields: Object.keys(clean) } });
  return b;
}

export function deleteBusiness(app: App, p: Principal, id: number): void {
  const b = getBusiness(app, p, id);
  app.repo.deleteBusiness(p.accountId, id);
  app.events.record({ type: "business.deleted", actor: p.actor, accountId: p.accountId, entity: { type: "business", id }, riskLevel: "high", payload: { name: b.name } });
}

// ---------- Competitors ----------

export async function addCompetitor(app: App, p: Principal, businessId: number, input: z.infer<typeof CompetitorInput>): Promise<{ competitor: Competitor; pages: MonitoredPage[]; suggestions: PageSuggestion[] }> {
  getBusiness(app, p, businessId);
  const plan = getPlan(app.repo.getAccount(p.accountId)?.plan ?? "free");
  if (app.repo.countCompetitors(p.accountId) >= plan.max_competitors) {
    throw new ActionError(402, `Plan "${plan.name}" allows ${plan.max_competitors} competitors`);
  }
  const competitor = app.repo.createCompetitor({ account_id: p.accountId, business_id: businessId, name: input.name, website: input.website, ...(input.notes ? { notes: input.notes } : {}) });
  app.events.record({ type: "competitor.added", actor: p.actor, accountId: p.accountId, entity: { type: "competitor", id: competitor.id }, payload: { business_id: businessId, name: competitor.name, website: competitor.website } });

  const pageInputs = input.pages && input.pages.length > 0 ? input.pages : [{ url: input.website, kind: "home" as const }];
  const pages = pageInputs.map((pg) => addPage(app, p, competitor.id, pg));
  const suggestions = input.discover ? await discoverForCompetitor(app, p, competitor.id) : [];
  return { competitor, pages, suggestions };
}

export function getCompetitor(app: App, p: Principal, id: number): Competitor {
  return app.repo.getCompetitor(p.accountId, id) ?? notFound("competitor");
}

export function removeCompetitor(app: App, p: Principal, id: number): void {
  const c = getCompetitor(app, p, id);
  app.repo.deleteCompetitor(p.accountId, id);
  app.events.record({ type: "competitor.removed", actor: p.actor, accountId: p.accountId, entity: { type: "competitor", id }, riskLevel: "medium", payload: { business_id: c.business_id, name: c.name } });
}

// ---------- Pages ----------

export function addPage(app: App, p: Principal, competitorId: number, input: z.infer<typeof PageInput>): MonitoredPage {
  getCompetitor(app, p, competitorId);
  const plan = getPlan(app.repo.getAccount(p.accountId)?.plan ?? "free");
  if (app.repo.listPages(p.accountId, competitorId).length >= plan.max_pages_per_competitor) {
    throw new ActionError(402, `Plan "${plan.name}" allows ${plan.max_pages_per_competitor} pages per competitor`);
  }
  try {
    const page = app.repo.createPage({
      account_id: p.accountId,
      competitor_id: competitorId,
      url: input.url,
      kind: input.kind,
      check_interval_minutes: input.check_interval_minutes ?? plan.check_interval_minutes,
    });
    app.events.record({ type: "page.added", actor: p.actor, accountId: p.accountId, entity: { type: "page", id: page.id }, payload: { competitor_id: competitorId, url: page.url, kind: page.kind } });
    return page;
  } catch (err) {
    if (/UNIQUE/i.test((err as Error).message)) throw new ActionError(409, "page already monitored");
    throw err;
  }
}

export function getPage(app: App, p: Principal, id: number): MonitoredPage {
  return app.repo.getPage(p.accountId, id) ?? notFound("page");
}

export function removePage(app: App, p: Principal, id: number): void {
  const pg = getPage(app, p, id);
  app.repo.deletePage(p.accountId, id);
  app.events.record({ type: "page.removed", actor: p.actor, accountId: p.accountId, entity: { type: "page", id }, payload: { competitor_id: pg.competitor_id, url: pg.url } });
}

export function setPagePaused(app: App, p: Principal, id: number, paused: boolean): MonitoredPage {
  getPage(app, p, id);
  app.repo.setPageEnabled(p.accountId, id, !paused);
  app.events.record({ type: paused ? "page.paused" : "page.resumed", actor: p.actor, accountId: p.accountId, entity: { type: "page", id } });
  return getPage(app, p, id);
}

// ---------- Discovery ----------

export async function discoverForCompetitor(app: App, p: Principal, competitorId: number): Promise<PageSuggestion[]> {
  const competitor = getCompetitor(app, p, competitorId);
  const existing = new Set(app.repo.listPages(p.accountId, competitorId).map((pg) => pg.url.replace(/\/$/, "")));
  try {
    const found = await discoverPages(app.fetcher, competitor.website);
    const created: PageSuggestion[] = [];
    for (const f of found) {
      if (existing.has(f.url.replace(/\/$/, ""))) continue;
      const s = app.repo.upsertSuggestion({ account_id: p.accountId, competitor_id: competitorId, url: f.url, kind: f.kind, reason: f.reason, score: f.score });
      if (s) {
        created.push(s);
        app.events.record({ type: "page.suggested", actor: "system", accountId: p.accountId, entity: { type: "suggestion", id: s.id }, payload: { competitor_id: competitorId, url: s.url, kind: s.kind, score: s.score } });
      }
    }
    app.events.record({ type: "discovery.completed", actor: "system", accountId: p.accountId, entity: { type: "competitor", id: competitorId }, payload: { found: found.length, new_suggestions: created.length } });
    return app.repo.listSuggestions(p.accountId, competitorId);
  } catch (err) {
    app.events.record({ type: "discovery.failed", actor: "system", accountId: p.accountId, entity: { type: "competitor", id: competitorId }, result: "failed", payload: errorFields(err) });
    return app.repo.listSuggestions(p.accountId, competitorId);
  }
}

export function resolveSuggestion(app: App, p: Principal, id: number, accept: boolean): MonitoredPage | null {
  const s = app.repo.getSuggestion(p.accountId, id) ?? notFound("suggestion");
  if (s.status !== "suggested") throw new ActionError(409, "suggestion already resolved");
  if (!accept) {
    app.repo.setSuggestionStatus(id, "dismissed");
    app.events.record({ type: "page.suggestion_dismissed", actor: p.actor, accountId: p.accountId, entity: { type: "suggestion", id }, payload: { url: s.url } });
    return null;
  }
  const page = addPage(app, p, s.competitor_id, { url: s.url, kind: s.kind });
  app.repo.setSuggestionStatus(id, "accepted");
  app.events.record({ type: "page.suggestion_accepted", actor: p.actor, accountId: p.accountId, entity: { type: "suggestion", id }, payload: { url: s.url, page_id: page.id } });
  return page;
}

// ---------- Scanning ----------

export async function scanBusiness(app: App, p: Principal, businessId: number): Promise<{ page: MonitoredPage; outcome: ProcessOutcome }[]> {
  getBusiness(app, p, businessId);
  const results: { page: MonitoredPage; outcome: ProcessOutcome }[] = [];
  for (const competitor of app.repo.listCompetitors(p.accountId, businessId)) {
    for (const page of app.repo.listPages(p.accountId, competitor.id)) {
      if (!page.enabled) continue;
      results.push({ page, outcome: await app.pipeline.processPage(page) });
    }
  }
  return results;
}

export async function scanPage(app: App, p: Principal, pageId: number): Promise<ProcessOutcome> {
  const page = getPage(app, p, pageId);
  if (!page.enabled) throw new ActionError(409, "page is paused");
  return app.pipeline.processPage(page);
}

// ---------- Insights & feedback ----------

export function getInsight(app: App, p: Principal, id: number): Insight {
  return app.repo.getInsight(p.accountId, id) ?? notFound("insight");
}

export function giveFeedback(app: App, p: Principal, insightId: number, input: z.infer<typeof FeedbackInput>): InsightFeedback {
  const insight = getInsight(app, p, insightId);
  const fb = app.repo.upsertFeedback({ account_id: p.accountId, insight_id: insightId, user_id: p.user.id, verdict: input.verdict, ...(input.comment ? { comment: input.comment } : {}) });
  app.events.record({
    type: "insight.feedback",
    actor: p.actor,
    accountId: p.accountId,
    entity: { type: "insight", id: insightId },
    payload: { verdict: input.verdict, category: insight.category, importance: insight.importance, provider: insight.provider, model: insight.model, has_comment: !!input.comment },
  });
  return fb;
}

export async function reanalyze(app: App, p: Principal, changeId: number): Promise<Insight | null> {
  const change = app.repo.getChange(p.accountId, changeId) ?? notFound("change");
  return app.pipeline.analyzeChange(change, null, p.actor);
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as never;
}
