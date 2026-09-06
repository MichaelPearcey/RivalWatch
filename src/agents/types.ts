import type { z } from "zod";
import type { App } from "../app.js";

/**
 * Agents are scheduled LLM runs with a role prompt and a whitelist of tools.
 * Tools are either read-only ("read") or one of the two sanctioned ways to
 * affect the world: creating an approval request or writing a note for humans
 * ("write"). Nothing else exists, so an agent cannot exceed its tier by design.
 */
export interface AgentContext {
  app: App;
  agent: AgentDefinition;
  runId: number;
  actor: string; // agent:<name>
}

export interface Tool<T = unknown> {
  name: string;
  description: string;
  schema: z.ZodType<T>;
  kind: "read" | "write";
  /** Return value is JSON-serialised and handed back to the model. Throw to report an error. */
  run(ctx: AgentContext, input: T): Promise<unknown> | unknown;
}

export interface AgentDefinition {
  /** Stable id, used as actor "agent:<name>" and in agent_state. */
  name: string;
  title: string;
  description: string;
  systemPrompt: string;
  /** Built at run time so it reflects current data; becomes the first user message. */
  buildBriefing(app: App): string;
  tools: Tool[];
  /** How often the scheduler runs this agent. */
  intervalHours: number;
  maxTurns: number;
  /** Hard cap on estimated spend for a single run (USD). */
  maxCostUsd: number;
  /** Manager-tier agents may decide medium-risk approvals. */
  isManager?: boolean;
}

export interface AgentRunRow {
  id: number;
  agent: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "ok" | "failed" | "capped";
  trigger: "schedule" | "manual";
  model: string | null;
  turns: number;
  tool_calls: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  summary: string | null;
  error: string | null;
}

export interface AgentNote {
  id: number;
  agent: string;
  run_id: number | null;
  created_at: string;
  kind: "report" | "draft" | "recommendation";
  title: string;
  body: string;
  read_at: string | null;
}

export interface AgentStateRow {
  name: string;
  enabled: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  updated_at: string;
}
