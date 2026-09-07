import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildUserPrompt } from "../src/ai/prompt.js";
import { buildDigest } from "../src/digest.js";
import type { Business, Insight } from "../src/db/repo.js";
import { en } from "../src/i18n/en.js";
import { LOCALES, fromAcceptLanguage, resolveLocale, translator } from "../src/i18n/index.js";
import { fixture, html, json, login, testApp } from "./helpers.js";

describe("translations", () => {
  it("every locale has every key and no empty strings; placeholders match English", async () => {
    for (const l of LOCALES) {
      const t = translator(l);
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        const s = t(key);
        expect(s.length, `${l}:${key}`).toBeGreaterThan(0);
        const ph = (x: string) => (x.match(/\{[a-z]+\}/g) ?? []).sort().join(",");
        expect(ph(s), `${l}:${key} placeholders`).toBe(ph(en[key]));
      }
    }
  });

  it("interpolates placeholders and falls back to English for unknown locales", () => {
    expect(translator("de").plural("pricing.competitors", 10)).toBe("Bis zu 10 Wettbewerber");
    expect(translator("uk")("dash.plan", { plan: "Pro" })).toBe("План Pro");
    expect(translator("xx" as never)("nav.pricing")).toBe("Pricing");
  });

  it("picks the plural form the reader's language needs", () => {
    const uk = translator("uk");
    expect(uk.plural("ov.competitors", 1)).toBe("конкурент під наглядом");
    expect(uk.plural("ov.competitors", 2)).toBe("конкуренти під наглядом");
    expect(uk.plural("ov.competitors", 5)).toBe("конкурентів під наглядом");
    expect(translator("ru").plural("pricing.every.days", 1)).toBe("Проверка каждый день");
    expect(uk.plural("profile.sources", 1)).toBe("На основі 1 сторінки");
    expect(uk.plural("profile.sources", 2)).toBe("На основі 2 сторінок");
    expect(translator("en").plural("pricing.pages", 1)).toBe("1 page per competitor");
    expect(translator("en").plural("pricing.pages", 3)).toBe("3 pages per competitor");
  });

  it("resolves locale: query > cookie > user > Accept-Language > default", () => {
    expect(fromAcceptLanguage("fr-CH,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(fromAcceptLanguage("pt-BR,pt;q=0.9")).toBe("en");
    expect(fromAcceptLanguage("de;q=0.5,es;q=0.9")).toBe("es");
    expect(resolveLocale({ cookie: "ru", user: "de", acceptLanguage: "fr" })).toBe("ru");
    expect(resolveLocale({ user: "de", acceptLanguage: "fr" })).toBe("de");
    expect(resolveLocale({ acceptLanguage: "uk-UA" })).toBe("uk");
    expect(resolveLocale({ cookie: "zz", user: "yy" })).toBe("en");
  });
});

describe("language in the app", () => {
  let t: ReturnType<typeof testApp>;
  beforeEach(() => (t = testApp()));
  afterEach(() => t.app.close());

  it("public pages follow Accept-Language, the switcher sets a cookie, and lang attribute follows", async () => {
    const de = await t.web.request(`${t.base}/`, { headers: { "accept-language": "de-DE,de;q=0.9" } });
    const deHtml = await de.text();
    expect(deHtml).toContain('<html lang="de">');
    expect(deHtml).toContain("Ihre Konkurrenz bewegt.");

    const sw = await t.web.request(`${t.base}/lang?lang=uk`, { headers: { referer: `${t.base}/pricing` } });
    expect(sw.status).toBe(302);
    expect(sw.headers.get("location")).toBe(`${t.base}/pricing`);
    const cookie = (sw.headers.get("set-cookie") ?? "").split(";")[0]!;
    expect(cookie).toBe("rw_lang=uk");
    const uk = await (await t.web.request(`${t.base}/pricing`, { headers: { cookie } })).text();
    expect(uk).toContain('<html lang="uk">');
    expect(uk).toContain("Прості,");

    // Unknown language is ignored; external referer is not followed.
    const bad = await t.web.request(`${t.base}/lang?lang=klingon`, { headers: { referer: "https://evil.example/" } });
    expect(bad.headers.get("location")).toBe("/");
    expect(bad.headers.get("set-cookie")).toBeNull();
  });

  it("signed-in users get their saved language everywhere, including the dashboard and settings", async () => {
    const s = await login(t.web, "fr@a.co");
    expect((await json<{ locale: string }>(t.web, "/api/me", { method: "PATCH", session: s, body: JSON.stringify({ locale: "fr" }) })).status).toBe(200);
    const dash = await html(t.web, "/", s);
    expect(dash.text).toContain("Vos entreprises");
    const settings = await html(t.web, "/settings", s);
    expect(settings.text).toContain("Paramètres");
    expect(settings.text).toContain('<option value="fr" selected');
    expect((await json(t.web, "/api/me", { method: "PATCH", session: s, body: JSON.stringify({ locale: "klingon" }) })).status).toBe(400);
    // The switcher also persists to the user when signed in.
    await t.web.request(`${t.base}/lang?lang=es`, { headers: { cookie: s.cookie } });
    expect(t.app.repo.getUserByEmail("fr@a.co")!.locale).toBe("es");
  });

  it("keeps the language chosen before signing up, so the first AI output is in it", async () => {
    const res = await t.web.request(`${t.base}/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: "rw_lang=uk" },
      body: new URLSearchParams({ email: "new-uk@a.co", password: "correct horse battery staple" }).toString(),
    });
    expect(res.status).toBe(302);
    expect(t.app.repo.getUserByEmail("new-uk@a.co")!.locale).toBe("uk");
  });

  it("shows browsers a translated sentence instead of raw validation diagnostics", async () => {
    const s = await login(t.web, "val@a.co");
    const res = await t.web.request(`${t.base}/b`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html", cookie: `${s.cookie}; rw_lang=uk`, referer: `${t.base}/` },
      body: new URLSearchParams({ name: "   " }).toString(),
    });
    expect(res.status).toBe(302);
    const flash = decodeURIComponent(new URL(res.headers.get("location")!, t.base).searchParams.get("flash") ?? "");
    expect(flash).toContain("Перевірте, будь ласка, форму");

    // API clients still get the useful detail.
    const api = await t.web.request(`${t.base}/api/businesses`, { method: "POST", headers: { "content-type": "application/json", cookie: s.cookie }, body: JSON.stringify({ name: "   " }) });
    expect(api.status).toBe(400);
    expect(await api.text()).toContain("validation failed");
  });

  it("legal pages stay English but carry a notice in other languages", async () => {
    const page = await (await t.web.request(`${t.base}/privacy`, { headers: { "accept-language": "es" } })).text();
    expect(page).toContain("Privacy Policy");
    expect(page).toContain("la versión inglesa es la vinculante");
  });

  it("the analyser is told which language to write in, based on the account owner's locale", async () => {
    const prompt = buildUserPrompt({ language: "Ukrainian", business: { name: "B", description: null, pricing_notes: null }, competitor: { name: "A", website: "x" }, page: { url: "u", kind: "pricing", title: null }, change: { added: [], removed: [], signals: [], significance: 1 } });
    expect(prompt).toContain("in Ukrainian");
    expect(prompt).toContain("Keep the JSON keys and the category value in English");

    const f = await fixture(t, "owner-ru@a.co");
    t.app.repo.setUserLocale(t.app.repo.getUserByEmail("owner-ru@a.co")!.id, "ru");
    let seen: string | undefined;
    (t.app as unknown as { analyzer: { analyze: (i: { language?: string }) => Promise<unknown> } }).analyzer.analyze = async (i) => {
      seen = i.language;
      return { draft: { matters: true, category: "pricing", importance: 3, headline: "h", summary: "s", why_it_matters: "w" }, provider: "fake", model: null, inputTokens: null, outputTokens: null, estimatedCostUsd: 0 };
    };
    await f.scan();
    await f.setDemo({ proPrice: 61 });
    await f.scan();
    await f.scan();
    expect(seen).toBe("Russian");
  });

  it("digest emails are rendered in each recipient's language", () => {
    const business = { id: 1, name: "Bright Pixel", account_id: 1 } as Business;
    const insight = { id: 5, competitor_id: 2, category: "pricing", importance: 4, headline: "h", summary: "s", why_it_matters: "w", created_at: "2026-09-01T00:00:00Z" } as Insight;
    const de = buildDigest(business, [insight], { 2: "Acme" }, "https://rw.test", [], translator("de"));
    expect(de.subject).toBe("RivalWatch wöchentlich: 1 Wettbewerber-Änderung(en) für Bright Pixel");
    expect(de.text).toContain("Warum es wichtig ist:");
    const uk = buildDigest(business, [], { }, "https://rw.test", [{ url: "https://x", status: "AUTH_REQUIRED" }], translator("uk"));
    expect(uk.subject).toContain("все спокійно");
    expect(uk.text).toContain("Проблеми моніторингу");
  });
});
