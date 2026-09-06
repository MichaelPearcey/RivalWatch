import type { Config } from "../config.js";
import type { Events } from "../events.js";
import { errorFields, log } from "../logger.js";
import { AnthropicAnalyzer } from "./anthropic.js";
import { HeuristicAnalyzer } from "./heuristic.js";
import { PROMPT_VERSION } from "./prompt.js";
import type { AnalysisInput, AnalysisResult, Analyzer } from "./types.js";

export interface GuardOptions {
  /** Max model calls per rolling 24h. 0 = unlimited. */
  dailyCallCap: number;
  /** Max estimated spend per rolling 24h in USD. 0 = unlimited. */
  dailyCostCapUsd: number;
  inputCostPerMTok: number;
  outputCostPerMTok: number;
}

/**
 * Wraps a primary analyser with hard daily call and cost caps, per-call cost
 * logging (as ai.call events with estimated_cost_usd) and a fallback to the
 * heuristic analyser on failure. The pipeline only ever sees this.
 */
export class GuardedAnalyzer implements Analyzer {
  readonly name: string;
  private readonly fallback = new HeuristicAnalyzer();

  constructor(
    private readonly primary: Analyzer,
    private readonly events: Events,
    private readonly opts: GuardOptions,
  ) {
    this.name = primary.name;
  }

  estimateCost(inputTokens: number | null, outputTokens: number | null): number {
    return ((inputTokens ?? 0) * this.opts.inputCostPerMTok + (outputTokens ?? 0) * this.opts.outputCostPerMTok) / 1_000_000;
  }

  async analyze(input: AnalysisInput): Promise<AnalysisResult> {
    if (this.primary.name === "heuristic") return { ...(await this.primary.analyze(input)), estimatedCostUsd: 0 };

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const calls = this.events.countSince("ai.call", since);
    const spend = this.events.costSince(since);
    const capHit = (this.opts.dailyCallCap > 0 && calls >= this.opts.dailyCallCap) || (this.opts.dailyCostCapUsd > 0 && spend >= this.opts.dailyCostCapUsd);
    if (capHit) {
      this.events.record({
        type: "ai.cap_reached",
        result: "denied",
        riskLevel: "medium",
        payload: { provider: this.primary.name, calls_24h: calls, call_cap: this.opts.dailyCallCap, spend_24h_usd: round(spend), cost_cap_usd: this.opts.dailyCostCapUsd },
      });
      log.warn("AI daily cap reached; using heuristic analyser", { calls, spend });
      return { ...(await this.fallback.analyze(input)), estimatedCostUsd: 0 };
    }

    const started = Date.now();
    try {
      const result = await this.primary.analyze(input);
      const cost = this.estimateCost(result.inputTokens, result.outputTokens);
      this.events.record({
        type: "ai.call",
        estimatedCostUsd: cost,
        payload: {
          provider: result.provider,
          model: result.model,
          prompt_version: PROMPT_VERSION,
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          duration_ms: Date.now() - started,
        },
      });
      return { ...result, estimatedCostUsd: cost };
    } catch (err) {
      this.events.record({ type: "ai.failed", result: "failed", payload: { provider: this.primary.name, duration_ms: Date.now() - started, ...errorFields(err) } });
      log.error("primary analyser failed; falling back to heuristic", errorFields(err));
      return { ...(await this.fallback.analyze(input)), estimatedCostUsd: 0 };
    }
  }
}

export function createAnalyzer(cfg: Config, events: Events): Analyzer {
  const primary: Analyzer =
    cfg.AI_PROVIDER === "anthropic" ? new AnthropicAnalyzer({ apiKey: cfg.ANTHROPIC_API_KEY!, model: cfg.ANTHROPIC_MODEL, workspaceId: cfg.ANTHROPIC_WORKSPACE_ID }) : new HeuristicAnalyzer();
  return new GuardedAnalyzer(primary, events, {
    dailyCallCap: cfg.AI_DAILY_CALL_CAP,
    dailyCostCapUsd: cfg.AI_DAILY_COST_CAP_USD,
    inputCostPerMTok: cfg.AI_INPUT_COST_PER_MTOK,
    outputCostPerMTok: cfg.AI_OUTPUT_COST_PER_MTOK,
  });
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
