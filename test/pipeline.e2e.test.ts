import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EventRow } from "../src/events.js";
import { fixture, html, json, testApp } from "./helpers.js";

/**
 * The core loop, end to end, through the public JSON API with a real session:
 * business + competitor -> fetch -> snapshot -> detect -> confirm -> analyse -> insight.
 */
describe("core loop (API, in-memory, demo competitor)", () => {
  let t: ReturnType<typeof testApp>;
  let f: Awaited<ReturnType<typeof fixture>>;

  beforeEach(async () => {
    t = testApp();
    f = await fixture(t);
  });
  afterEach(() => t.app.close());

  const pricingPage = () => f.pages.find((p) => p.kind === "pricing")!;

  it("takes a baseline, holds a change for confirmation, then produces a pricing insight once confirmed", async () => {
    const first = await f.scan();
    expect(first.body.map((r) => r.status)).toEqual(["first_snapshot", "first_snapshot", "first_snapshot"]);

    const second = await f.scan();
    expect(second.body.find((r) => r.page_id === pricingPage().id)?.status).toBe("unchanged");

    await f.setDemo({ proPrice: 59, annualPrice: 399 });
    const third = await f.scan();
    expect(third.body.find((r) => r.page_id === pricingPage().id)?.status).toBe("pending_confirmation");
    expect((await f.insights()).body).toHaveLength(0);

    const fourth = await f.scan();
    expect(fourth.body.find((r) => r.page_id === pricingPage().id)?.status).toBe("changed");

    const list = (await f.insights()).body;
    expect(list).toHaveLength(1);
    const insight = list[0]!;
    expect(insight.category).toBe("pricing");
    expect(insight.matters).toBe(1);
    expect(insight.headline).toContain("£49/month → £59/month (+20%)");
    expect(insight.why_it_matters).toContain("7% above your nearest tier");
    expect(insight.provider).toBe("heuristic");

    const detail = await json<{ change: { added_json: string; analysis_status: string; confirmed_at: string } }>(t.web, `/api/insights/${insight.id}`, { session: f.session });
    expect(JSON.parse(detail.body.change.added_json)).toContain("£59/month");
    expect(detail.body.change.analysis_status).toBe("done");
    expect(detail.body.change.confirmed_at).toBeTruthy();
  });

  it("discards a change that reverts before confirmation (A/B test or glitch)", async () => {
    await f.scan();
    await f.setDemo({ promo: "Flash sale: 30% off" });
    const detected = await f.scan();
    expect(detected.body.filter((r) => r.status === "pending_confirmation").length).toBeGreaterThan(0);
    await f.setDemo({ promo: null });
    const reverted = await f.scan();
    expect(reverted.body.filter((r) => r.status === "reverted").length).toBeGreaterThan(0);
    expect((await f.insights(true)).body).toHaveLength(0);
    const events = t.app.events.list({ type: "change.discarded_unconfirmed" });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.result).toBe("skipped");
  });

  it("honours the confirmation delay", async () => {
    t.app.close();
    t = testApp({ CONFIRM_DELAY_MINUTES: 60 });
    f = await fixture(t);
    await f.scan();
    await f.setDemo({ proPrice: 99 });
    await f.scan();
    const again = await f.scan();
    expect(again.body.find((r) => r.page_id === pricingPage().id)?.status).toBe("awaiting_confirmation");
    expect((await f.insights()).body).toHaveLength(0);
  });

  it("detects a product launch and records the whole trail as tenant-scoped structured events", async () => {
    await f.scan();
    await f.setDemo({ newProduct: "Acme Invoice" });
    await f.scan();
    await f.scan();
    const list = (await f.insights()).body;
    expect(list.some((i) => i.category === "product" && i.headline.includes("Acme Invoice"))).toBe(true);

    const events = (await json<EventRow[]>(t.web, "/api/events?limit=500", { session: f.session })).body;
    const types = new Set(events.map((e) => e.type));
    for (const expected of ["business.created", "competitor.added", "page.added", "page.fetched", "snapshot.created", "page.unchanged", "change.detected", "change.pending_confirmation", "change.confirmed", "insight.generated"]) {
      expect(types, `missing event ${expected}`).toContain(expected);
    }
    expect(events.every((e) => e.account_id === t.app.repo.getUserByEmail(f.session.email)!.account_id)).toBe(true);
    const created = events.find((e) => e.type === "competitor.added")!;
    expect(created.actor).toMatch(/^user:\d+$/);
    expect(created.result).toBe("ok");
    expect(created.risk_level).toBe("low");
  });

  it("marks robots-blocked pages as ROBOTS_BLOCKED and never fetches them", async () => {
    const created = await json<{ id: number }>(t.web, `/api/competitors/${f.competitor.id}/pages`, { method: "POST", session: f.session, body: JSON.stringify({ url: `${t.base}/demo/private/secret`, kind: "other" }) });
    expect(created.status).toBe(201);
    const result = await json<{ status: string; pageStatus: string }>(t.web, `/api/pages/${created.body.id}/scan`, { method: "POST", session: f.session });
    expect(result.body.status).toBe("fetch_failed");
    expect(result.body.pageStatus).toBe("ROBOTS_BLOCKED");
    const page = (await json<{ status: string; status_message: string }>(t.web, `/api/pages/${created.body.id}`, { session: f.session })).body;
    expect(page.status).toBe("ROBOTS_BLOCKED");
    expect(t.app.events.list({ type: "page.status_changed" })[0]!.result).toBe("failed");
  });

  it("classifies fetch failures into explicit statuses and backs off", async () => {
    const add = (url: string) => json<{ id: number }>(t.web, `/api/competitors/${f.competitor.id}/pages`, { method: "POST", session: f.session, body: JSON.stringify({ url, kind: "other" }) });
    const scan = (id: number) => json<{ pageStatus: string }>(t.web, `/api/pages/${id}/scan`, { method: "POST", session: f.session });
    // Plan allows 5 pages per competitor; fixture uses 3.
    const missing = (await add(`${t.base}/demo/does-not-exist`)).body.id;
    const forbidden = (await add(`${t.base}/demo/status/403`)).body.id;
    expect((await scan(missing)).body.pageStatus).toBe("FETCH_ERROR");
    expect((await scan(forbidden)).body.pageStatus).toBe("AUTH_REQUIRED");
    const row = t.app.repo.getPageAny(missing)!;
    expect(row.consecutive_failures).toBe(1);
    expect(new Date(row.next_check_at).getTime() - Date.now()).toBeGreaterThan(row.check_interval_minutes * 60_000 * 1.9);
  });

  it("pausing a page sets PAUSED and excludes it from scans", async () => {
    const pid = pricingPage().id;
    const paused = await json<{ status: string; enabled: number }>(t.web, `/api/pages/${pid}/pause`, { method: "POST", session: f.session });
    expect(paused.body.status).toBe("PAUSED");
    const scan = await f.scan();
    expect(scan.body.find((r) => r.page_id === pid)).toBeUndefined();
    const resumed = await json<{ status: string }>(t.web, `/api/pages/${pid}/resume`, { method: "POST", session: f.session });
    expect(resumed.body.status).toBe("ACTIVE");
  });

  it("is idempotent: repeated identical content creates no duplicate snapshots or changes", async () => {
    await f.scan();
    await f.setDemo({ proPrice: 79 });
    await f.scan();
    await f.scan();
    await f.scan();
    await f.scan();
    const snaps = (await json<unknown[]>(t.web, `/api/pages/${pricingPage().id}/snapshots`, { session: f.session })).body;
    expect(snaps).toHaveLength(2);
    expect(t.app.repo.listChanges(t.app.repo.getUserByEmail(f.session.email)!.account_id, pricingPage().id)).toHaveLength(1);
  });

  it("records explicit user feedback on insights", async () => {
    await f.scan();
    await f.setDemo({ proPrice: 69 });
    await f.scan();
    await f.scan();
    const insight = (await f.insights()).body[0]!;
    const fb = await json<{ verdict: string }>(t.web, `/api/insights/${insight.id}/feedback`, { method: "POST", session: f.session, body: JSON.stringify({ verdict: "incorrect", comment: "The annual price is wrong" }) });
    expect(fb.status).toBe(201);
    expect(fb.body.verdict).toBe("incorrect");
    // Changing your mind updates rather than duplicates.
    await json(t.web, `/api/insights/${insight.id}/feedback`, { method: "POST", session: f.session, body: JSON.stringify({ verdict: "useful" }) });
    const again = (await f.insights()).body[0]!;
    expect(again.feedback).toEqual([expect.objectContaining({ verdict: "useful" })]);
    expect(t.app.events.list({ type: "insight.feedback" })).toHaveLength(2);
    const bad = await json(t.web, `/api/insights/${insight.id}/feedback`, { method: "POST", session: f.session, body: JSON.stringify({ verdict: "meh" }) });
    expect(bad.status).toBe(400);
  });

  it("scheduler processes due pages once, reschedules them, and runs jobs", async () => {
    const admin = await (await import("./helpers.js")).login(t.web, "admin@rivalwatch.test");
    const first = await json<{ processed: number }>(t.web, "/api/admin/scheduler/tick", { method: "POST", session: admin });
    expect(first.body.processed).toBe(3);
    const second = await json<{ processed: number }>(t.web, "/api/admin/scheduler/tick", { method: "POST", session: admin });
    expect(second.body.processed).toBe(0);
    expect(t.app.scheduler.getStatus().ticks).toBe(2);
  });

  it("serves the HTML dashboard, insight and page views to the owner", async () => {
    await f.scan();
    await f.setDemo({ promo: "Summer sale: 25% off" });
    await f.scan();
    await f.scan();
    const dash = await html(t.web, `/b/${f.business.id}`, f.session);
    expect(dash.status).toBe(200);
    expect(dash.text).toContain("Acme Studio");
    expect(dash.text).toContain("running a promotion");
    expect(dash.text).toContain("ACTIVE");
    const id = (await f.insights()).body[0]!.id;
    const page = await html(t.web, `/insights/${id}`, f.session);
    expect(page.status).toBe(200);
    expect(page.text).toContain("Summer sale");
    expect(page.text).toContain("Was this helpful?");
  });
});
