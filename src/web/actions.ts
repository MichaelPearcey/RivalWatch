import { z } from "zod";
import type { App } from "../app.js";
import type { Principal } from "../auth.js";
import { generateLandscape, type LandscapeInput } from "../ai/landscape.js";
import { generateProfile, type ProfileSource } from "../ai/profile.js";
import {
  FEEDBACK_VERDICTS,
  PAGE_KINDS,
  type Business,
  type Competitor,
  type CompetitorProfile,
  type Insight,
  type InsightFeedback,
  type Landscape,
  type LandscapeDoc,
  type MonitoredPage,
  type PageSuggestion,
} from "../db/repo.js";
import { LANGUAGE_NAMES, isLocale, translator, type Locale } from "../i18n/index.js";
import { errorFields, log } from "../logger.js";
import type { ProcessOutcome } from "../monitor/pipeline.js";
import { PLANS, getPlan } from "../plans.js";
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

// ---------- Operator (admin) actions ----------

/**
 * Tier-3 action: changing what a customer pays for. Goes through the approvals
 * system like every consequential action; an admin acting directly is modelled
 * as "request + approve in one step" so the audit trail is identical to the
 * agent-requested path. Billing will later drive the same action.
 */
export async function setAccountPlan(app: App, admin: Principal, accountId: number, planId: string, reason?: string): Promise<{ account_id: number; plan: string; approval_id: number }> {
  if (!admin.isAdmin) throw new ActionError(403, "admin only");
  if (!(planId in PLANS)) throw new ActionError(400, `unknown plan "${planId}"; valid: ${Object.keys(PLANS).join(", ")}`);
  app.repo.getAccount(accountId) ?? notFound("account");
  const req = app.approvals.request(admin, { action: "account.set_plan", payload: { account_id: accountId, plan: planId }, reason, accountId, target: { type: "account", id: accountId } });
  const done = await app.approvals.decide(admin, req.id, true, "direct admin action");
  if (done.status !== "executed") throw new ActionError(500, `plan change failed: ${done.result ?? done.status}`);
  return { account_id: accountId, plan: planId, approval_id: done.id };
}

// ---------- Data subject rights ----------

/** Everything we hold for the account, as JSON (UK GDPR right of access / portability). */
export function exportAccountData(app: App, p: Principal): Record<string, unknown> {
  const { repo, db } = app;
  const acct = p.accountId;
  const q = (sql: string) => db.prepare(sql).all(acct);
  const data = {
    exported_at: new Date().toISOString(),
    account: repo.getAccount(acct),
    users: repo.listUsers(acct).map(({ password_hash, ...u }) => ({ ...u, has_password: !!password_hash })),
    consents: repo.listUsers(acct).flatMap((u) => repo.listConsents(u.id)),
    businesses: q("SELECT * FROM businesses WHERE account_id = ?"),
    competitors: q("SELECT * FROM competitors WHERE account_id = ?"),
    monitored_pages: q("SELECT * FROM monitored_pages WHERE account_id = ?"),
    page_suggestions: q("SELECT * FROM page_suggestions WHERE account_id = ?"),
    snapshots: q("SELECT id, page_id, fetched_at, last_seen_at, http_status, content_type, content_hash, title, text, meta_json FROM snapshots WHERE account_id = ?"),
    changes: q("SELECT * FROM changes WHERE account_id = ?"),
    insights: q("SELECT * FROM insights WHERE account_id = ?"),
    insight_feedback: q("SELECT * FROM insight_feedback WHERE account_id = ?"),
    landscapes: q("SELECT * FROM landscapes WHERE account_id = ?"),
    api_keys: q("SELECT id, name, key_prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE account_id = ?"),
    emails: q("SELECT id, to_address, kind, subject, provider, status, created_at FROM emails WHERE account_id = ?"),
    events: q("SELECT ts, type, actor, entity_type, entity_id, result, payload FROM events WHERE account_id = ? ORDER BY ts"),
    approvals: q("SELECT * FROM approvals WHERE account_id = ?"),
  };
  app.events.record({ type: "account.data_exported", actor: p.actor, accountId: acct, entity: { type: "account", id: acct }, riskLevel: "medium" });
  return data;
}

export const DELETION_GRACE_DAYS = 7;

/** Right to erasure: schedule hard deletion after a short grace period; sign the user out of all sessions except the current one. */
export function requestAccountDeletion(app: App, p: Principal): { delete_after: string } {
  if (p.user.role !== "owner") throw new ActionError(403, "only the account owner can delete the account");
  const deleteAfter = new Date(Date.now() + DELETION_GRACE_DAYS * 86_400_000).toISOString();
  app.repo.setAccountDeletion(p.accountId, deleteAfter);
  for (const page of app.repo.listPagesAny({ limit: 10_000 }).filter((pg) => pg.account_id === p.accountId)) app.repo.setPageEnabled(p.accountId, page.id, false);
  app.events.record({ type: "account.deletion_requested", actor: p.actor, accountId: p.accountId, entity: { type: "account", id: p.accountId }, riskLevel: "high", payload: { delete_after: deleteAfter } });
  return { delete_after: deleteAfter };
}

export function cancelAccountDeletion(app: App, p: Principal): void {
  const acct = app.repo.getAccount(p.accountId);
  if (!acct?.delete_after) throw new ActionError(409, "no deletion pending");
  app.repo.setAccountDeletion(p.accountId, null);
  app.events.record({ type: "account.deletion_cancelled", actor: p.actor, accountId: p.accountId, entity: { type: "account", id: p.accountId }, riskLevel: "medium" });
}

/** Scheduler job: hard-delete accounts whose grace period has passed. */
export function purgeDeletedAccounts(app: App, now = new Date()): number {
  const due = app.repo.accountsDueForDeletion(now.toISOString());
  for (const a of due) {
    const counts = { users: app.repo.listUsers(a.id).length, businesses: app.repo.count("SELECT COUNT(*) c FROM businesses WHERE account_id = ?", a.id) };
    app.repo.deleteAccount(a.id);
    app.events.record({ type: "account.deleted", actor: "system", accountId: null, entity: { type: "account", id: a.id }, riskLevel: "high", payload: { requested_at: a.deletion_requested_at, ...counts } });
  }
  return due.length;
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
  let suggestions: PageSuggestion[] = [];
  if (input.discover) {
    suggestions = await discoverForCompetitor(app, p, competitor.id);
    // Auto-fill: adopt the single best pricing and products page when the URL path itself says what it is.
    for (const kind of ["pricing", "products"] as const) {
      const best = suggestions.filter((s) => s.kind === kind && s.score >= AUTO_ADOPT_SCORE).sort((a, b) => b.score - a.score)[0];
      if (!best) continue;
      try {
        const page = resolveSuggestion(app, p, best.id, true, "system");
        if (page) pages.push(page);
      } catch {
        /* plan limit or duplicate: leave it as a suggestion */
      }
    }
    suggestions = app.repo.listSuggestions(p.accountId, competitor.id);
    // Profile generation reads the pages we just fetched; run it without blocking the request.
    app.repo.setCompetitorProfile(competitor.id, "pending", null);
    void app.track(profileCompetitor(app, p, competitor.id).catch((err) => log.error("profile generation crashed", { competitor_id: competitor.id, ...errorFields(err) })));
  }
  return { competitor: app.repo.getCompetitor(p.accountId, competitor.id)!, pages, suggestions };
}

/** Suggestions with a path match score at or above this are adopted automatically (see discover.ts scoring). */
const AUTO_ADOPT_SCORE = 0.8;

/**
 * Builds the competitor profile from their home page plus any pricing/products pages we monitor.
 * Uses the LLM when available, otherwise a heuristic; records status so the UI can show progress.
 */
export async function profileCompetitor(app: App, p: Principal, competitorId: number): Promise<CompetitorProfile | null> {
  const competitor = getCompetitor(app, p, competitorId);
  app.repo.setCompetitorProfile(competitorId, "pending", null);
  try {
    const pages = app.repo.listPages(p.accountId, competitorId).filter((pg) => ["home", "pricing", "products"].includes(pg.kind)).slice(0, 4);
    const sources: ProfileSource[] = [];
    for (const pg of pages) {
      // Prefer a stored snapshot (already fetched) to avoid hammering the site; fetch only when we have none.
      const snap = app.repo.latestSnapshot(pg.id);
      if (snap) sources.push({ url: pg.url, kind: pg.kind, title: snap.title, text: snap.text });
      else {
        const outcome = await app.sources.get(pg.source_type)?.fetch(pg);
        if (outcome?.ok) sources.push({ url: pg.url, kind: pg.kind, title: outcome.title, text: outcome.text });
      }
    }
    if (sources.length === 0) {
      const outcome = await app.sources.get("website")?.fetch({ ...pages[0]!, url: competitor.website, kind: "home" } as MonitoredPage);
      if (outcome?.ok) sources.push({ url: competitor.website, kind: "home", title: outcome.title, text: outcome.text });
    }
    const owner = app.repo.listUsers(p.accountId).find((u) => u.role === "owner");
    const language = LANGUAGE_NAMES[(isLocale(owner?.locale) ? owner!.locale : "en") as Locale];
    const profile = await generateProfile(app.llm, competitor.name, competitor.website, sources, { language, accountId: p.accountId });
    app.repo.setCompetitorProfile(competitorId, "ready", profile);
    app.events.record({ type: "competitor.profiled", actor: "system", accountId: p.accountId, entity: { type: "competitor", id: competitorId }, payload: { provider: profile.provider, sources: profile.sources.length, usps: profile.usps.length } });
    return profile;
  } catch (err) {
    app.repo.setCompetitorProfile(competitorId, "failed", null, (err as Error).message);
    app.events.record({ type: "competitor.profiled", actor: "system", accountId: p.accountId, entity: { type: "competitor", id: competitorId }, result: "failed", payload: errorFields(err) });
    return null;
  }
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

export function resolveSuggestion(app: App, p: Principal, id: number, accept: boolean, actor = p.actor): MonitoredPage | null {
  const s = app.repo.getSuggestion(p.accountId, id) ?? notFound("suggestion");
  if (s.status !== "suggested") throw new ActionError(409, "suggestion already resolved");
  if (!accept) {
    app.repo.setSuggestionStatus(id, "dismissed");
    app.events.record({ type: "page.suggestion_dismissed", actor, accountId: p.accountId, entity: { type: "suggestion", id }, payload: { url: s.url } });
    return null;
  }
  const page = addPage(app, p, s.competitor_id, { url: s.url, kind: s.kind });
  app.repo.setSuggestionStatus(id, "accepted");
  app.events.record({ type: "page.suggestion_accepted", actor, accountId: p.accountId, entity: { type: "suggestion", id }, payload: { url: s.url, page_id: page.id, automatic: actor === "system" } });
  return page;
}

// ---------- Competitor landscape ----------

function ownerLocale(app: App, accountId: number): Locale {
  const owner = app.repo.listUsers(accountId).find((u) => u.role === "owner");
  return isLocale(owner?.locale) ? owner!.locale : "en";
}

function ownerLanguage(app: App, accountId: number): string {
  return LANGUAGE_NAMES[ownerLocale(app, accountId)];
}

/**
 * Builds the business-level "competitor landscape" briefing from what we already
 * hold: each competitor's profile, their recent confirmed changes and their news.
 * Never fetches anything, so it is cheap and safe to regenerate on demand; falls
 * back to a heuristic document when the LLM is unavailable or capped.
 */
export async function generateLandscapeDoc(app: App, p: Principal, businessId: number): Promise<LandscapeDoc> {
  const business = getBusiness(app, p, businessId);
  const competitors = app.repo.listCompetitors(p.accountId, businessId);
  app.repo.setLandscape({ account_id: p.accountId, business_id: businessId, status: "pending", doc: null, competitorCount: competitors.length });
  try {
    const insights = app.repo.listInsights(p.accountId, businessId, { limit: 60 });
    const inputs: LandscapeInput[] = competitors.map((c) => {
      let profile: CompetitorProfile | null = null;
      try {
        profile = c.profile_json ? (JSON.parse(c.profile_json) as CompetitorProfile) : null;
      } catch {
        profile = null;
      }
      return {
        name: c.name,
        website: c.website,
        positioning: profile?.positioning ?? "",
        pricing: profile?.pricing_summary ?? "",
        target_customers: profile?.target_customers ?? "",
        usps: profile?.usps ?? [],
        products: profile?.products ?? [],
        recent_changes: insights.filter((i) => i.competitor_id === c.id && i.matters === 1).slice(0, 5).map((i) => i.headline),
        recent_news: app.repo.listNews(p.accountId, c.id, { limit: 5, relevantOnly: true }).map((n) => n.title),
      };
    });
    const doc = await generateLandscape(app.llm, { name: business.name, description: business.description, pricing: business.pricing_notes }, inputs, {
      language: ownerLanguage(app, p.accountId),
      accountId: p.accountId,
      t: translator(ownerLocale(app, p.accountId)),
    });
    app.repo.setLandscape({ account_id: p.accountId, business_id: businessId, status: "ready", doc, competitorCount: competitors.length });
    app.events.record({
      type: "landscape.generated",
      actor: p.actor,
      accountId: p.accountId,
      entity: { type: "business", id: businessId },
      payload: { provider: doc.provider, competitors: competitors.length, recommendations: doc.recommendations.length },
    });
    return doc;
  } catch (err) {
    app.repo.setLandscape({ account_id: p.accountId, business_id: businessId, status: "failed", doc: null, competitorCount: competitors.length, error: (err as Error).message });
    app.events.record({ type: "landscape.generated", actor: p.actor, accountId: p.accountId, entity: { type: "business", id: businessId }, result: "failed", payload: errorFields(err) });
    throw err;
  }
}

/** The stored briefing plus its business, for download. 404s until one exists. */
export function landscapeForExport(app: App, p: Principal, businessId: number): { business: Business; landscape: Landscape; doc: LandscapeDoc } {
  const business = getBusiness(app, p, businessId);
  const landscape = app.repo.getLandscape(p.accountId, businessId);
  if (!landscape?.doc_json) notFound("landscape");
  let doc: LandscapeDoc;
  try {
    doc = JSON.parse(landscape!.doc_json!) as LandscapeDoc;
  } catch {
    throw new ActionError(409, "landscape document is unreadable; regenerate it");
  }
  return { business, landscape: landscape!, doc };
}

// ---------- News ----------

export async function refreshNews(app: App, p: Principal, competitorId: number) {
  getCompetitor(app, p, competitorId);
  return app.news.refresh(competitorId, p.actor);
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
