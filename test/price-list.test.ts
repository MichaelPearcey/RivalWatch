import { afterEach, describe, expect, it } from "vitest";
import { compare, parsePriceList } from "../src/price-list.js";
import type { Comparison } from "../src/price-list.js";
import type { PriceSubject } from "../src/web/actions.js";
import { fixture, html, json, login, testApp } from "./helpers.js";

const ANOLI = `Пробне заняття: 300 грн
Разове заняття: 400 грн
Абонемент на 8 занять (в одній групі): 1900 грн
Абонемент на 8 занять (у різні групи): 2400 грн
Безлімітний абонемент: 3500 грн

Джерело: https://www.instagram.com/p/DTsRF5tiB9B/`;

/** How a rendered aggregator page (instasport.ua) reads after extraction: one card per price. */
const RENDERED = [
  "Абонементи", "Перше пробне заняття", "Знайомство зі студією", "Кількість", "1 відвідування", "Термін дії", "1 день", "200.00 ₴", "Купити",
  "Разове заняття", "Тренуйся без абонементу", "Кількість", "1 відвідування", "350.00 ₴", "Купити",
  "8 занять", "Регулярні тренування", "Кількість", "8 відвідувань", "Термін дії", "28 днів", "1700.00 ₴", "Купити",
].join("\n");

const form = (body: string) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });

describe("price list parsing", () => {
  it("sorts a typed-in Ukrainian price list into kinds and keeps every variant", () => {
    const items = parsePriceList(ANOLI);
    expect(items.map((i) => [i.kind, i.classes, i.amount, i.currency])).toEqual([
      ["trial", null, 300, "UAH"],
      ["single", null, 400, "UAH"],
      ["pass", 8, 1900, "UAH"],
      ["pass", 8, 2400, "UAH"],
      ["unlimited", null, 3500, "UAH"],
    ]);
    expect(items[2]!.label).toBe("Абонемент на 8 занять (в одній групі)");
  });

  it("reads price cards from a rendered page by the lines above each amount", () => {
    const items = parsePriceList(RENDERED);
    expect(items.map((i) => [i.label, i.kind, i.classes, i.amount])).toEqual([
      ["Перше пробне заняття · Знайомство зі студією", "trial", null, 200],
      ["Разове заняття · Тренуйся без абонементу", "single", null, 350],
      ["8 занять · Регулярні тренування", "pass", 8, 1700],
    ]);
  });

  it("names an amount by the line right above it when features follow the price", () => {
    const items = parsePriceList(["Simple pricing", "Starter", "£19/month", "1 project", "Email support", "Professional", "£49/month", "Unlimited projects", "Priority support", "Professional (annual)", "£490/year"].join("\n"));
    expect(items.map((i) => [i.label, i.amount, i.period, i.kind])).toEqual([
      ["Starter", 19, "month", "other"],
      ["Professional", 49, "month", "other"],
      ["Professional (annual)", 490, "year", "other"],
    ]);
  });

  it("splits a line quoting several prices and ignores lines with no amount", () => {
    const items = parsePriceList("Пробне - 250 грн, разове - 350 грн\nНапрямки: High Heels, Jazz Funk");
    expect(items.map((i) => [i.label, i.kind, i.amount])).toEqual([
      ["Пробне", "trial", 250],
      ["разове", "single", 350],
    ]);
  });
});

describe("price comparison", () => {
  it("shows the cheapest per column only among prices in one currency and leaves gaps empty", () => {
    const c = compare([
      { subject: "mine", items: parsePriceList("Пробне заняття: 250 грн") },
      { subject: "anoli", items: parsePriceList(ANOLI) },
      { subject: "abroad", items: parsePriceList("Trial class: €10") },
    ]);
    expect(c.columns.map((col) => (col.kind === "pass" ? `pass:${col.classes}` : col.kind))).toEqual(["trial", "single", "pass:8", "unlimited"]);
    expect(c.lowest.trial).toEqual({ amount: 250, currency: "UAH" });
    expect(c.rows[1]!.cells["pass:8"]!.amount).toBe(1900);
    expect(c.rows[0]!.cells["pass:8"]).toBeUndefined();
    // Only one business quotes a single class: nothing to call cheapest.
    expect(c.lowest.single).toBeUndefined();
  });
});

describe("price comparison tab", () => {
  let t: ReturnType<typeof testApp>;
  afterEach(() => t?.app.close());

  it("puts the owner's business first, then competitors with owner-typed and website prices", async () => {
    t = testApp();
    const f = await fixture(t);
    await f.scan();
    await html(t.web, `/competitors/${f.competitor.id}/pricing`, f.session, form(`pricing_notes=${encodeURIComponent("Пробне заняття: 300 грн")}`));
    const insta = await json<{ competitor: { id: number } }>(t.web, `/api/businesses/${f.business.id}/competitors`, {
      method: "POST",
      session: f.session,
      body: JSON.stringify({ name: "OLIKA", website: "https://www.instagram.com/olika.dance.studio/", discover: false }),
    });
    await json(t.web, `/api/competitors/${insta.body.competitor.id}/pricing`, { method: "POST", session: f.session, body: JSON.stringify({ pricing_notes: "Пробне тренування: 200 грн" }) });

    const res = await json<Comparison<PriceSubject>>(t.web, `/api/businesses/${f.business.id}/prices`, { session: f.session });
    const [own, acme, olika] = res.body.rows;
    expect(own!.subject).toMatchObject({ kind: "own", name: "Bright Pixel", sources: ["manual"] });
    expect(own!.items.map((i) => i.amount)).toEqual([25, 55]);
    expect(acme!.subject.sources).toEqual(["manual", "website"]);
    expect(acme!.subject.checkedAt).not.toBeNull();
    expect(acme!.items.some((i) => i.amount === 19 && i.currency === "GBP")).toBe(true);
    // Nothing was read from Instagram: only what the owner typed in.
    expect(olika!.subject).toMatchObject({ sources: ["manual"], checkedAt: null });
    expect(olika!.items.map((i) => i.amount)).toEqual([200]);
    expect(res.body.lowest.trial).toEqual({ amount: 200, currency: "UAH" });

    const page = await html(t.web, `/b/${f.business.id}?tab=prices`, f.session);
    expect(page.text).toContain("Price comparison");
    expect(page.text).toContain("200 ₴");
  });

  it("saves and clears the owner's own prices from the tab", async () => {
    t = testApp();
    const f = await fixture(t);
    const saved = await html(t.web, `/b/${f.business.id}/pricing`, f.session, form(`pricing_notes=${encodeURIComponent("Разове заняття: 350 грн")}`));
    expect(saved.status).toBe(302);
    const after = await json<Comparison<PriceSubject>>(t.web, `/api/businesses/${f.business.id}/prices`, { session: f.session });
    expect(after.body.rows[0]!.items).toMatchObject([{ kind: "single", amount: 350, currency: "UAH" }]);

    await html(t.web, `/b/${f.business.id}/pricing`, f.session, form("pricing_notes="));
    const cleared = await json<Comparison<PriceSubject>>(t.web, `/api/businesses/${f.business.id}/prices`, { session: f.session });
    expect(cleared.body.rows[0]!.subject.sources).toEqual([]);
    expect(t.app.events.list({ type: "business.updated" }).length).toBeGreaterThanOrEqual(2);
  });

  it("belongs to the account that owns the business", async () => {
    t = testApp();
    const f = await fixture(t);
    const stranger = await login(t.web, "stranger@rivalwatch.test");
    expect((await json(t.web, `/api/businesses/${f.business.id}/prices`, { session: stranger })).status).toBe(404);
    expect((await json(t.web, `/api/businesses/${f.business.id}/pricing`, { method: "POST", session: stranger, body: JSON.stringify({ pricing_notes: "x 1 грн" }) })).status).toBe(404);
  });
});
