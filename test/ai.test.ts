import { afterEach, describe, expect, it } from "vitest";
import { AnthropicAnalyzer } from "../src/ai/anthropic.js";
import { GuardedAnalyzer } from "../src/ai/index.js";
import type { AnalysisInput, AnalysisResult, Analyzer } from "../src/ai/types.js";
import { openAndMigrate } from "../src/db/index.js";
import { Events } from "../src/events.js";
import { ResendMailProvider } from "../src/mail/index.js";

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
  inputTokens: 1_000_000,
  outputTokens: 100_000,
};

const guardOpts = { dailyCallCap: 10, dailyCostCapUsd: 0, inputCostPerMTok: 1, outputCostPerMTok: 5 };

describe("GuardedAnalyzer", () => {
  const db = openAndMigrate(":memory:");
  const events = new Events(db);
  afterEach(() => db.exec("DELETE FROM events"));

  it("records an ai.call event with token usage and estimated cost", async () => {
    const primary: Analyzer = { name: "fake", analyze: async () => good };
    const r = await new GuardedAnalyzer(primary, events, guardOpts).analyze(input);
    expect(r.provider).toBe("fake");
    expect(r.estimatedCostUsd).toBeCloseTo(1.5, 6); // 1M in * $1 + 0.1M out * $5
    const [ev] = events.list({ type: "ai.call" });
    expect(ev!.estimated_cost_usd).toBeCloseTo(1.5, 6);
    expect(JSON.parse(ev!.payload)).toMatchObject({ provider: "fake", model: "fake-1", input_tokens: 1_000_000, output_tokens: 100_000 });
  });

  it("falls back to the heuristic analyser and records ai.failed when the provider throws", async () => {
    const primary: Analyzer = { name: "fake", analyze: async () => { throw new Error("boom"); } };
    const r = await new GuardedAnalyzer(primary, events, guardOpts).analyze(input);
    expect(r.provider).toBe("heuristic");
    expect(r.draft.category).toBe("pricing");
    expect(r.estimatedCostUsd).toBe(0);
    expect(events.list({ type: "ai.failed" })[0]!.result).toBe("failed");
  });

  it("stops calling the provider once the daily call cap is reached", async () => {
    let calls = 0;
    const primary: Analyzer = { name: "fake", analyze: async () => { calls++; return good; } };
    const g = new GuardedAnalyzer(primary, events, { ...guardOpts, dailyCallCap: 2 });
    for (let i = 0; i < 4; i++) await g.analyze(input);
    expect(calls).toBe(2);
    expect(events.list({ type: "ai.cap_reached" })).toHaveLength(2);
    expect(events.list({ type: "ai.cap_reached" })[0]!.result).toBe("denied");
  });

  it("stops calling the provider once the daily cost cap is reached", async () => {
    let calls = 0;
    const primary: Analyzer = { name: "fake", analyze: async () => { calls++; return good; } };
    const g = new GuardedAnalyzer(primary, events, { ...guardOpts, dailyCallCap: 0, dailyCostCapUsd: 2 });
    for (let i = 0; i < 4; i++) await g.analyze(input);
    expect(calls).toBe(2); // $1.50 after first call (<2), $3 after second (>=2)
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

  it("parses JSON output (with surrounding prose) and validates it", async () => {
    const client = fakeClient(['Here you go:\n{"matters": true, "category": "pricing", "importance": 4, "headline": "Acme raised Pro to £59", "summary": "s", "why_it_matters": "w"}\nThanks']);
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
    const client = fakeClient(['{"matters": true, "category": "pricing", "importance": 9, "headline": "h", "summary": "s", "why_it_matters": "w"}']);
    await expect(new AnthropicAnalyzer({ apiKey: "x", model: "m", client }).analyze(input)).rejects.toThrow();
  });
});

describe("ResendMailProvider", () => {
  it("posts to the Resend API and maps success/failure without throwing", async () => {
    let seen: { url: string; auth: string | undefined; body: unknown } | undefined;
    const ok = (async (url: string, init?: RequestInit) => {
      seen = { url, auth: (init?.headers as Record<string, string>).authorization, body: JSON.parse(init!.body as string) };
      return new Response(JSON.stringify({ id: "em_123" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await new ResendMailProvider("re_key", ok).send({ to: "a@b.co", subject: "Hi", text: "t", kind: "test" }, "RivalWatch <x@y.co>");
    expect(r).toEqual({ ok: true, provider: "resend", providerId: "em_123" });
    expect(seen!.url).toBe("https://api.resend.com/emails");
    expect(seen!.auth).toBe("Bearer re_key");
    expect(seen!.body).toMatchObject({ from: "RivalWatch <x@y.co>", to: ["a@b.co"], subject: "Hi" });

    const bad = (async () => new Response(JSON.stringify({ name: "validation_error", message: "domain not verified" }), { status: 403 })) as unknown as typeof fetch;
    const r2 = await new ResendMailProvider("re_key", bad).send({ to: "a@b.co", subject: "Hi", text: "t", kind: "test" }, "x");
    expect(r2.ok).toBe(false);
    expect(r2.error).toContain("domain not verified");
  });
});
