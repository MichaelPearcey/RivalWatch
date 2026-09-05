import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDigest, nextDigestTime } from "../src/digest.js";
import type { Business, Insight } from "../src/db/repo.js";
import { rankLinks } from "../src/sources/website/discover.js";
import { fixture, json, login, testApp } from "./helpers.js";

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

  it("suggests pages when a competitor is added and monitors only what the user accepts", async () => {
    const s = await login(t.web, "d@a.co");
    const b = (await json<{ id: number }>(t.web, "/api/businesses", { method: "POST", session: s, body: JSON.stringify({ name: "B" }) })).body;
    const r = await json<{ competitor: { id: number }; pages: unknown[]; suggestions: { id: number; kind: string; url: string }[] }>(t.web, `/api/businesses/${b.id}/competitors`, {
      method: "POST",
      session: s,
      body: JSON.stringify({ name: "Acme", website: `${t.base}/demo/` }),
    });
    expect(r.status).toBe(201);
    expect(r.body.pages).toHaveLength(1); // home only
    const kinds = r.body.suggestions.map((x) => x.kind).sort();
    expect(kinds).toEqual(["pricing", "products"]);

    const pricing = r.body.suggestions.find((x) => x.kind === "pricing")!;
    const products = r.body.suggestions.find((x) => x.kind === "products")!;
    const accepted = await json<{ url: string; kind: string }>(t.web, `/api/suggestions/${pricing.id}/accept`, { method: "POST", session: s });
    expect(accepted.status).toBe(201);
    expect(accepted.body).toMatchObject({ url: pricing.url, kind: "pricing" });
    expect((await json(t.web, `/api/suggestions/${products.id}/dismiss`, { method: "POST", session: s })).status).toBe(204);
    expect((await json(t.web, `/api/suggestions/${products.id}/dismiss`, { method: "POST", session: s })).status).toBe(409);

    const pages = (await json<{ kind: string }[]>(t.web, `/api/competitors/${r.body.competitor.id}/pages`, { session: s })).body;
    expect(pages.map((p) => p.kind).sort()).toEqual(["home", "pricing"]);
    expect((await json<unknown[]>(t.web, `/api/competitors/${r.body.competitor.id}/suggestions`, { session: s })).body).toEqual([]);
    const types = t.app.events.list({ limit: 100 }).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["discovery.completed", "page.suggested", "page.suggestion_accepted", "page.suggestion_dismissed"]));
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
