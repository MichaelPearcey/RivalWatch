import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { Config } from "../config.js";
import type { Events } from "../events.js";
import { errorFields, log } from "../logger.js";
import { createAnthropicClient } from "./anthropic.js";

export type MessagesClient = Pick<Anthropic["messages"], "create">;

/**
 * Generic guarded JSON completion for non-insight features (competitor profiles,
 * future summaries). Shares the daily call/cost caps and ai.call/ai.failed
 * events with the analyser. Returns null when the model is unavailable or
 * capped, so callers must have a heuristic fallback.
 */
export class JsonLlm {
  private readonly client: MessagesClient | null;

  constructor(
    private readonly cfg: Config,
    private readonly events: Events,
    client?: MessagesClient,
  ) {
    this.client = client ?? (cfg.AI_PROVIDER === "anthropic" && cfg.ANTHROPIC_API_KEY ? createAnthropicClient(cfg.ANTHROPIC_API_KEY, cfg.ANTHROPIC_WORKSPACE_ID).messages : null);
  }

  get available(): boolean {
    return this.client !== null;
  }

  private capped(): boolean {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const calls = this.events.countSince("ai.call", since);
    const spend = this.events.costSince(since);
    return (this.cfg.AI_DAILY_CALL_CAP > 0 && calls >= this.cfg.AI_DAILY_CALL_CAP) || (this.cfg.AI_DAILY_COST_CAP_USD > 0 && spend >= this.cfg.AI_DAILY_COST_CAP_USD);
  }

  async complete<T>(purpose: string, system: string, user: string, schema: z.ZodType<T>, opts: { maxTokens?: number; accountId?: number | null } = {}): Promise<{ data: T; model: string; costUsd: number } | null> {
    if (!this.client) return null;
    if (this.capped()) {
      this.events.record({ type: "ai.cap_reached", result: "denied", riskLevel: "medium", accountId: opts.accountId ?? null, payload: { purpose } });
      return null;
    }
    const started = Date.now();
    try {
      const res = await this.client.create({ model: this.cfg.ANTHROPIC_MODEL, max_tokens: opts.maxTokens ?? 1200, temperature: 0.2, system, messages: [{ role: "user", content: user }] });
      const text = res.content.map((c) => ("text" in c ? c.text : "")).join("");
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start === -1 || end < start) throw new Error("no JSON object in response");
      const data = schema.parse(JSON.parse(text.slice(start, end + 1)));
      const costUsd = (res.usage.input_tokens * this.cfg.AI_INPUT_COST_PER_MTOK + res.usage.output_tokens * this.cfg.AI_OUTPUT_COST_PER_MTOK) / 1_000_000;
      this.events.record({ type: "ai.call", accountId: opts.accountId ?? null, estimatedCostUsd: costUsd, payload: { purpose, provider: "anthropic", model: res.model, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens, duration_ms: Date.now() - started } });
      return { data, model: res.model, costUsd };
    } catch (err) {
      this.events.record({ type: "ai.failed", result: "failed", accountId: opts.accountId ?? null, payload: { purpose, provider: "anthropic", ...errorFields(err) } });
      log.warn("llm completion failed", { purpose, ...errorFields(err) });
      return null;
    }
  }
}
