import { afterEach, describe, expect, it } from "vitest";
import type { MessagesClient } from "../src/agents/runner.js";
import { html, json, login, testApp } from "./helpers.js";

type Turn = { text?: string; tools?: { name: string; input: unknown }[] };
function scripted(turns: Turn[]): MessagesClient & { sent: { system: string; messages: unknown[] }[] } {
  let i = 0;
  const sent: { system: string; messages: unknown[] }[] = [];
  return {
    sent,
    create: (async (params: { system: string; messages: unknown[] }) => {
      sent.push(params);
      const t = turns[Math.min(i++, turns.length - 1)]!;
      const content: unknown[] = [];
      if (t.text) content.push({ type: "text", text: t.text });
      for (const [k, tool] of (t.tools ?? []).entries()) content.push({ type: "tool_use", id: `tu_${i}_${k}`, name: tool.name, input: tool.input });
      return { model: "claude-test", content, stop_reason: t.tools?.length ? "tool_use" : "end_turn", usage: { input_tokens: 4000, output_tokens: 300 } };
    }) as never,
  };
}
const on = { AI_PROVIDER: "anthropic" as const, ANTHROPIC_API_KEY: "sk-test" };

describe("shared memory", () => {
  let t: ReturnType<typeof testApp>;
  afterEach(() => t?.app.close());

  it("admins and admin-owned API keys can add, list, search and close notes; agents may declare their author", async () => {
    t = testApp();
    const admin = await login(t.web, "admin@rivalwatch.test");
    const user = await login(t.web, "u@a.co");
    expect((await json(t.web, "/api/admin/memory", { session: user })).status).toBe(403);
    const a = await json<{ id: number; author: string }>(t.web, "/api/admin/memory", { method: "POST", session: admin, body: JSON.stringify({ kind: "request", title: "Change home colours", body: "Use warmer tones on the landing page.", tags: ["ui", "Landing"] }) });
    expect(a.status).toBe(201);
    expect(a.body.author).toMatch(/^user:\d+$/);
    const key = (await json<{ key: string }>(t.web, "/api/api-keys", { method: "POST", session: admin, body: JSON.stringify({ name: "devin" }) })).body.key;
    const b = await json<{ id: number; author: string }>(t.web, "/api/admin/memory", { method: "POST", bearer: key, body: JSON.stringify({ kind: "journal", title: "Shipped news", body: "Competitor news is live.", author: "agent:devin" }) });
    expect(b.body.author).toBe("agent:devin");
    const list = (await json<{ id: number }[]>(t.web, "/api/admin/memory?status=open", { bearer: key })).body;
    expect(list.map((n) => n.id)).toEqual([b.body.id, a.body.id]);
    const found = (await json<{ id: number }[]>(t.web, "/api/admin/memory/search?q=landing+colours", { session: admin })).body;
    expect(found.map((n) => n.id)).toEqual([a.body.id]);
    expect((await json(t.web, `/api/admin/memory/${a.body.id}/status`, { method: "POST", bearer: key, body: JSON.stringify({ status: "done" }) })).status).toBe(204);
    expect(t.app.memory.get(a.body.id)!.status).toBe("done");
    expect(t.app.memory.briefing()).toContain("Shipped news");
    expect(t.app.events.list({ type: "memory.added" })).toHaveLength(2);
  });
});

describe("founder assistant", () => {
  let t: ReturnType<typeof testApp>;
  afterEach(() => t?.app.close());

  it("is admin-only and reports unavailability without a provider", async () => {
    t = testApp();
    const user = await login(t.web, "u@a.co");
    expect((await html(t.web, "/admin/founder", user)).status).toBe(403);
    const admin = await login(t.web, "admin@rivalwatch.test");
    const page = await html(t.web, "/admin/founder", admin);
    expect(page.status).toBe(200);
    expect(page.text).toContain("needs the Anthropic provider");
  });

  it("answers, uses tools, saves a request to memory, persists the conversation and costs", async () => {
    const client = scripted([
      { tools: [{ name: "get_overview", input: {} }, { name: "remember", input: { kind: "request", title: "Warmer landing colours", body: "Owner wants warmer tones on the landing page hero.", tags: ["ui"] } }] },
      { text: "Done — I've saved your request for Devin. Right now there are 0 businesses monitored." },
    ]);
    t = testApp(on, { founderClient: client, analyzer: { name: "fake", analyze: async () => { throw new Error("unused"); } } });
    const admin = await login(t.web, "admin@rivalwatch.test");
    t.app.memory.add({ author: "user:1", kind: "preference", title: "British English", body: "Always use British spelling." });

    const conv = (await json<{ id: number }>(t.web, "/api/admin/founder/conversations", { method: "POST", session: admin })).body;
    const reply = await json<{ role: string; content: string; tool_calls: number; estimated_cost_usd: number }>(t.web, `/api/admin/founder/conversations/${conv.id}/messages`, { method: "POST", session: admin, body: JSON.stringify({ text: "Please make the landing page colours warmer." }) });
    expect(reply.status).toBe(200);
    expect(reply.body.role).toBe("assistant");
    expect(reply.body.content).toContain("saved your request");
    expect(reply.body.tool_calls).toBe(2);
    expect(reply.body.estimated_cost_usd).toBeCloseTo(2 * (4000 * 3 + 300 * 15) / 1_000_000, 6);

    // Memory got the request, attributed to the founder agent, with the conversation as source.
    const req = t.app.memory.list({ kind: "request" })[0]!;
    expect(req).toMatchObject({ author: "agent:founder", title: "Warmer landing colours", source: `conversation:${conv.id}`, status: "open" });

    // The system prompt carried existing memory and project docs; history is replayed on the next turn.
    expect(client.sent[0]!.system).toContain("British English");
    expect(client.sent[0]!.system).toContain("RivalWatch - Product Vision");
    await json(t.web, `/api/admin/founder/conversations/${conv.id}/messages`, { method: "POST", session: admin, body: JSON.stringify({ text: "Thanks" }) });
    expect((client.sent.at(-1)!.messages as unknown[]).length).toBe(3); // user, assistant, user

    // UI renders the thread with tool activity; audit events exist.
    const page = await html(t.web, `/admin/founder/${conv.id}`, admin);
    expect(page.text).toContain("saved your request");
    expect(page.text).toContain("tool call(s)");
    expect(t.app.events.list({ type: "ai.call" }).every((e) => JSON.parse(e.payload).purpose === "founder_chat")).toBe(true);
    expect(t.app.events.list({ type: "agent.action" }).filter((e) => e.actor === "agent:founder")).toHaveLength(2);
  });

  it("nudges the model once when it announces work instead of doing it, and reports output truncation", async () => {
    const client = scripted([{ text: "Good idea. Let me update the theme now:" }, { tools: [{ name: "remember", input: { kind: "request", title: "Theme change", body: "Owner wants a new palette.", tags: [] } }] }, { text: "Saved the request (#1)." }]);
    t = testApp(on, { founderClient: client, analyzer: { name: "fake", analyze: async () => { throw new Error("unused"); } } });
    const admin = await login(t.web, "admin@rivalwatch.test");
    const conv = (await json<{ id: number }>(t.web, "/api/admin/founder/conversations", { method: "POST", session: admin })).body;
    const reply = await json<{ content: string; tool_calls: number }>(t.web, `/api/admin/founder/conversations/${conv.id}/messages`, { method: "POST", session: admin, body: JSON.stringify({ text: "Change the theme" }) });
    expect(reply.body.content).toBe("Saved the request (#1).");
    expect(reply.body.tool_calls).toBe(1);
    expect(JSON.stringify(client.sent.at(-1)!.messages)).toContain("Go ahead and do it now");

    // Truncation is surfaced, not hidden.
    const cut: MessagesClient = { create: (async () => ({ model: "m", content: [{ type: "text", text: "Here is the new file: export const" }], stop_reason: "max_tokens", usage: { input_tokens: 10, output_tokens: 10 } })) as never };
    t.app.close();
    t = testApp(on, { founderClient: cut, analyzer: { name: "fake", analyze: async () => { throw new Error("unused"); } } });
    const admin2 = await login(t.web, "admin@rivalwatch.test");
    const conv2 = (await json<{ id: number }>(t.web, "/api/admin/founder/conversations", { method: "POST", session: admin2 })).body;
    const r2 = await json<{ content: string }>(t.web, `/api/admin/founder/conversations/${conv2.id}/messages`, { method: "POST", session: admin2, body: JSON.stringify({ text: "go" }) });
    expect(r2.body.content).toContain("cut off by the output limit");
  });

  it("enforces the daily budget and isolates conversations per user", async () => {
    t = testApp({ ...on, FOUNDER_DAILY_COST_CAP_USD: 0.01 }, { founderClient: scripted([{ text: "ok" }]), analyzer: { name: "fake", analyze: async () => { throw new Error("unused"); } } });
    const admin = await login(t.web, "admin@rivalwatch.test");
    const conv = (await json<{ id: number }>(t.web, "/api/admin/founder/conversations", { method: "POST", session: admin })).body;
    expect((await json(t.web, `/api/admin/founder/conversations/${conv.id}/messages`, { method: "POST", session: admin, body: JSON.stringify({ text: "hi" }) })).status).toBe(200);
    const capped = await json<{ error: string }>(t.web, `/api/admin/founder/conversations/${conv.id}/messages`, { method: "POST", session: admin, body: JSON.stringify({ text: "hi again" }) });
    expect(capped.status).toBe(409);
    expect(capped.body.error).toContain("Daily budget");
    // Another admin cannot read this conversation.
    t.app.cfg.ADMIN_EMAILS.push("second@rivalwatch.test");
    const other = await login(t.web, "second@rivalwatch.test");
    expect((await json(t.web, `/api/admin/founder/conversations/${conv.id}/messages`, { method: "POST", session: other, body: JSON.stringify({ text: "peek" }) })).status).toBe(409);
  });
});
