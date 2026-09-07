import { afterEach, describe, expect, it } from "vitest";
import type { MessagesClient } from "../src/agents/runner.js";
import { buildProfilePrompt, heuristicProfile } from "../src/ai/profile.js";
import { translator } from "../src/i18n/index.js";
import { json, login, testApp } from "./helpers.js";

const fakeLlm = (text: string): MessagesClient & { calls: number } => {
  const c = {
    calls: 0,
    create: (async () => {
      c.calls++;
      return { model: "claude-test", content: [{ type: "text", text }], usage: { input_tokens: 2500, output_tokens: 300 } };
    }) as never,
  };
  return c;
};

describe("competitor profiles", () => {
  let t: ReturnType<typeof testApp>;
  afterEach(() => t?.app.close());

  it("heuristic profile extracts title, headings and prices without an LLM", () => {
    const p = heuristicProfile("Acme", [
      { url: "https://acme/", kind: "home", title: "Acme Studio — design tools", text: "Acme Studio\nDesign tools for independent professionals\nTrusted by thousands of freelancers worldwide since 2019.\nStart free" },
      { url: "https://acme/pricing", kind: "pricing", title: "Pricing", text: "Starter\n£19/month\nProfessional\n£49/month" },
    ]);
    expect(p.provider).toBe("heuristic");
    expect(p.summary).toContain("Acme Studio — design tools");
    expect(p.pricing_summary).toContain("£19/month");
    expect(p.usps).toContain("Design tools for independent professionals");
    expect(p.sources).toHaveLength(2);
  });

  it("writes its own fallback wording in the owner's language", () => {
    const p = heuristicProfile("Acme", [{ url: "https://acme/", kind: "home", title: "Acme", text: "Acme\n£19/month" }], translator("uk"));
    expect(p.target_customers).toBe("Не вдалося визначити автоматично.");
    expect(p.pricing_summary).toContain("Знайдені ціни:");
    expect(heuristicProfile("Acme", [{ url: "https://acme/", kind: "home", title: "Acme", text: "Acme" }], translator("uk")).pricing_summary).toBe("Не вказані на сторінках, які ми прочитали.");
  });

  it("the prompt bounds page text, tags sources, and asks for the owner's language", () => {
    const prompt = buildProfilePrompt("Acme", "https://acme", [{ url: "https://acme/", kind: "home", title: 'Say "hi"', text: "x".repeat(10_000) }], "German");
    expect(prompt).toContain("Write the profile in German");
    expect(prompt).toContain(`<page kind="home" url="https://acme/" title="Say 'hi'">`);
    expect(prompt.length).toBeLessThan(7000);
  });

  it("uses the LLM when available, validates the JSON, records cost, and feeds the profile into analysis", async () => {
    const llm = fakeLlm(JSON.stringify({ summary: "Acme Studio sells browser-based design tools to freelancers.", target_customers: "Freelance designers and small agencies", usps: ["Five-minute setup", "Client approval built in"], products: ["Acme Design", "Acme Proof"], pricing_summary: "Starter £19/month, Professional £49/month.", positioning: "Simple, affordable design tooling" }));
    t = testApp({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-test" }, { llmClient: llm, analyzer: { name: "fake", analyze: async () => ({ draft: { matters: true, category: "pricing", importance: 3, headline: "h", summary: "s", why_it_matters: "w" }, provider: "fake", model: null, inputTokens: null, outputTokens: null }) } });
    const s = await login(t.web, "p@a.co");
    const b = (await json<{ id: number }>(t.web, "/api/businesses", { method: "POST", session: s, body: JSON.stringify({ name: "B" }) })).body;
    const r = await json<{ competitor: { id: number } }>(t.web, `/api/businesses/${b.id}/competitors`, { method: "POST", session: s, body: JSON.stringify({ name: "Acme", website: `${t.base}/demo/` }) });
    await t.app.idle();
    expect(llm.calls).toBe(1);
    const comp = (await json<{ profile_status: string; profile: { usps: string[]; provider: string } }>(t.web, `/api/competitors/${r.body.competitor.id}`, { session: s })).body;
    expect(comp.profile_status).toBe("ready");
    expect(comp.profile.provider).toBe("anthropic:claude-test");
    expect(comp.profile.usps).toEqual(["Five-minute setup", "Client approval built in"]);
    const call = t.app.events.list({ type: "ai.call" })[0]!;
    expect(JSON.parse(call.payload).purpose).toBe("competitor_profile");
    expect(call.estimated_cost_usd).toBeCloseTo((2500 * 1 + 300 * 5) / 1_000_000, 8);
  });

  it("falls back to the heuristic profile when the LLM returns garbage", async () => {
    t = testApp({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-test" }, { llmClient: fakeLlm("I refuse to answer in JSON."), analyzer: { name: "fake", analyze: async () => { throw new Error("unused"); } } });
    const s = await login(t.web, "q@a.co");
    const b = (await json<{ id: number }>(t.web, "/api/businesses", { method: "POST", session: s, body: JSON.stringify({ name: "B" }) })).body;
    const r = await json<{ competitor: { id: number } }>(t.web, `/api/businesses/${b.id}/competitors`, { method: "POST", session: s, body: JSON.stringify({ name: "Acme", website: `${t.base}/demo/` }) });
    await t.app.idle();
    const comp = (await json<{ profile_status: string; profile: { provider: string } }>(t.web, `/api/competitors/${r.body.competitor.id}`, { session: s })).body;
    expect(comp.profile_status).toBe("ready");
    expect(comp.profile.provider).toBe("heuristic");
    expect(t.app.events.list({ type: "ai.failed" })).toHaveLength(1);
  });
});
