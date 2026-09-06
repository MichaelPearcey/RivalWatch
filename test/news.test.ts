import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MessagesClient } from "../src/agents/runner.js";
import { buildClassifyPrompt, heuristicClassify } from "../src/news/classify.js";
import { parseRss } from "../src/news/source.js";
import { externalHosts, fixture, html, json, testApp } from "./helpers.js";

const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>"Acme Studio" - Google News</title>
<item><title>Acme Studio raises $125 million from NVIDIA to expand design AI - TechCrunch</title><link>https://news.google.com/rss/articles/AAA</link><pubDate>Fri, 05 Sep 2026 09:00:00 GMT</pubDate><source url="https://techcrunch.com">TechCrunch</source><description>&lt;a href="x"&gt;Acme Studio raises $125 million&lt;/a&gt; The round values the company at $1bn.</description></item>
<item><title>Acme Studio adds dark mode - Design Weekly</title><link>https://news.google.com/rss/articles/BBB</link><pubDate>Thu, 04 Sep 2026 12:00:00 GMT</pubDate><source url="https://designweekly.example">Design Weekly</source></item>
<item><title>Acme Brick Company opens new plant in Texas - Local News</title><link>https://news.google.com/rss/articles/CCC</link><pubDate>Wed, 03 Sep 2026 12:00:00 GMT</pubDate><source url="https://local.example">Local News</source></item>
</channel></rss>`;

describe("news parsing and heuristic classification", () => {
  it("parses Google News RSS: title cleanup, publisher, date, snippet", () => {
    const items = parseRss(RSS);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ title: "Acme Studio raises $125 million from NVIDIA to expand design AI", source: "TechCrunch", url: "https://news.google.com/rss/articles/AAA", publishedAt: "2026-09-05T09:00:00.000Z" });
    expect(items[0]!.snippet).toContain("values the company at $1bn");
    expect(items[1]!.snippet).toBeNull();
  });

  it("heuristic: relevance by name, magnitude from vocabulary + money", () => {
    const v = heuristicClassify("Acme Studio", parseRss(RSS));
    expect(v[0]).toMatchObject({ about_competitor: true, category: "funding", magnitude: 4 });
    expect(v[1]).toMatchObject({ about_competitor: true, magnitude: 2 });
    expect(v[2]).toMatchObject({ about_competitor: false, magnitude: 1 });
  });

  it("prompt includes profile for disambiguation and the requested language", () => {
    const p = buildClassifyPrompt({ name: "Acme", website: "https://acme", profile: "Design tools for freelancers" }, { name: "Bright Pixel", description: "design studio" }, parseRss(RSS), "Ukrainian");
    expect(p).toContain("Language for summary/why_it_matters: Ukrainian");
    expect(p).toContain("Profile: Design tools for freelancers");
    expect(p).toContain("0. [2026-09-05]");
  });
});

describe("news monitor", () => {
  let t: ReturnType<typeof testApp>;
  beforeEach(() => {
    externalHosts["news.google.com"] = (url) => {
      expect(url.pathname).toBe("/rss/search");
      expect(url.searchParams.get("q")).toBe('"Acme Studio"');
      return new Response(RSS, { status: 200, headers: { "content-type": "application/rss+xml" } });
    };
  });
  afterEach(() => {
    delete externalHosts["news.google.com"];
    t?.app.close();
  });

  it("fetches, dedupes, classifies (heuristic without LLM), surfaces big news, alerts on Pro, and includes it in the digest", async () => {
    t = testApp();
    const f = await fixture(t); // Pro plan -> alerts enabled
    const acct = t.app.repo.getUserByEmail(f.session.email)!.account_id;

    const r1 = await json<{ fetched: number; added: number; big: { title: string }[]; provider: string }>(t.web, `/api/competitors/${f.competitor.id}/news/refresh`, { method: "POST", session: f.session });
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ fetched: 3, added: 3, provider: "heuristic" });
    expect(r1.body.big).toHaveLength(1);
    expect(r1.body.big[0]!.title).toContain("$125 million");

    // Second refresh: nothing new, nothing re-alerted.
    const r2 = await json<{ added: number; big: unknown[] }>(t.web, `/api/competitors/${f.competitor.id}/news/refresh`, { method: "POST", session: f.session });
    expect(r2.body.added).toBe(0);
    expect(r2.body.big).toHaveLength(0);

    const relevant = (await json<{ title: string; magnitude: number }[]>(t.web, `/api/competitors/${f.competitor.id}/news`, { session: f.session })).body;
    expect(relevant).toHaveLength(2); // the brick company is excluded
    const big = (await json<{ title: string }[]>(t.web, `/api/businesses/${f.business.id}/news/big`, { session: f.session })).body;
    expect(big).toHaveLength(1);

    // Alert email went to the verified owner; events recorded.
    const alert = t.app.repo.listEmails().find((e) => e.kind === "news_alert")!;
    expect(alert.to_address).toBe(f.session.email);
    expect(alert.subject).toContain("Acme Studio");
    expect(t.app.events.list({ type: "news.big" })).toHaveLength(1);
    expect(t.app.events.list({ type: "alert.sent" })[0]!.result).toBe("ok");
    expect(t.app.repo.listNews(acct, f.competitor.id).find((n) => n.magnitude === 4)!.alerted_at).toBeTruthy();

    // Dashboard shows the Big news panel; digest includes it.
    const page = await html(t.web, `/b/${f.business.id}`, f.session);
    expect(page.text).toContain("Big news");
    expect(page.text).toContain("$125 million");
    const digest = await json<{ sent: boolean }>(t.web, `/api/businesses/${f.business.id}/digest/send`, { method: "POST", session: f.session });
    expect(digest.body.sent).toBe(true);
    expect(t.app.repo.listEmails().find((e) => e.kind === "weekly_digest")!.body_text).toContain("Big news this week");
  });

  it("uses the LLM verdicts when available, capping magnitude for items not about the competitor", async () => {
    const llm: MessagesClient = {
      create: (async () => ({
        model: "claude-test",
        content: [{ type: "text", text: JSON.stringify({ items: [{ index: 0, about_competitor: true, category: "funding", magnitude: 5, summary: "NVIDIA invested $125m.", why_it_matters: "They can now outspend you on product and marketing." }, { index: 1, about_competitor: true, category: "launch", magnitude: 2, summary: "Dark mode.", why_it_matters: "Cosmetic." }, { index: 2, about_competitor: false, category: "other", magnitude: 5, summary: "Bricks.", why_it_matters: "n/a" }] }) }],
        usage: { input_tokens: 800, output_tokens: 200 },
      })) as never,
    };
    t = testApp({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-test" }, { llmClient: llm, analyzer: { name: "fake", analyze: async () => { throw new Error("unused"); } } });
    const f = await fixture(t);
    const r = await json<{ big: { magnitude: number; why_it_matters: string }[]; provider: string }>(t.web, `/api/competitors/${f.competitor.id}/news/refresh`, { method: "POST", session: f.session });
    expect(r.body.provider).toBe("anthropic:claude-test");
    expect(r.body.big).toHaveLength(1);
    expect(r.body.big[0]!.magnitude).toBe(5);
    expect(r.body.big[0]!.why_it_matters).toContain("outspend");
    const all = (await json<{ title: string; magnitude: number; about_competitor: number }[]>(t.web, `/api/competitors/${f.competitor.id}/news?all=1`, { session: f.session })).body;
    expect(all.find((n) => n.title.includes("Brick"))!.magnitude).toBe(2); // capped: not about the competitor
    expect(JSON.parse(t.app.events.list({ type: "ai.call" })[0]!.payload).purpose).toBe("news_classify");
  });

  it("free plan gets big news on the dashboard and in the digest but no instant alert", async () => {
    t = testApp();
    const f = await fixture(t);
    const acct = t.app.repo.getUserByEmail(f.session.email)!.account_id;
    t.app.repo.updateAccountPlan(acct, "free");
    await json(t.web, `/api/competitors/${f.competitor.id}/news/refresh`, { method: "POST", session: f.session });
    expect(t.app.repo.listEmails().some((e) => e.kind === "news_alert")).toBe(false);
    expect(t.app.events.list({ type: "news.big" })).toHaveLength(1);
  });

  it("scheduler job refreshes due competitors and records fetch failures without crashing", async () => {
    t = testApp();
    const f = await fixture(t);
    expect(await t.app.news.runDue()).toBe(1);
    expect(t.app.repo.getCompetitor(t.app.repo.getUserByEmail(f.session.email)!.account_id, f.competitor.id)!.news_next_at! > new Date().toISOString()).toBe(true);
    expect(await t.app.news.runDue()).toBe(0);
    externalHosts["news.google.com"] = () => new Response("nope", { status: 503 });
    t.app.repo.db.prepare("UPDATE competitors SET news_next_at = '2000-01-01'").run();
    expect(await t.app.news.runDue()).toBe(1);
    expect(t.app.events.list({ type: "news.fetch_failed" })).toHaveLength(1);
  });
});
