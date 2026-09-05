import { afterEach, describe, expect, it } from "vitest";
import { AnthropicAnalyzer } from "../src/ai/anthropic.js";
import { GuardedAnalyzer } from "../src/ai/index.js";
import type { AnalysisInput, AnalysisResult, Analyzer } from "../src/ai/types.js";
import { openAndMigrate } from "../src/db/index.js";
import { Events } from "../src/events.js";

const input: AnalysisInput = {
  business: { name: "B", description: null, pricing_notes: null },
  competitor: { name: "Acme", website: "https://acme.example" },
  page: { url: "https://acme.example/pricing", kind: "pricing", title: null },
  change: { added: ["£59/month"], removed: ["£49/month"], signals: ["price"], significance: 0.9 },
};

const good: AnalysisResult = {
  draft: { matters: true, category: "pricing", importance: 4, headline: "Acme raised prices", summary: "s", why_it_matters: "w" },
  provider: "fake",
  model: "fake-1",
  inputTokens: 100,
  outputTokens: 50,
};

describe("GuardedAnalyzer", () => {
  const db = openAndMigrate(":memory:");
  const events = new Events(db);
  afterEach(() => db.exec("DELETE FROM events"));

  it("records an ai.call event with usage on success", async () => {
    const primary: Analyzer = { name: "fake", analyze: async () => good };
    const r = await new GuardedAnalyzer(primary, events, 10).analyze(input);
    expect(r.provider).toBe("fake");
    const [ev] = events.list({ type: "ai.call" });
    expect(JSON.parse(ev!.payload)).toMatchObject({ provider: "fake", model: "fake-1", input_tokens: 100, output_tokens: 50 });
  });

  it("falls back to the heuristic analyser and records ai.failed when the provider throws", async () => {
    const primary: Analyzer = { name: "fake", analyze: async () => { throw new Error("boom"); } };
    const r = await new GuardedAnalyzer(primary, events, 10).analyze(input);
    expect(r.provider).toBe("heuristic");
    expect(r.draft.category).toBe("pricing");
    expect(events.list({ type: "ai.failed" })).toHaveLength(1);
  });

  it("stops calling the provider once the daily cap is reached", async () => {
    let calls = 0;
    const primary: Analyzer = { name: "fake", analyze: async () => { calls++; return good; } };
    const g = new GuardedAnalyzer(primary, events, 2);
    for (let i = 0; i < 4; i++) await g.analyze(input);
    expect(calls).toBe(2);
    expect(events.list({ type: "ai.cap_reached" })).toHaveLength(2);
  });
});

describe("AnthropicAnalyzer", () => {
  const fakeClient = (texts: string[]) => {
    let i = 0;
    return {
      calls: 0,
      create: async function (this: { calls: number }) {
        this.calls++;
        const text = texts[Math.min(i++, texts.length - 1)]!;
        return { model: "claude-test", content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 5 } } as never;
      },
    };
  };

  it("parses prefixed JSON output and validates it", async () => {
    const client = fakeClient(['"matters": true, "category": "pricing", "importance": 4, "headline": "Acme raised Pro to £59", "summary": "s", "why_it_matters": "w"}']);
    const a = new AnthropicAnalyzer({ apiKey: "x", model: "claude-test", client });
    const r = await a.analyze(input);
    expect(r.draft.headline).toBe("Acme raised Pro to £59");
    expect(r.model).toBe("claude-test");
    expect(r.inputTokens).toBe(10);
  });

  it("retries once on invalid output then throws", async () => {
    const client = fakeClient(["not json at all"]);
    const a = new AnthropicAnalyzer({ apiKey: "x", model: "claude-test", client });
    await expect(a.analyze(input)).rejects.toThrow(/invalid output/);
    expect(client.calls).toBe(2);
  });

  it("rejects schema violations (e.g. importance out of range)", async () => {
    const client = fakeClient(['"matters": true, "category": "pricing", "importance": 9, "headline": "h", "summary": "s", "why_it_matters": "w"}']);
    await expect(new AnthropicAnalyzer({ apiKey: "x", model: "m", client }).analyze(input)).rejects.toThrow();
  });
});
