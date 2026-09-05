import { Hono } from "hono";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import type { App } from "../app.js";
import { redactConfig } from "../config.js";
import type { Insight } from "../db/repo.js";
import { errorFields, log } from "../logger.js";
import { PLANS } from "../plans.js";
import {
  ActionError,
  BusinessInput,
  CompetitorInput,
  PageInput,
  addCompetitor,
  addPage,
  createBusiness,
  removeCompetitor,
  removePage,
  scanBusiness,
  scanPage,
  updateBusiness,
} from "./actions.js";
import { createDemoSite } from "./demo-site.js";
import { BusinessPage, BusinessesPage, EventsPage, InsightDetailPage, PageDetailPage } from "./views.js";

const idParam = z.coerce.number().int().positive();

export function createWebApp(app: App) {
  const web = new Hono({ strict: false });
  const { repo, events } = app;

  web.onError((err, c) => {
    if (err instanceof ActionError) return c.json({ error: err.message }, err.status as 400);
    if (err instanceof z.ZodError) return c.json({ error: "validation failed", issues: err.issues }, 400);
    log.error("unhandled request error", { path: c.req.path, ...errorFields(err) });
    return c.json({ error: "internal error" }, 500);
  });

  // ---------------- Health & meta ----------------
  web.get("/health", (c) => {
    let db: "ok" | "error" = "ok";
    try {
      app.db.prepare("SELECT 1").get();
    } catch {
      db = "error";
    }
    return c.json({ status: db === "ok" ? "ok" : "degraded", db, scheduler: app.scheduler.getStatus(), sources: app.sources.types(), analyzer: app.analyzer.name, config: redactConfig(app.cfg) }, db === "ok" ? 200 : 503);
  });
  web.get("/api/plans", (c) => c.json(PLANS));

  // ---------------- Businesses ----------------
  web.get("/api/businesses", (c) => c.json(repo.listBusinesses()));
  web.post("/api/businesses", async (c) => c.json(createBusiness(app, BusinessInput.parse(await c.req.json()), actor(c)), 201));
  web.get("/api/businesses/:id", (c) => {
    const b = repo.getBusiness(idParam.parse(c.req.param("id")));
    return b ? c.json(b) : c.json({ error: "not found" }, 404);
  });
  web.patch("/api/businesses/:id", async (c) => c.json(updateBusiness(app, idParam.parse(c.req.param("id")), BusinessInput.partial().parse(await c.req.json()), actor(c))));

  // ---------------- Competitors & pages ----------------
  web.get("/api/businesses/:id/competitors", (c) => {
    const id = idParam.parse(c.req.param("id"));
    return c.json(repo.listCompetitors(id).map((comp) => ({ ...comp, pages: repo.listPages(comp.id) })));
  });
  web.post("/api/businesses/:id/competitors", async (c) => c.json(addCompetitor(app, idParam.parse(c.req.param("id")), CompetitorInput.parse(await c.req.json()), actor(c)), 201));
  web.delete("/api/competitors/:id", (c) => {
    removeCompetitor(app, idParam.parse(c.req.param("id")), actor(c));
    return c.body(null, 204);
  });
  web.get("/api/competitors/:id/pages", (c) => c.json(repo.listPages(idParam.parse(c.req.param("id")))));
  web.post("/api/competitors/:id/pages", async (c) => c.json(addPage(app, idParam.parse(c.req.param("id")), PageInput.parse(await c.req.json()), actor(c)), 201));
  web.delete("/api/pages/:id", (c) => {
    removePage(app, idParam.parse(c.req.param("id")), actor(c));
    return c.body(null, 204);
  });
  web.get("/api/pages/:id/snapshots", (c) => c.json(repo.listSnapshots(idParam.parse(c.req.param("id")))));
  web.get("/api/snapshots/:id", (c) => {
    const s = repo.getSnapshot(idParam.parse(c.req.param("id")));
    if (!s) return c.json({ error: "not found" }, 404);
    const { raw_gzip, ...rest } = s;
    const raw = c.req.query("raw") === "1" && raw_gzip ? gunzipSync(raw_gzip).toString("utf8") : undefined;
    return c.json({ ...rest, has_raw: !!raw_gzip, ...(raw !== undefined ? { raw } : {}) });
  });

  // ---------------- Scanning ----------------
  web.post("/api/businesses/:id/scan", async (c) => {
    const results = await scanBusiness(app, idParam.parse(c.req.param("id")));
    return c.json(results.map((r) => ({ page_id: r.page.id, url: r.page.url, ...r.outcome })));
  });
  web.post("/api/pages/:id/scan", async (c) => c.json(await scanPage(app, idParam.parse(c.req.param("id")))));
  web.post("/api/scheduler/tick", async (c) => c.json({ processed: await app.scheduler.tick() }));

  // ---------------- Changes & insights ----------------
  web.get("/api/businesses/:id/insights", (c) => {
    const id = idParam.parse(c.req.param("id"));
    return c.json(repo.listInsights(id, { includeNoise: c.req.query("include_noise") === "1", limit: Number(c.req.query("limit") ?? 100) }));
  });
  web.get("/api/insights/:id", (c) => {
    const i = repo.getInsight(idParam.parse(c.req.param("id")));
    if (!i) return c.json({ error: "not found" }, 404);
    return c.json({ ...i, change: repo.getChange(i.change_id) });
  });
  web.post("/api/insights/:id/read", (c) => {
    repo.markInsightRead(idParam.parse(c.req.param("id")));
    return c.body(null, 204);
  });
  web.get("/api/changes/:id", (c) => {
    const ch = repo.getChange(idParam.parse(c.req.param("id")));
    return ch ? c.json(ch) : c.json({ error: "not found" }, 404);
  });
  web.post("/api/changes/:id/reanalyze", async (c) => {
    const ch = repo.getChange(idParam.parse(c.req.param("id")));
    if (!ch) return c.json({ error: "not found" }, 404);
    const insight = await app.pipeline.analyzeChange(ch);
    return insight ? c.json(insight) : c.json({ error: "analysis failed" }, 502);
  });

  // ---------------- Events & stats ----------------
  web.get("/api/events", (c) => {
    const q = c.req.query();
    return c.json(
      events.list({
        ...(q.type ? { type: q.type } : {}),
        ...(q.entity_type ? { entityType: q.entity_type } : {}),
        ...(q.entity_id ? { entityId: Number(q.entity_id) } : {}),
        ...(q.since ? { since: q.since } : {}),
        limit: Math.min(1000, Number(q.limit ?? 100)),
      }),
    );
  });
  web.get("/api/stats", (c) => {
    const day = new Date(Date.now() - 86_400_000).toISOString();
    const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const count = (sql: string) => (app.db.prepare(sql).get() as { c: number }).c;
    return c.json({
      totals: {
        businesses: count("SELECT COUNT(*) c FROM businesses"),
        competitors: count("SELECT COUNT(*) c FROM competitors"),
        pages: count("SELECT COUNT(*) c FROM monitored_pages WHERE enabled = 1"),
        snapshots: count("SELECT COUNT(*) c FROM snapshots"),
        changes: count("SELECT COUNT(*) c FROM changes"),
        insights: count("SELECT COUNT(*) c FROM insights WHERE matters = 1"),
        insights_filtered: count("SELECT COUNT(*) c FROM insights WHERE matters = 0"),
      },
      last_24h: events.countsSince(day),
      last_7d: events.countsSince(week),
      ai_tokens_7d: app.db.prepare("SELECT COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o FROM insights WHERE created_at >= ?").get(week),
      scheduler: app.scheduler.getStatus(),
    });
  });

  // ---------------- HTML UI ----------------
  web.get("/", (c) => c.html(<BusinessesPage businesses={repo.listBusinesses()} />));
  web.post("/b", async (c) => {
    const b = createBusiness(app, BusinessInput.parse(await formObject(c.req)), "user");
    return c.redirect(`/b/${b.id}`);
  });
  web.get("/b/:id", (c) => {
    const id = idParam.parse(c.req.param("id"));
    const business = repo.getBusiness(id);
    if (!business) return c.notFound();
    const competitors = repo.listCompetitors(id).map((competitor) => ({ competitor, pages: repo.listPages(competitor.id) }));
    const includeNoise = c.req.query("noise") === "1";
    const insights = repo.listInsights(id, { includeNoise });
    const competitorNames = Object.fromEntries(competitors.map(({ competitor }) => [competitor.id, competitor.name]));
    return c.html(<BusinessPage business={business} competitors={competitors} insights={insights} competitorNames={competitorNames} includeNoise={includeNoise} flash={c.req.query("flash")} />);
  });
  web.post("/b/:id/competitors", async (c) => {
    const id = idParam.parse(c.req.param("id"));
    const form = await formObject(c.req);
    const pages = [{ url: String(form.website), kind: "home" as const }];
    if (form.pricing_url) pages.push({ url: String(form.pricing_url), kind: "pricing" as never });
    try {
      addCompetitor(app, id, CompetitorInput.parse({ name: form.name, website: form.website, pages }), "user");
      return c.redirect(`/b/${id}`);
    } catch (err) {
      return c.redirect(`/b/${id}?flash=${encodeURIComponent(messageOf(err))}`);
    }
  });
  web.post("/b/:id/scan", async (c) => {
    const id = idParam.parse(c.req.param("id"));
    const results = await scanBusiness(app, id);
    const summary = summarise(results.map((r) => r.outcome.status));
    return c.redirect(`/b/${id}?flash=${encodeURIComponent(`Scanned ${results.length} page(s): ${summary}`)}`);
  });
  web.post("/competitors/:id/pages", async (c) => {
    const id = idParam.parse(c.req.param("id"));
    const competitor = repo.getCompetitor(id);
    if (!competitor) return c.notFound();
    try {
      addPage(app, id, PageInput.parse(await formObject(c.req)), "user");
      return c.redirect(`/b/${competitor.business_id}`);
    } catch (err) {
      return c.redirect(`/b/${competitor.business_id}?flash=${encodeURIComponent(messageOf(err))}`);
    }
  });
  web.post("/competitors/:id/delete", (c) => {
    const id = idParam.parse(c.req.param("id"));
    const competitor = repo.getCompetitor(id);
    if (!competitor) return c.notFound();
    removeCompetitor(app, id, "user");
    return c.redirect(`/b/${competitor.business_id}`);
  });
  web.post("/pages/:id/scan", async (c) => {
    const id = idParam.parse(c.req.param("id"));
    const ctx = repo.pageContext(id);
    if (!ctx) return c.notFound();
    const outcome = await scanPage(app, id);
    return c.redirect(`/b/${ctx.business.id}?flash=${encodeURIComponent(`Scan result: ${outcome.status}${"message" in outcome ? ` (${outcome.message})` : ""}`)}`);
  });
  web.post("/pages/:id/delete", (c) => {
    const id = idParam.parse(c.req.param("id"));
    const ctx = repo.pageContext(id);
    if (!ctx) return c.notFound();
    removePage(app, id, "user");
    return c.redirect(`/b/${ctx.business.id}`);
  });
  web.get("/pages/:id", (c) => {
    const id = idParam.parse(c.req.param("id"));
    const ctx = repo.pageContext(id);
    if (!ctx) return c.notFound();
    const latest = repo.latestSnapshot(id);
    return c.html(<PageDetailPage page={ctx.page} competitor={ctx.competitor} snapshots={repo.listSnapshots(id)} changes={repo.listChanges(id)} latestText={latest?.text ?? null} />);
  });
  web.get("/insights/:id", (c) => {
    const insight = repo.getInsight(idParam.parse(c.req.param("id")));
    if (!insight) return c.notFound();
    const change = repo.getChange(insight.change_id);
    const ctx = change ? repo.pageContext(change.page_id) : undefined;
    if (!change || !ctx) return c.notFound();
    repo.markInsightRead(insight.id);
    return c.html(<InsightDetailPage insight={insight} change={change} page={ctx.page} competitor={ctx.competitor} business={ctx.business} />);
  });
  web.post("/insights/:id/reanalyze", async (c) => {
    const insight = repo.getInsight(idParam.parse(c.req.param("id")));
    if (!insight) return c.notFound();
    const change = repo.getChange(insight.change_id)!;
    const fresh: Insight | null = await app.pipeline.analyzeChange(change);
    return c.redirect(fresh ? `/insights/${fresh.id}` : `/b/${insight.business_id}?flash=analysis+failed`);
  });
  web.get("/events", (c) => {
    const day = new Date(Date.now() - 86_400_000).toISOString();
    return c.html(<EventsPage events={events.list({ limit: 200 })} counts={events.countsSince(day)} />);
  });

  // ---------------- Demo competitor site ----------------
  if (app.cfg.DEMO_SITE_ENABLED) {
    web.route("/demo", createDemoSite().app);
    // robots.txt must live at the origin root; the demo forbids its /demo/private/ area.
    web.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /demo/private/\n"));
  }

  return web;
}

function actor(c: { req: { header(name: string): string | undefined } }): string {
  // Agents identify themselves with X-Actor: agent:<name>. Auth comes later.
  const a = c.req.header("x-actor");
  return a && /^(agent|user):[\w.-]{1,64}$/.test(a) ? a : "user";
}

async function formObject(req: { parseBody(): Promise<Record<string, unknown>> }): Promise<Record<string, unknown>> {
  const body = await req.parseBody();
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== "" && v !== undefined));
}

function messageOf(err: unknown): string {
  if (err instanceof z.ZodError) return err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  return err instanceof Error ? err.message : String(err);
}

function summarise(statuses: string[]): string {
  const counts = new Map<string, number>();
  for (const s of statuses) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts].map(([k, v]) => `${v} ${k}`).join(", ") || "nothing to scan";
}
