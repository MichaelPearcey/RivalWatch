import { createAnthropicClient } from "../ai/anthropic.js";
import type { App } from "../app.js";
import type { Config } from "../config.js";
import { errorFields, log } from "../logger.js";
import { AGENTS } from "./definitions.js";
import { AgentRunner, type MessagesClient } from "./runner.js";
import type { AgentDefinition, AgentNote, AgentRunRow, AgentStateRow } from "./types.js";

/**
 * Registry + scheduling for agents. Agents are OFF unless AGENTS_ENABLED=true
 * and the Anthropic provider is configured; individual agents can be disabled
 * by an admin. Runs are sequential and bounded.
 */
export class Agents {
  private readonly runner: AgentRunner | null;
  readonly enabled: boolean;
  private running = false;

  constructor(
    private readonly app: App,
    cfg: Config,
    client?: MessagesClient,
  ) {
    const canRun = cfg.AGENTS_ENABLED && (client !== undefined || (cfg.AI_PROVIDER === "anthropic" && !!cfg.ANTHROPIC_API_KEY));
    this.enabled = canRun;
    this.runner = canRun
      ? new AgentRunner(app, client ?? createAnthropicClient(cfg.ANTHROPIC_API_KEY!, cfg.ANTHROPIC_WORKSPACE_ID).messages, {
          model: cfg.AGENT_MODEL ?? cfg.ANTHROPIC_MODEL,
          inputCostPerMTok: cfg.AI_INPUT_COST_PER_MTOK,
          outputCostPerMTok: cfg.AI_OUTPUT_COST_PER_MTOK,
          dailyCostCapUsd: cfg.AGENT_DAILY_COST_CAP_USD,
        })
      : null;
    for (const a of AGENTS) {
      app.db.prepare("INSERT INTO agent_state (name, next_run_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING").run(a.name, new Date(Date.now() + 5 * 60_000).toISOString());
    }
  }

  definitions(): AgentDefinition[] {
    return AGENTS;
  }
  get(name: string): AgentDefinition | undefined {
    return AGENTS.find((a) => a.name === name);
  }

  state(): (AgentStateRow & { title: string; description: string; interval_hours: number })[] {
    const rows = this.app.db.prepare("SELECT * FROM agent_state").all() as unknown as AgentStateRow[];
    return AGENTS.map((a) => {
      const s = rows.find((r) => r.name === a.name)!;
      return { ...s, title: a.title, description: a.description, interval_hours: a.intervalHours };
    });
  }

  setEnabled(name: string, enabled: boolean, actor: string): void {
    if (!this.get(name)) throw new Error(`unknown agent ${name}`);
    this.app.db.prepare("UPDATE agent_state SET enabled = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE name = ?").run(enabled ? 1 : 0, name);
    this.app.events.record({ type: "agent.enabled_changed", actor, riskLevel: "medium", payload: { agent: name, enabled } });
  }

  runs(opts: { agent?: string; limit?: number } = {}): AgentRunRow[] {
    return opts.agent
      ? (this.app.db.prepare("SELECT * FROM agent_runs WHERE agent = ? ORDER BY started_at DESC LIMIT ?").all(opts.agent, opts.limit ?? 20) as unknown as AgentRunRow[])
      : (this.app.db.prepare("SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?").all(opts.limit ?? 20) as unknown as AgentRunRow[]);
  }

  notes(opts: { unreadOnly?: boolean; limit?: number } = {}): AgentNote[] {
    return this.app.db.prepare(`SELECT * FROM agent_notes ${opts.unreadOnly ? "WHERE read_at IS NULL" : ""} ORDER BY created_at DESC LIMIT ?`).all(opts.limit ?? 50) as unknown as AgentNote[];
  }
  markNoteRead(id: number): void {
    this.app.db.prepare("UPDATE agent_notes SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND read_at IS NULL").run(id);
  }
  costSince(since: string): number {
    return (this.app.db.prepare("SELECT COALESCE(SUM(estimated_cost_usd),0) s FROM agent_runs WHERE started_at >= ?").get(since) as { s: number }).s;
  }

  /** Run one agent now (admin action). */
  async runNow(name: string, trigger: "schedule" | "manual" = "manual"): Promise<AgentRunRow> {
    const def = this.get(name);
    if (!def) throw new Error(`unknown agent ${name}`);
    if (!this.runner) throw new Error("agents are disabled (set AGENTS_ENABLED=true and configure the Anthropic provider)");
    if (this.running) throw new Error("another agent run is in progress");
    this.running = true;
    try {
      const row = await this.runner.run(def, trigger);
      this.app.db
        .prepare("UPDATE agent_state SET last_run_at = ?, last_status = ?, next_run_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE name = ?")
        .run(row.started_at, row.status, new Date(Date.now() + def.intervalHours * 3_600_000).toISOString(), name);
      return row;
    } finally {
      this.running = false;
    }
  }

  /** Scheduler job: run at most one due, enabled agent per tick. */
  async runDue(now = new Date()): Promise<number> {
    if (!this.runner || this.running) return 0;
    const due = this.app.db
      .prepare("SELECT name FROM agent_state WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT 1")
      .get(now.toISOString()) as { name: string } | undefined;
    if (!due) return 0;
    try {
      await this.runNow(due.name, "schedule");
    } catch (err) {
      log.error("scheduled agent run failed", { agent: due.name, ...errorFields(err) });
    }
    return 1;
  }
}
