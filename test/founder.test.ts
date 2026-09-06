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
    const sys = (client.sent[0]!.system as unknown as { text: string; cache_control?: unknown }[])[0]!;
    expect(sys.text).toContain("British English");
    expect(sys.text).toContain("RivalWatch - Product Vision");
    expect(sys.cache_control).toEqual({ type: "ephemeral" });
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

  it("streams text deltas and tool activity over SSE, folding Anthropic stream events into a full message", async () => {
    let call = 0;
    const streaming: MessagesClient = {
      create: (async () => {
        call++;
        const events =
          call === 1
            ? [
                { type: "message_start", message: { id: "m1", model: "claude-test", usage: { input_tokens: 5000, output_tokens: 0, cache_creation_input_tokens: 8000, cache_read_input_tokens: 0 } } },
                { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu1", name: "search_memory", input: {} } },
                { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"col' } },
                { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: 'ours","limit":5}' } },
                { type: "content_block_stop", index: 0 },
                { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 40 } },
                { type: "message_stop" },
              ]
            : [
                { type: "message_start", message: { id: "m2", model: "claude-test", usage: { input_tokens: 300, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 8000 } } },
                { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
                { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Nothing " } },
                { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "about colours yet." } },
                { type: "content_block_stop", index: 0 },
                { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 12 } },
                { type: "message_stop" },
              ];
        return (async function* () {
          for (const e of events) yield e;
        })();
      }) as never,
    };
    t = testApp(on, { founderClient: streaming, analyzer: { name: "fake", analyze: async () => { throw new Error("unused"); } } });
    const admin = await login(t.web, "admin@rivalwatch.test");
    const conv = (await json<{ id: number }>(t.web, "/api/admin/founder/conversations", { method: "POST", session: admin })).body;
    const res = await t.web.request(`${t.base}/admin/founder/${conv.id}/send`, { method: "POST", headers: { cookie: admin.cookie, "content-type": "application/x-www-form-urlencoded", accept: "text/event-stream" }, body: "text=colours%3F" });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = (await res.text())
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)) as { type: string; [k: string]: unknown });
    expect(events.map((e) => e.type)).toEqual(["tool_start", "tool_end", "text_start", "text", "text", "done"]);
    expect(events[0]!.label).toBe('Searching memory for "colours"');
    expect(events[1]!.ok).toBe(true);
    expect((events.at(-1)!.html as string)).toContain("Nothing about colours yet.");
    // Stored message is complete and cost accounts for cache writes (1.25x) and reads (0.1x).
    const msgs = t.app.founder.messages(conv.id);
    expect(msgs.at(-1)!.content).toBe("Nothing about colours yet.");
    const expected = (5000 * 3 + 8000 * 3 * 1.25 + 40 * 15 + 300 * 3 + 8000 * 3 * 0.1 + 12 * 15) / 1_000_000;
    expect(msgs.at(-1)!.estimated_cost_usd).toBeCloseTo(expected, 6);
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
