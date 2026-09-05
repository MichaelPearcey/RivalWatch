import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Business, Competitor, Insight, MonitoredPage } from "../src/db/repo.js";
import type { EventRow } from "../src/events.js";
import { json, testApp } from "./helpers.js";

/**
 * The core loop, end to end, through the public JSON API:
 * define business + competitor -> fetch -> snapshot -> detect -> analyse -> insight.
 */
describe("core loop (API, in-memory, demo competitor)", () => {
  let t: ReturnType<typeof testApp>;
  let business: Business;
  let pages: MonitoredPage[];

  beforeEach(async () => {
    t = testApp();
    business = (
      await json<Business>(t.web, "/api/businesses", {
        method: "POST",
        body: JSON.stringify({ name: "Bright Pixel", plan: "pro", pricing_notes: "Starter £25/month, Studio £55/month" }),
      })
    ).body;
    const created = await json<{ competitor: Competitor; pages: MonitoredPage[] }>(t.web, `/api/businesses/${business.id}/competitors`, {
      method: "POST",
      headers: { "x-actor": "agent:test-harness" },
      body: JSON.stringify({
        name: "Acme Studio",
        website: `${t.base}/demo/`,
        pages: [
          { url: `${t.base}/demo/`, kind: "home" },
          { url: `${t.base}/demo/pricing`, kind: "pricing" },
          { url: `${t.base}/demo/products`, kind: "products" },
        ],
      }),
    });
    expect(created.status).toBe(201);
    pages = created.body.pages;
  });
  afterEach(() => t.app.close());

  const scan = () => json<{ page_id: number; status: string }[]>(t.web, `/api/businesses/${business.id}/scan`, { method: "POST" });
  const setDemo = (patch: Record<string, unknown>) => json(t.web, "/demo/state", { method: "POST", body: JSON.stringify(patch) });
  const insights = (noise = false) => json<Insight[]>(t.web, `/api/businesses/${business.id}/insights${noise ? "?include_noise=1" : ""}`);

  it("takes a baseline, ignores churn, then produces a pricing insight when the price changes", async () => {
    const first = await scan();
    expect(first.body.map((r) => r.status)).toEqual(["first_snapshot", "first_snapshot", "first_snapshot"]);

    const second = await scan();
    // Pricing & products pages are identical after normalisation; home rotates testimonials.
    expect(second.body.find((r) => r.page_id === pages[1]!.id)?.status).toBe("unchanged");
    expect((await insights()).body).toHaveLength(0);

    await setDemo({ proPrice: 59, annualPrice: 399 });
    const third = await scan();
    const pricing = third.body.find((r) => r.page_id === pages[1]!.id);
    expect(pricing?.status).toBe("changed");

    const list = (await insights()).body;
    expect(list).toHaveLength(1);
    const insight = list[0]!;
    expect(insight.category).toBe("pricing");
    expect(insight.matters).toBe(1);
    expect(insight.headline).toContain("£49/month → £59/month (+20%)");
    expect(insight.why_it_matters).toContain("7% above your nearest tier");
    expect(insight.provider).toBe("heuristic");

    // Evidence is retrievable.
    const detail = await json<Insight & { change: { added_json: string } }>(t.web, `/api/insights/${insight.id}`);
    expect(JSON.parse(detail.body.change.added_json)).toContain("£59/month");
  });

  it("detects a product launch and records the whole trail as structured events", async () => {
    await scan();
    await setDemo({ newProduct: "Acme Invoice" });
    await scan();
    const list = (await insights()).body;
    expect(list.some((i) => i.category === "product" && i.headline.includes("Acme Invoice"))).toBe(true);

    const events = (await json<EventRow[]>(t.web, "/api/events?limit=500")).body;
    const types = new Set(events.map((e) => e.type));
    for (const expected of ["business.created", "competitor.added", "page.added", "page.fetched", "snapshot.created", "page.unchanged", "change.detected", "insight.generated"]) {
      expect(types, `missing event ${expected}`).toContain(expected);
    }
    expect(events.find((e) => e.type === "competitor.added")?.actor).toBe("agent:test-harness");

    const stats = (await json<{ totals: { insights: number; changes: number } }>(t.web, "/api/stats")).body;
    expect(stats.totals.changes).toBeGreaterThanOrEqual(1);
    expect(stats.totals.insights).toBeGreaterThanOrEqual(1);
  });

  it("does not fetch pages disallowed by robots.txt", async () => {
    const created = await json<MonitoredPage>(t.web, `/api/competitors/${pages[0]!.competitor_id}/pages`, {
      method: "POST",
      body: JSON.stringify({ url: `${t.base}/demo/private/secret`, kind: "other" }),
    });
    expect(created.status).toBe(201);
    const result = await json<{ status: string; message: string }>(t.web, `/api/pages/${created.body.id}/scan`, { method: "POST" });
    expect(result.body.status).toBe("blocked");
    expect(t.app.repo.getPage(created.body.id)?.last_status).toBe("blocked");
    expect(t.app.events.list({ type: "page.blocked_by_robots" })).toHaveLength(1);
  });

  it("re-running a scan with identical content is idempotent (no duplicate snapshots or changes)", async () => {
    await scan();
    await setDemo({ proPrice: 79 });
    await scan();
    await scan();
    await scan();
    const snaps = (await json<unknown[]>(t.web, `/api/pages/${pages[1]!.id}/snapshots`)).body;
    expect(snaps).toHaveLength(2);
    expect(t.app.repo.listChanges(pages[1]!.id)).toHaveLength(1);
  });

  it("enforces plan limits as data, not code", async () => {
    const free = (await json<Business>(t.web, "/api/businesses", { method: "POST", body: JSON.stringify({ name: "Tiny", plan: "free" }) })).body;
    const add = (n: number) => json<{ error?: string }>(t.web, `/api/businesses/${free.id}/competitors`, { method: "POST", body: JSON.stringify({ name: `C${n}`, website: `https://c${n}.example/` }) });
    expect((await add(1)).status).toBe(201);
    expect((await add(2)).status).toBe(201);
    const third = await add(3);
    expect(third.status).toBe(402);
    expect(third.body.error).toMatch(/allows 2 competitors/);
  });

  it("scheduler processes due pages once and reschedules them", async () => {
    const first = await json<{ processed: number }>(t.web, "/api/scheduler/tick", { method: "POST" });
    expect(first.body.processed).toBe(3);
    for (const p of pages) {
      const row = t.app.repo.getPage(p.id)!;
      expect(row.last_status).toBe("ok");
      expect(new Date(row.next_check_at).getTime()).toBeGreaterThan(Date.now() + 60_000);
    }
    const second = await json<{ processed: number }>(t.web, "/api/scheduler/tick", { method: "POST" });
    expect(second.body.processed).toBe(0);
    expect(t.app.scheduler.getStatus().ticks).toBe(2);
  });

  it("backs off after fetch failures", async () => {
    const page = t.app.repo.createPage({ competitor_id: pages[0]!.competitor_id, url: `${t.base}/nope`, kind: "other", check_interval_minutes: 60 });
    const before = Date.now();
    await json(t.web, `/api/pages/${page.id}/scan`, { method: "POST" });
    const row = t.app.repo.getPage(page.id)!;
    expect(row.last_status).toBe("error");
    expect(row.consecutive_failures).toBe(1);
    // 60 min * 2^1 backoff = ~120 min ahead
    expect(new Date(row.next_check_at).getTime() - before).toBeGreaterThan(110 * 60_000);
  });

  it("serves the HTML dashboard and insight pages", async () => {
    await scan();
    await setDemo({ promo: "Summer sale: 25% off" });
    await scan();
    const dash = await t.web.request(`${t.base}/b/${business.id}`);
    expect(dash.status).toBe(200);
    const html = await dash.text();
    expect(html).toContain("Acme Studio");
    expect(html).toContain("running a promotion");
    const id = (await insights()).body[0]!.id;
    const page = await t.web.request(`${t.base}/insights/${id}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Summer sale");
  });
});
