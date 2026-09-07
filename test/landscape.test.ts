import { afterEach, describe, expect, it } from "vitest";
import type { MessagesClient } from "../src/agents/runner.js";
import { buildLandscapePrompt, heuristicLandscape, type LandscapeInput } from "../src/ai/landscape.js";
import { fixture, html, json, login, testApp } from "./helpers.js";

const fakeLlm = (text: string): MessagesClient & { calls: number; lastUser: string } => {
  const c = {
    calls: 0,
    lastUser: "",
    create: (async (req: { messages: { content: string }[] }) => {
      c.calls++;
      c.lastUser = req.messages[0]!.content;
      return { model: "claude-test", content: [{ type: "text", text }], usage: { input_tokens: 3000, output_tokens: 400 } };
    }) as never,
  };
  return c;
};

const input = (over: Partial<LandscapeInput> = {}): LandscapeInput => ({
  name: "Acme Studio",
  website: "https://acme.test",
  positioning: "Simple design tooling",
  pricing: "Starter £19/month",
  target_customers: "Freelancers",
  usps: ["Five-minute setup"],
  products: ["Acme Design"],
  recent_changes: ["Raised Pro price to £61"],
  recent_news: [],
  ...over,
});

const AI_DOC = JSON.stringify({
  headline: "Two rivals, one raising prices",
  summary: "Acme is the closest competitor and just raised prices.",
  competitors: [{ name: "Acme Studio", positioning: "Simple design tooling", pricing: "Starter £19/month", strengths: "Fast setup", watch_out: "Price rises" }],
  opportunities: ["Undercut Acme's new Pro price"],
  threats: ["Acme moves faster on pricing"],
  recommendations: ["Publish your own pricing page"],
});

describe("competitor landscape", () => {
  let t: ReturnType<typeof testApp>;
  afterEach(() => t?.app.close());

  it("the heuristic briefing summarises stored facts and never invents pricing", () => {
    const doc = heuristicLandscape({ name: "Bright Pixel" }, [input(), input({ name: "Quiet Co", pricing: "", usps: [], recent_changes: [], recent_news: [] })]);
    expect(doc.provider).toBe("heuristic");
    expect(doc.headline).toContain("Bright Pixel");
    expect(doc.competitors).toHaveLength(2);
    expect(doc.competitors[1]!.pricing).toBe("Not known yet");
    expect(doc.competitors[1]!.watch_out).toBe("Nothing recent");
    expect(doc.threats.join(" ")).toContain("Acme Studio");
    // Unknown pricing must read as "we have not read it", never as "they publish none".
    expect(doc.opportunities.join(" ")).toContain("have not read prices for 1");
    expect(doc.recommendations.join(" ")).toContain("Quiet Co");
  });

  it("the prompt carries our own pricing, tags each competitor and asks for the owner's language", () => {
    const prompt = buildLandscapePrompt({ name: "Bright Pixel", description: "Design studio", pricing: "Starter £25/month" }, [input({ name: 'A"B' })], "Ukrainian");
    expect(prompt).toContain("Our pricing: Starter £25/month");
    expect(prompt).toContain("Write the briefing in Ukrainian");
    expect(prompt).toContain(`<competitor name="A'B" website="https://acme.test">`);
    expect(prompt).toContain("recent website changes we detected: Raised Pro price to £61");
  });

  it("generates, stores and re-renders an AI briefing from the dashboard", async () => {
    const llm = fakeLlm(AI_DOC);
    t = testApp({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-test" }, { llmClient: llm });
    const f = await fixture(t);
    const gen = await html(t.web, `/b/${f.business.id}/landscape`, f.session, { method: "POST" });
    expect(gen.status).toBe(302);
    expect(gen.location).toContain("tab=landscape");
    expect(llm.calls).toBe(1);
    expect(llm.lastUser).toContain("Acme Studio");

    const stored = t.app.repo.getLandscape(t.app.repo.getUserByEmail("owner@rivalwatch.test")!.account_id, f.business.id)!;
    expect(stored.status).toBe("ready");
    expect(stored.provider).toBe("anthropic:claude-test");
    expect(stored.competitor_count).toBe(1);

    const page = await html(t.web, `/b/${f.business.id}?tab=landscape`, f.session);
    expect(page.text).toContain("Two rivals, one raising prices");
    expect(page.text).toContain("Undercut Acme");
    expect(page.text).toContain("Publish your own pricing page");
    expect(t.app.events.list({ type: "landscape.generated" })).toHaveLength(1);
  });

  it("falls back to the heuristic briefing when the model returns garbage", async () => {
    t = testApp({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-test" }, { llmClient: fakeLlm("no json here") });
    const f = await fixture(t);
    await html(t.web, `/b/${f.business.id}/landscape`, f.session, { method: "POST" });
    const page = await html(t.web, `/b/${f.business.id}?tab=landscape`, f.session);
    expect(page.text).toContain("Acme Studio");
    expect(page.text).toContain("without AI");
    const stored = t.app.repo.getLandscape(t.app.repo.getUserByEmail("owner@rivalwatch.test")!.account_id, f.business.id)!;
    expect(stored.status).toBe("ready");
    expect(stored.provider).toBe("heuristic");
  });

  it("writes the fallback briefing in the owner's language", async () => {
    t = testApp();
    const f = await fixture(t);
    await json(t.web, "/api/me", { method: "PATCH", session: f.session, body: JSON.stringify({ locale: "uk" }) });
    await html(t.web, `/b/${f.business.id}/landscape`, f.session, { method: "POST" });
    const page = await html(t.web, `/b/${f.business.id}?tab=landscape`, f.session);
    expect(page.text).toContain("Поки невідомо");
    expect(page.text).not.toContain("Not known yet");
  });

  it("is tenant-scoped: another account cannot generate or read someone else's briefing", async () => {
    t = testApp();
    const f = await fixture(t);
    await html(t.web, `/b/${f.business.id}/landscape`, f.session, { method: "POST" });
    const intruder = await login(t.web, "intruder@a.co");
    expect((await html(t.web, `/b/${f.business.id}?tab=landscape`, intruder)).status).toBe(404);
    expect((await html(t.web, `/b/${f.business.id}/landscape`, intruder, { method: "POST" })).status).toBe(302);
    const other = t.app.repo.getUserByEmail("intruder@a.co")!.account_id;
    expect(t.app.repo.getLandscape(other, f.business.id)).toBeUndefined();
  });
});

describe("business dashboard", () => {
  let t: ReturnType<typeof testApp>;
  afterEach(() => t?.app.close());

  it("shows tabs, an overview with counts, and one combined feed of changes and news", async () => {
    t = testApp();
    const f = await fixture(t);
    await f.scan();
    await f.setDemo({ proPrice: 61 });
    await f.scan();
    await f.scan();

    const overview = await html(t.web, `/b/${f.business.id}`, f.session);
    expect(overview.status).toBe(200);
    expect(overview.text).toContain("At a glance");
    expect(overview.text).toContain("competitors watched");
    expect(overview.text).toContain("pages monitored");

    const news = await html(t.web, `/b/${f.business.id}?tab=news`, f.session);
    expect(news.text).toContain("Everything new, in one place");
    expect(news.text).toContain("website change");

    const competitors = await html(t.web, `/b/${f.business.id}?tab=competitors`, f.session);
    expect(competitors.text).toContain("Acme Studio");
    expect(competitors.text).toContain("Last checked");

    // Unknown tabs fall back to the overview rather than erroring.
    const bogus = await html(t.web, `/b/${f.business.id}?tab=klingon`, f.session);
    expect(bogus.status).toBe(200);
    expect(bogus.text).toContain("At a glance");
  });

  it("never shows raw pipeline enums in the scan feedback", async () => {
    t = testApp();
    const f = await fixture(t);
    await json(t.web, "/api/me", { method: "PATCH", session: f.session, body: JSON.stringify({ locale: "uk" }) });
    const scan = await html(t.web, `/b/${f.business.id}/scan`, f.session, { method: "POST" });
    const flash = decodeURIComponent(scan.location ?? "");
    expect(flash).not.toMatch(/first_snapshot|pending_confirmation|fetch_failed|unchanged/);
    expect(flash).toContain("копі");
  });

  it("renders the dashboard in the owner's language", async () => {
    t = testApp();
    const f = await fixture(t);
    await json(t.web, "/api/me", { method: "PATCH", session: f.session, body: JSON.stringify({ locale: "uk" }) });
    const page = await html(t.web, `/b/${f.business.id}`, f.session);
    expect(page.text).toContain("Коротко");
    expect(page.text).toContain("Огляд ринку");
    expect(page.text).not.toContain("At a glance");
  });
});
