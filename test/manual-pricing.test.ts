import { afterEach, describe, expect, it } from "vitest";
import { fixture, html, json, login, testApp } from "./helpers.js";
import type { Competitor } from "../src/db/repo.js";

const PRICES = "Пробне заняття: 300 грн\nАбонемент на 8 занять: 1900 грн";
const form = (body: string) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });

describe("owner-entered competitor prices", () => {
  let t: ReturnType<typeof testApp>;
  afterEach(() => t?.app.close());

  it("saves prices typed into the competitor card and shows them back", async () => {
    t = testApp();
    const f = await fixture(t);
    const saved = await html(t.web, `/competitors/${f.competitor.id}/pricing`, f.session, form(`pricing_notes=${encodeURIComponent(PRICES)}`));
    expect(saved.status).toBe(302);

    const page = await html(t.web, `/b/${f.business.id}?tab=competitors`, f.session);
    expect(page.text).toContain("1900 грн");
    expect(t.app.events.list({ type: "competitor.pricing_noted" })).toHaveLength(1);

    const cleared = await html(t.web, `/competitors/${f.competitor.id}/pricing`, f.session, form("pricing_notes="));
    expect(cleared.status).toBe(302);
    const after = await json<Competitor>(t.web, `/api/competitors/${f.competitor.id}`, { session: f.session });
    expect(after.body.pricing_notes).toBeNull();
  });

  it("rejects a wall of text instead of a price list", async () => {
    t = testApp();
    const f = await fixture(t);
    const res = await json(t.web, `/api/competitors/${f.competitor.id}/pricing`, { method: "POST", session: f.session, body: JSON.stringify({ pricing_notes: "x".repeat(4001) }) });
    expect(res.status).toBe(400);
  });

  it("belongs to the account that entered it", async () => {
    t = testApp();
    const f = await fixture(t);
    const stranger = await login(t.web, "stranger@rivalwatch.test");
    const res = await json(t.web, `/api/competitors/${f.competitor.id}/pricing`, { method: "POST", session: stranger, body: JSON.stringify({ pricing_notes: PRICES }) });
    expect(res.status).toBe(404);
  });

  it("reaches the landscape briefing even with no profile generated", async () => {
    t = testApp();
    const f = await fixture(t);
    await html(t.web, `/competitors/${f.competitor.id}/pricing`, f.session, form(`pricing_notes=${encodeURIComponent(PRICES)}`));
    await html(t.web, `/b/${f.business.id}/landscape`, f.session, { method: "POST" });
    const page = await html(t.web, `/b/${f.business.id}?tab=landscape`, f.session);
    expect(page.text).toContain("300 грн");
  });
});
