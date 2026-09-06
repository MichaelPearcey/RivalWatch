import { afterEach, describe, expect, it } from "vitest";
import type { MessagesClient } from "../src/agents/runner.js";
import { fixture, json, login, testApp } from "./helpers.js";

type Turn = { text?: string; tools?: { name: string; input: unknown }[]; usage?: { in: number; out: number } };

/** Scripted Anthropic client: replays turns, records what it was sent. */
function scripted(turns: Turn[]): MessagesClient & { sent: unknown[] } {
  let i = 0;
  const sent: unknown[] = [];
  return {
    sent,
    create: (async (params: unknown) => {
      sent.push(params);
      const t = turns[Math.min(i++, turns.length - 1)]!;
      const content: unknown[] = [];
      if (t.text) content.push({ type: "text", text: t.text });
      for (const [k, tool] of (t.tools ?? []).entries()) content.push({ type: "tool_use", id: `tu_${i}_${k}`, name: tool.name, input: tool.input });
      return { model: "claude-test", content, stop_reason: t.tools?.length ? "tool_use" : "end_turn", usage: { input_tokens: t.usage?.in ?? 1000, output_tokens: t.usage?.out ?? 200 } };
    }) as never,
  };
}

const agentsOn = { AGENTS_ENABLED: true, AI_PROVIDER: "anthropic" as const, ANTHROPIC_API_KEY: "sk-test" };

describe("agent framework", () => {
  let t: ReturnType<typeof testApp>;
  afterEach(() => t.app.close());

  it("agents are disabled by default and cannot be run", async () => {
    t = testApp();
    const admin = await login(t.web, "admin@rivalwatch.test");
    expect(t.app.agents.enabled).toBe(false);
    const r = await json<{ error: string }>(t.web, "/api/admin/agents/support-ops/run", { method: "POST", session: admin });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/disabled/);
  });

  it("support-ops reads data, requests a pause via approval, writes a report; everything is audited and nothing executes", async () => {
    const client = scripted([
      { tools: [{ name: "get_overview", input: {} }, { name: "list_unhealthy_pages", input: { limit: 10 } }] },
      { tools: [{ name: "request_approval", input: { action: "page.set_paused", payload: { page_id: 1, paused: true }, reason: "AUTH_REQUIRED for 7 days; site blocks bots", account_id: 1 } }] },
      { tools: [{ name: "write_note", input: { kind: "report", title: "Ops report", body: "Requested pause of page #1 (approval pending). No other failures." } }] },
      { text: "Requested pausing one permanently blocked page; wrote an ops report.", usage: { in: 500, out: 50 } },
    ]);
    t = testApp(agentsOn, { agentClient: client });
    const f = await fixture(t);
    const admin = await login(t.web, "admin@rivalwatch.test");

    const run = await json<{ status: string; turns: number; tool_calls: number; estimated_cost_usd: number; summary: string }>(t.web, "/api/admin/agents/support-ops/run", { method: "POST", session: admin });
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ status: "ok", turns: 4, tool_calls: 4 });
    expect(run.body.summary).toContain("ops report");
    expect(run.body.estimated_cost_usd).toBeGreaterThan(0);

    // The page is NOT paused; an approval is pending instead.
    expect(t.app.repo.getPageAny(f.pages[0]!.id)!.status).toBe("ACTIVE");
    const pending = t.app.approvals.list({ status: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ action: "page.set_paused", requested_by: "agent:support-ops", risk_level: "medium" });

    // Note written and visible to the admin.
    const notes = (await json<{ title: string; agent: string }[]>(t.web, "/api/admin/agents/notes", { session: admin })).body;
    expect(notes).toEqual([expect.objectContaining({ title: "Ops report", agent: "support-ops" })]);

    // Audit trail: run started/finished, one agent.action per tool call, ai.call per turn with cost.
    const ev = t.app.events.list({ limit: 200 });
    expect(ev.filter((e) => e.type === "agent.action" && e.actor === "agent:support-ops")).toHaveLength(4);
    expect(ev.filter((e) => e.type === "ai.call" && e.actor === "agent:support-ops")).toHaveLength(4);
    expect(ev.find((e) => e.type === "agent.run_finished")!.result).toBe("ok");
    const writeAction = ev.find((e) => e.type === "agent.action" && JSON.parse(e.payload).tool === "request_approval")!;
    expect(writeAction.risk_level).toBe("medium");

    // The system prompt and tool whitelist reached the model.
    const first = client.sent[0] as { system: string; tools: { name: string }[] };
    expect(first.system).toContain("Support & Operations agent");
    expect(first.tools.map((x) => x.name)).not.toContain("decide_approval");
  });

  it("tools outside the whitelist and invalid inputs are refused and logged", async () => {
    const client = scripted([
      { tools: [{ name: "decide_approval", input: { approval_id: 1, approve: true, note: "hack" } }, { name: "write_note", input: { kind: "report", title: "x", body: "short" } }] },
      { text: "done" },
    ]);
    t = testApp(agentsOn, { agentClient: client });
    const run = await t.app.agents.runNow("support-ops");
    expect(run.status).toBe("ok");
    const actions = t.app.events.list({ type: "agent.action" });
    expect(actions.map((e) => e.result).sort()).toEqual(["denied", "failed"]);
    const second = client.sent[1] as { messages: { content: { is_error?: boolean; content: string }[] }[] };
    const results = second.messages[2]!.content;
    expect(results[0]!.is_error).toBe(true);
    expect(results[0]!.content).toContain("not available");
    expect(results[1]!.is_error).toBe(true);
  });

  it("the manager may decide medium-risk approvals but not high-risk ones, and never its own", async () => {
    // Approval ids are deterministic in a fresh in-memory DB (1, 2, 3), so the script can reference them.
    const client = scripted([
      { tools: [{ name: "decide_approval", input: { approval_id: 1, approve: true, note: "verified page is blocked" } }, { name: "decide_approval", input: { approval_id: 2, approve: true, note: "sure" } }, { name: "decide_approval", input: { approval_id: 3, approve: true, note: "mine" } }] },
      { text: "Approved the pause; the plan change needs the owner." },
    ]);
    t = testApp(agentsOn, { agentClient: client });
    const f2 = await fixture(t);
    const acct2 = t.app.repo.getUserByEmail(f2.session.email)!.account_id;
    const m2 = t.app.approvals.request({ actor: "agent:support-ops" }, { action: "page.set_paused", payload: { page_id: f2.pages[1]!.id, paused: true }, accountId: acct2, reason: "blocked" });
    const h2 = t.app.approvals.request({ actor: "agent:support-ops" }, { action: "account.set_plan", payload: { account_id: acct2, plan: "plus" }, accountId: acct2 });
    const o2 = t.app.approvals.request({ actor: "agent:manager" }, { action: "page.set_paused", payload: { page_id: f2.pages[2]!.id, paused: true }, accountId: acct2 });
    expect([m2.id, h2.id, o2.id]).toEqual([1, 2, 3]);

    const run = await t.app.agents.runNow("manager");
    expect(run.status).toBe("ok");
    expect(t.app.approvals.get(m2.id)!.status).toBe("executed");
    expect(t.app.repo.getPageAny(f2.pages[1]!.id)!.status).toBe("PAUSED");
    expect(t.app.approvals.get(h2.id)!.status).toBe("pending");
    expect(t.app.approvals.get(o2.id)!.status).toBe("pending");
    expect(t.app.repo.getAccount(acct2)!.plan).toBe("pro");
    const granted = t.app.events.list({ type: "approval.granted" })[0]!;
    expect(granted.actor).toBe("agent:manager");
    expect(granted.approved_by).toBe("agent:manager");
  });

  it("stops at the per-run cost cap and reports 'capped'", async () => {
    // Each turn costs 1M in * $1 = $1, far above the 0.15 cap; the loop should stop after the first tool turn.
    const client = scripted([{ tools: [{ name: "get_overview", input: {} }], usage: { in: 1_000_000, out: 10 } }, { tools: [{ name: "get_overview", input: {} }], usage: { in: 1_000_000, out: 10 } }, { text: "never" }]);
    t = testApp(agentsOn, { agentClient: client });
    const run = await t.app.agents.runNow("support-ops");
    expect(run.status).toBe("capped");
    expect(run.turns).toBe(1);
    expect(t.app.events.list({ type: "agent.run_finished" })[0]!.result).toBe("denied");
  });

  it("enforces the rolling daily agent cost cap", async () => {
    t = testApp({ ...agentsOn, AGENT_DAILY_COST_CAP_USD: 0.001 }, { agentClient: scripted([{ text: "ok", usage: { in: 2000, out: 100 } }]) });
    const first = await t.app.agents.runNow("growth");
    expect(first.status).toBe("ok");
    const second = await t.app.agents.runNow("growth");
    expect(second.status).toBe("capped");
    expect(second.error).toMatch(/daily agent cost cap/);
  });

  it("scheduler runs due agents one per tick and reschedules; disabled agents are skipped", async () => {
    t = testApp(agentsOn, { agentClient: scripted([{ text: "nothing to report" }]) });
    t.app.db.prepare("UPDATE agent_state SET next_run_at = '2000-01-01T00:00:00Z'").run();
    t.app.agents.setEnabled("growth", false, "user:1");
    expect(await t.app.agents.runDue()).toBe(1);
    expect(await t.app.agents.runDue()).toBe(1);
    expect(await t.app.agents.runDue()).toBe(0); // growth disabled, others rescheduled into the future
    const state = t.app.agents.state();
    expect(state.find((s) => s.name === "growth")!.last_run_at).toBeNull();
    expect(state.filter((s) => s.name !== "growth").every((s) => s.last_status === "ok" && s.next_run_at! > new Date().toISOString())).toBe(true);
  });

  it("admin page renders the agents panel", async () => {
    t = testApp(agentsOn, { agentClient: scripted([{ tools: [{ name: "write_note", input: { kind: "recommendation", title: "Need more data", body: "Fewer than 5 confirmed insights so far; revisit next week." } }] }, { text: "wrote a recommendation" }]) });
    await t.app.agents.runNow("growth");
    const admin = await login(t.web, "admin@rivalwatch.test");
    const res = await t.web.request(`${t.base}/admin`, { headers: { cookie: admin.cookie, accept: "text/html" } });
    const page = await res.text();
    expect(page).toContain("Growth &amp; Marketing");
    expect(page).toContain("Need more data");
    expect(page).toContain("Run now");
  });
});
