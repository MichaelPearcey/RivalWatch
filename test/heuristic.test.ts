import { describe, expect, it } from "vitest";
import { HeuristicAnalyzer, parseMoney } from "../src/ai/heuristic.js";
import type { AnalysisInput } from "../src/ai/types.js";

const base = (change: Partial<AnalysisInput["change"]>, kind: AnalysisInput["page"]["kind"] = "pricing"): AnalysisInput => ({
  business: { name: "Bright Pixel", description: "Design studio", pricing_notes: "Starter £25/month, Studio £55/month" },
  competitor: { name: "Acme", website: "https://acme.example" },
  page: { url: "https://acme.example/pricing", kind, title: null },
  change: { added: [], removed: [], signals: [], significance: 0.5, ...change },
});

describe("parseMoney", () => {
  it("parses symbols, thousands separators and periods", () => {
    expect(parseMoney("£49/month and $1,299.50/year and €9")).toEqual([
      { raw: "£49/month", symbol: "£", currency: "GBP", amount: 49, period: "month" },
      { raw: "$1,299.50/year", symbol: "$", currency: "USD", amount: 1299.5, period: "year" },
      { raw: "€9", symbol: "€", currency: "EUR", amount: 9, period: null },
    ]);
  });

  it("reads long ungrouped amounts whole and comma decimals as decimals", () => {
    expect(parseMoney("31200грн/рік and 9,99 EUR")).toEqual([
      { raw: "31200грн/рік", symbol: "грн", currency: "UAH", amount: 31200, period: "year" },
      { raw: "9,99EUR", symbol: "EUR", currency: "EUR", amount: 9.99, period: null },
    ]);
  });

  it("ignores units that merely start with a currency code", () => {
    expect(parseMoney("100 Gbps connectivity, 2,000 Gbps DDoS protection, 20 EURO-zone")).toEqual([]);
  });

  it("parses hryvnia written after the amount, in Ukrainian and Russian", () => {
    expect(parseMoney("800 грн/міс. і 12 000 грн/рік")).toEqual([
      { raw: "800грн/міс.", symbol: "грн", currency: "UAH", amount: 800, period: "month" },
      { raw: "12000грн/рік", symbol: "грн", currency: "UAH", amount: 12000, period: "year" },
    ]);
    expect(parseMoney("₴1 500/мес.")).toEqual([
      { raw: "₴1500/мес.", symbol: "₴", currency: "UAH", amount: 1500, period: "month" },
    ]);
  });
});

describe("HeuristicAnalyzer", () => {
  const a = new HeuristicAnalyzer();

  it("explains a price increase relative to the customer's nearest tier", async () => {
    const r = await a.analyze(base({ removed: ["£49/month"], added: ["£59/month"], signals: ["price"] }));
    expect(r.provider).toBe("heuristic");
    expect(r.draft.matters).toBe(true);
    expect(r.draft.category).toBe("pricing");
    expect(r.draft.importance).toBe(4);
    expect(r.draft.headline).toContain("£49/month → £59/month (+20%)");
    expect(r.draft.why_it_matters).toContain("7% above your nearest tier (£55/month)");
  });

  it("notes a new annual option the customer lacks", async () => {
    const r = await a.analyze(base({ added: ["£399/year"], signals: ["price"] }));
    expect(r.draft.headline).toContain("new price point");
    expect(r.draft.why_it_matters).toContain("annual option");
  });

  it("reports a hryvnia price move and does not compare it with pounds", async () => {
    const r = await a.analyze(base({ removed: ["800 грн/міс."], added: ["950 грн/міс."], signals: ["price"] }));
    expect(r.draft.headline).toContain("800 ₴/month → 950 ₴/month (+19%)");
    expect(r.draft.why_it_matters).not.toContain("£");
  });

  it("classifies promotions", async () => {
    const r = await a.analyze(base({ added: ["Launch offer: 20% off your first year"], signals: ["promo", "percentage"] }, "home"));
    expect(r.draft.category).toBe("promotion");
    expect(r.draft.matters).toBe(true);
  });

  it("names a launched product from the shortest heading-like line", async () => {
    const r = await a.analyze(base({ added: ["Acme Invoice", "Now available. Introducing our newest product."], signals: ["launch"] }, "products"));
    expect(r.draft.category).toBe("product");
    expect(r.draft.headline).toBe('Acme launched "Acme Invoice"');
  });

  it("marks signal-less small edits as noise", async () => {
    const r = await a.analyze(base({ removed: ["We love our customers"], added: ["We adore our customers"] }, "home"));
    expect(r.draft.matters).toBe(false);
    expect(r.draft.category).toBe("noise");
  });

  it("treats large rewrites of the home page as positioning", async () => {
    const r = await a.analyze(base({ removed: ["a", "b", "c"], added: ["x", "y", "z"], signals: ["large_edit"] }, "home"));
    expect(r.draft.category).toBe("positioning");
    expect(r.draft.matters).toBe(true);
  });
});
