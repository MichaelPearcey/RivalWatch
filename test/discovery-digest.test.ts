import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDigest, nextDigestTime } from "../src/digest.js";
import type { Business, Insight } from "../src/db/repo.js";
import { rankLinks } from "../src/sources/website/discover.js";
import { fixture, html, json, login, testApp } from "./helpers.js";

describe("rankLinks", () => {
  const html = `<nav><a href="/">Home</a><a href="/pricing">Pricing</a><a href="/features">Features</a><a href="/blog">Blog</a>
    <a href="https://twitter.com/acme">Twitter</a><a href="/about">About</a><a href="/pricing#faq">FAQ</a><a href="mailto:x@y">mail</a></nav>`;

  it("finds same-site pricing/products/blog links, dedupes, ignores external and irrelevant links", () => {
    const found = rankLinks(html, "https://acme.example/");
    expect(found.map((f) => [f.kind, f.url])).toEqual([
      ["pricing", "https://acme.example/pricing"],
      ["products", "https://acme.example/features"],
      ["blog", "https://acme.example/blog"],
    ]);
    expect(found[0]!.score).toBeGreaterThan(found[2]!.score);
  });

  it("matches by link text when the path is opaque", () => {
    const found = rankLinks(`<a href="/p/123">Plans & pricing</a>`, "https://acme.example/");
    expect(found).toEqual([expect.objectContaining({ kind: "pricing", url: "https://acme.example/p/123" })]);
  });
});

describe("discovery flow", () => {
  let t: ReturnType<typeof testApp>;
  beforeEach(() => (t = testApp()));
  afterEach(() => t.app.close());

  it("auto-adopts confident pricing/products pages, leaves the rest as suggestions, and profiles the competitor", async () => {
    const s = await login(t.web, "d@a.co");
    t.app.repo.updateAccountPlan(t.app.repo.getUserByEmail("d@a.co")!.account_id, "pro");
    const b = (await json<{ id: number }>(t.web, "/api/businesses", { method: "POST", session: s, body: JSON.stringify({ name: "B" }) })).body;
    const r = await json<{ competitor: { id: number; profile_status: string }; pages: { kind: string }[]; suggestions: { id: number; kind: string; url: string }[] }>(t.web, `/api/businesses/${b.id}/competitors`, {
      method: "POST",
      session: s,
      body: JSON.stringify({ name: "Acme", website: `${t.base}/demo/` }),
    });
    expect(r.status).toBe(201);
    // Demo home links to /pricing and /products with matching link text: both are adopted automatically.
    expect(r.body.pages.map((p) => p.kind).sort()).toEqual(["home", "pricing", "products"]);
    expect(r.body.suggestions).toEqual([]);
    expect(r.body.competitor.profile_status).toBe("pending");
    const auto = t.app.events.list({ type: "page.suggestion_accepted" });
    expect(auto).toHaveLength(2);
    expect(auto.every((e) => e.actor === "system" && JSON.parse(e.payload).automatic === true)).toBe(true);

    // Background profiling completes (heuristic here, since no LLM in tests) and is exposed on the competitor.
    await t.app.idle();
    const comp = (await json<{ profile_status: string; profile: { summary: string; pricing_summary: string; provider: string; sources: string[] } }>(t.web, `/api/competitors/${r.body.competitor.id}`, { session: s })).body;
    expect(comp.profile_status).toBe("ready");
    expect(comp.profile.provider).toBe("heuristic");
    expect(comp.profile.summary).toContain("Acme");
    expect(comp.profile.pricing_summary).toContain("£49/month");
    expect(comp.profile.sources.length).toBeGreaterThanOrEqual(2);
    expect(t.app.events.list({ type: "competitor.profiled" })).toHaveLength(1);

    // The profile is shown on the business page and can be refreshed.
    const page = await html(t.web, `/b/${b.id}`, s);
    expect(page.text).toContain("About Acme");
    expect((await json(t.web, `/api/competitors/${r.body.competitor.id}/profile`, { method: "POST", session: s })).status).toBe(200);
  });

  it("manual suggestions still require confirmation", async () => {
    const s = await login(t.web, "m@a.co");
    const b = (await json<{ id: number }>(t.web, "/api/businesses", { method: "POST", session: s, body: JSON.stringify({ name: "B" }) })).body;
    // Free plan: 2 pages per competitor, so home + pricing are adopted and products stays a suggestion.
    const r = await json<{ competitor: { id: number }; pages: { kind: string }[]; suggestions: { id: number; kind: string }[] }>(t.web, `/api/businesses/${b.id}/competitors`, { method: "POST", session: s, body: JSON.stringify({ name: "Acme", website: `${t.base}/demo/` }) });
    expect(r.body.pages.map((p) => p.kind).sort()).toEqual(["home", "pricing"]);
    expect(r.body.suggestions.map((x) => x.kind)).toEqual(["products"]);
    const products = r.body.suggestions[0]!;
    expect((await json(t.web, `/api/suggestions/${products.id}/dismiss`, { method: "POST", session: s })).status).toBe(204);
    expect((await json(t.web, `/api/suggestions/${products.id}/dismiss`, { method: "POST", session: s })).status).toBe(409);
    expect((await json<unknown[]>(t.web, `/api/competitors/${r.body.competitor.id}/suggestions`, { session: s })).body).toEqual([]);
    await t.app.idle();
  });
});

describe("digests", () => {
  it("nextDigestTime finds the next weekday/hour strictly in the future", () => {
    // Wednesday 2026-09-02 10:00Z -> Monday 2026-09-07 08:00Z
    expect(nextDigestTime(new Date("2026-09-02T10:00:00Z"), 1, 8).toISOString()).toBe("2026-09-07T08:00:00.000Z");
    // Monday 07:59Z -> same day 08:00Z; Monday 08:00Z -> next Monday
    expect(nextDigestTime(new Date("2026-09-07T07:59:00Z"), 1, 8).toISOString()).toBe("2026-09-07T08:00:00.000Z");
    expect(nextDigestTime(new Date("2026-09-07T08:00:00Z"), 1, 8).toISOString()).toBe("2026-09-14T08:00:00.000Z");
  });

  it("buildDigest lists top insights and highlights monitoring problems", () => {
    const business = { id: 1, name: "B", account_id: 1 } as Business;
    const insight = { id: 5, competitor_id: 2, category: "pricing", importance: 4, headline: "Acme raised prices <b>", summary: "s", why_it_matters: "w", created_at: "2026-09-01T00:00:00Z" } as Insight;
    const d = buildDigest(business, [insight], { 2: "Acme" }, "https://rw.test", [{ url: "https://acme/x", status: "AUTH_REQUIRED" }]);
    expect(d.subject).toContain("1 competitor change");
    expect(d.text).toContain("https://rw.test/insights/5");
    expect(d.text).toContain("AUTH_REQUIRED: https://acme/x");
    expect(d.html).toContain("&lt;b&gt;");
    expect(d.insightCount).toBe(1);
  });

  it("sends a digest to account users via the mailer and records events; skips when nothing to report", async () => {
    const t = testApp();
    try {
      const f = await fixture(t);
      const account = t.app.repo.getUserByEmail(f.session.email)!.account_id;
      const business = t.app.repo.getBusiness(account, f.business.id)!;
      expect(business.next_digest_at).toBeTruthy();

      // Nothing to report yet -> skipped.
      const skipped = await t.app.digests.sendFor(business, "system", true);
      expect(skipped.sent).toBe(false);
      expect(t.app.events.list({ type: "digest.skipped" })).toHaveLength(1);

      await f.scan();
      await f.setDemo({ proPrice: 64 });
      await f.scan();
      await f.scan();
      const forced = await json<{ sent: boolean; insightCount: number; recipients: number }>(t.web, `/api/businesses/${f.business.id}/digest/send`, { method: "POST", session: f.session });
      expect(forced.body).toMatchObject({ sent: true, insightCount: 1, recipients: 1 });
      const email = t.app.repo.listEmails().find((e) => e.kind === "weekly_digest")!;
      expect(email.to_address).toBe(f.session.email);
      expect(email.body_text).toContain("£49/month → £64/month");
      expect(t.app.events.list({ type: "digest.sent" })[0]!.result).toBe("ok");

      // Due-run path: force due, run job, expect reschedule into the future.
      t.app.repo.setDigestSchedule(business.id, "2000-01-01T00:00:00Z", false);
      expect(await t.app.digests.runDue()).toBe(1);
      expect(t.app.repo.getBusiness(account, business.id)!.next_digest_at! > new Date().toISOString()).toBe(true);
    } finally {
      t.app.close();
    }
  });
});
