import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { App } from "../app.js";
import { errorFields, log } from "../logger.js";
import type { AgentContext, AgentDefinition, AgentRunRow, Tool } from "./types.js";

export type MessagesClient = Pick<Anthropic["messages"], "create">;

export interface RunnerOptions {
  model: string;
  inputCostPerMTok: number;
  outputCostPerMTok: number;
  /** Rolling 24h cap across all agents (USD). 0 = unlimited. */
  dailyCostCapUsd: number;
}

const MAX_TOOL_RESULT_CHARS = 12_000;

/**
 * Runs one agent: system prompt + briefing, then a tool-use loop bounded by
 * turns and cost. Every tool call is an `agent.action` audit event; every
 * model call is an `ai.call` event with cost. The run row is the record.
 */
export class AgentRunner {
  constructor(
    private readonly app: App,
    private readonly client: MessagesClient,
    private readonly opts: RunnerOptions,
  ) {}

  async run(agent: AgentDefinition, trigger: "schedule" | "manual" = "schedule"): Promise<AgentRunRow> {
    const { app } = this;
    const actor = `agent:${agent.name}`;
    const row = app.db.prepare("INSERT INTO agent_runs (agent, trigger, model) VALUES (?, ?, ?) RETURNING *").get(agent.name, trigger, this.opts.model) as unknown as AgentRunRow;
    const ctx: AgentContext = { app, agent, runId: row.id, actor };
    app.events.record({ type: "agent.run_started", actor, entity: { type: "agent_run", id: row.id }, payload: { agent: agent.name, trigger, model: this.opts.model } });

    const since = new Date(Date.now() - 86_400_000).toISOString();
    const spent = (app.db.prepare("SELECT COALESCE(SUM(estimated_cost_usd),0) s FROM agent_runs WHERE started_at >= ?").get(since) as { s: number }).s;
    if (this.opts.dailyCostCapUsd > 0 && spent >= this.opts.dailyCostCapUsd) {
      return this.finish(row.id, actor, agent, { status: "capped", error: `daily agent cost cap reached ($${spent.toFixed(2)} >= $${this.opts.dailyCostCapUsd})` });
    }

    const tools = agent.tools.map((t) => ({ name: t.name, description: t.description, input_schema: z.toJSONSchema(t.schema) as Anthropic.Tool["input_schema"] }));
    const byName = new Map<string, Tool>(agent.tools.map((t) => [t.name, t]));
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: agent.buildBriefing(app) }];

    let turns = 0;
    let toolCalls = 0;
    let inTok = 0;
    let outTok = 0;
    let cost = 0;
    let summary = "";

    try {
      while (turns < agent.maxTurns) {
        turns++;
        const started = Date.now();
        const res = await this.client.create({ model: this.opts.model, max_tokens: 2048, temperature: 0.2, system: agent.systemPrompt, tools, messages });
        inTok += res.usage.input_tokens;
        outTok += res.usage.output_tokens;
        const callCost = (res.usage.input_tokens * this.opts.inputCostPerMTok + res.usage.output_tokens * this.opts.outputCostPerMTok) / 1_000_000;
        cost += callCost;
        app.events.record({ type: "ai.call", actor, estimatedCostUsd: callCost, payload: { purpose: "agent", agent: agent.name, run_id: row.id, model: res.model, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens, duration_ms: Date.now() - started, turn: turns } });
        app.db.prepare("UPDATE agent_runs SET turns = ?, input_tokens = ?, output_tokens = ?, estimated_cost_usd = ? WHERE id = ?").run(turns, inTok, outTok, cost, row.id);

        const text = res.content.filter((c): c is Anthropic.TextBlock => c.type === "text").map((c) => c.text).join("\n").trim();
        if (text) summary = text;
        const uses = res.content.filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
        if (res.stop_reason !== "tool_use" || uses.length === 0) break;

        if (cost >= agent.maxCostUsd) {
          return this.finish(row.id, actor, agent, { status: "capped", summary, toolCalls, error: `run cost cap reached ($${cost.toFixed(3)} >= $${agent.maxCostUsd})` });
        }

        messages.push({ role: "assistant", content: res.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const use of uses) {
          toolCalls++;
          results.push(await this.callTool(ctx, byName.get(use.name), use));
        }
        messages.push({ role: "user", content: results });
        app.db.prepare("UPDATE agent_runs SET tool_calls = ? WHERE id = ?").run(toolCalls, row.id);
      }
      if (turns >= agent.maxTurns && !summary) summary = "(stopped: max turns reached)";
      return this.finish(row.id, actor, agent, { status: "ok", summary, toolCalls });
    } catch (err) {
      log.error("agent run failed", { agent: agent.name, run_id: row.id, ...errorFields(err) });
      return this.finish(row.id, actor, agent, { status: "failed", summary, toolCalls, error: (err as Error).message });
    }
  }

  private async callTool(ctx: AgentContext, tool: Tool | undefined, use: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> {
    const { app, actor, agent } = ctx;
    const base = { agent: agent.name, run_id: ctx.runId, tool: use.name };
    if (!tool) {
      app.events.record({ type: "agent.action", actor, result: "denied", riskLevel: "medium", payload: { ...base, error: "tool not in whitelist" } });
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: `Tool "${use.name}" is not available to you.` };
    }
    const parsed = tool.schema.safeParse(use.input);
    if (!parsed.success) {
      app.events.record({ type: "agent.action", actor, result: "failed", payload: { ...base, error: "invalid input", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) } });
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
    }
    try {
      const out = await tool.run(ctx, parsed.data);
      const json = JSON.stringify(out ?? null);
      app.events.record({ type: "agent.action", actor, riskLevel: tool.kind === "write" ? "medium" : "low", payload: { ...base, kind: tool.kind, input: tool.kind === "write" ? parsed.data : undefined, result_chars: json.length } });
      return { type: "tool_result", tool_use_id: use.id, content: json.length > MAX_TOOL_RESULT_CHARS ? json.slice(0, MAX_TOOL_RESULT_CHARS) + `… (truncated, ${json.length} chars total; narrow your query)` : json };
    } catch (err) {
      app.events.record({ type: "agent.action", actor, result: "failed", riskLevel: tool.kind === "write" ? "medium" : "low", payload: { ...base, kind: tool.kind, input: parsed.data, ...errorFields(err) } });
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: `Error: ${(err as Error).message}` };
    }
  }

  private finish(runId: number, actor: string, agent: AgentDefinition, r: { status: AgentRunRow["status"]; summary?: string; toolCalls?: number; error?: string }): AgentRunRow {
    this.app.db
      .prepare(`UPDATE agent_runs SET status = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), summary = ?, error = ?, tool_calls = COALESCE(?, tool_calls) WHERE id = ?`)
      .run(r.status, r.summary ?? null, r.error ?? null, r.toolCalls ?? null, runId);
    const row = this.app.db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId) as unknown as AgentRunRow;
    this.app.events.record({
      type: "agent.run_finished",
      actor,
      entity: { type: "agent_run", id: runId },
      result: r.status === "ok" ? "ok" : r.status === "capped" ? "denied" : "failed",
      estimatedCostUsd: row.estimated_cost_usd,
      payload: { agent: agent.name, status: r.status, turns: row.turns, tool_calls: row.tool_calls, input_tokens: row.input_tokens, output_tokens: row.output_tokens, error: r.error ?? null },
    });
    return row;
  }
}
