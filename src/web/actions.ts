import { z } from "zod";
import type { App } from "../app.js";
import { PAGE_KINDS, type Business, type Competitor, type MonitoredPage } from "../db/repo.js";
import type { ProcessOutcome } from "../monitor/pipeline.js";
import { getPlan } from "../plans.js";

/**
 * Use-case functions shared by the JSON API and the HTML forms so business
 * rules (plan limits, events) live in exactly one place.
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
  plan: z.string().trim().optional(),
});

export const CompetitorInput = z.object({
  name: z.string().trim().min(1).max(200),
  website: url,
  notes: z.string().trim().max(4000).optional(),
  /** Convenience: create these pages at the same time. */
  pages: z.array(z.object({ url, kind: z.enum(PAGE_KINDS).default("other") })).optional(),
});

export const PageInput = z.object({
  url,
  kind: z.enum(PAGE_KINDS).default("other"),
  check_interval_minutes: z.coerce.number().int().min(5).max(60 * 24 * 30).optional(),
});

export function createBusiness(app: App, input: z.infer<typeof BusinessInput>, actor = "user"): Business {
  const plan = getPlan(input.plan ?? "free");
  const b = app.repo.createBusiness({ ...stripUndefined(input), plan: plan.id });
  app.events.record({ type: "business.created", actor, entity: { type: "business", id: b.id }, payload: { name: b.name, plan: b.plan } });
  return b;
}

export function updateBusiness(app: App, id: number, patch: z.infer<ReturnType<typeof BusinessInput.partial>>, actor = "user"): Business {
  const b = app.repo.updateBusiness(id, stripUndefined(patch));
  if (!b) throw new ActionError(404, "business not found");
  app.events.record({ type: "business.updated", actor, entity: { type: "business", id }, payload: { fields: Object.keys(patch) } });
  return b;
}

export function addCompetitor(app: App, businessId: number, input: z.infer<typeof CompetitorInput>, actor = "user"): { competitor: Competitor; pages: MonitoredPage[] } {
  const business = app.repo.getBusiness(businessId);
  if (!business) throw new ActionError(404, "business not found");
  const plan = getPlan(business.plan);
  if (app.repo.countCompetitors(businessId) >= plan.max_competitors) {
    throw new ActionError(402, `Plan "${plan.name}" allows ${plan.max_competitors} competitors`);
  }
  const competitor = app.repo.createCompetitor({ business_id: businessId, name: input.name, website: input.website, ...(input.notes ? { notes: input.notes } : {}) });
  app.events.record({ type: "competitor.added", actor, entity: { type: "competitor", id: competitor.id }, payload: { business_id: businessId, name: competitor.name, website: competitor.website } });

  const pageInputs = input.pages && input.pages.length > 0 ? input.pages : [{ url: input.website, kind: "home" as const }];
  const pages = pageInputs.map((p) => addPage(app, competitor.id, p, actor));
  return { competitor, pages };
}

export function removeCompetitor(app: App, id: number, actor = "user"): void {
  const c = app.repo.getCompetitor(id);
  if (!c) throw new ActionError(404, "competitor not found");
  app.repo.deleteCompetitor(id);
  app.events.record({ type: "competitor.removed", actor, entity: { type: "competitor", id }, payload: { business_id: c.business_id, name: c.name } });
}

export function addPage(app: App, competitorId: number, input: z.infer<typeof PageInput>, actor = "user"): MonitoredPage {
  const competitor = app.repo.getCompetitor(competitorId);
  if (!competitor) throw new ActionError(404, "competitor not found");
  const business = app.repo.getBusiness(competitor.business_id)!;
  const plan = getPlan(business.plan);
  if (app.repo.listPages(competitorId).length >= plan.max_pages_per_competitor) {
    throw new ActionError(402, `Plan "${plan.name}" allows ${plan.max_pages_per_competitor} pages per competitor`);
  }
  try {
    const page = app.repo.createPage({
      competitor_id: competitorId,
      url: input.url,
      kind: input.kind,
      check_interval_minutes: input.check_interval_minutes ?? plan.check_interval_minutes,
    });
    app.events.record({ type: "page.added", actor, entity: { type: "page", id: page.id }, payload: { competitor_id: competitorId, url: page.url, kind: page.kind } });
    return page;
  } catch (err) {
    if (/UNIQUE/i.test((err as Error).message)) throw new ActionError(409, "page already monitored");
    throw err;
  }
}

export function removePage(app: App, id: number, actor = "user"): void {
  const p = app.repo.getPage(id);
  if (!p) throw new ActionError(404, "page not found");
  app.repo.deletePage(id);
  app.events.record({ type: "page.removed", actor, entity: { type: "page", id }, payload: { competitor_id: p.competitor_id, url: p.url } });
}

/** Scan every page of a business immediately, ignoring schedule. */
export async function scanBusiness(app: App, businessId: number): Promise<{ page: MonitoredPage; outcome: ProcessOutcome }[]> {
  const business = app.repo.getBusiness(businessId);
  if (!business) throw new ActionError(404, "business not found");
  const results: { page: MonitoredPage; outcome: ProcessOutcome }[] = [];
  for (const competitor of app.repo.listCompetitors(businessId)) {
    for (const page of app.repo.listPages(competitor.id)) {
      if (!page.enabled) continue;
      results.push({ page, outcome: await app.pipeline.processPage(page) });
    }
  }
  return results;
}

export async function scanPage(app: App, pageId: number): Promise<ProcessOutcome> {
  const page = app.repo.getPage(pageId);
  if (!page) throw new ActionError(404, "page not found");
  return app.pipeline.processPage(page);
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as never;
}
