import type { Config } from "../config.js";
import type { Events } from "../events.js";
import { errorFields, log } from "../logger.js";
import { AnthropicAnalyzer } from "./anthropic.js";
import { HeuristicAnalyzer } from "./heuristic.js";
import { PROMPT_VERSION } from "./prompt.js";
import type { AnalysisInput, AnalysisResult, Analyzer } from "./types.js";

/**
 * Wraps a primary analyser with: daily call cap, cost/usage events, and a
 * fallback to the heuristic analyser on failure. The pipeline only sees this.
 */
export class GuardedAnalyzer implements Analyzer {
  readonly name: string;
  private readonly fallback = new HeuristicAnalyzer();

  constructor(
    private readonly primary: Analyzer,
    private readonly events: Events,
    private readonly dailyCap: number,
  ) {
    this.name = primary.name;
  }

  async analyze(input: AnalysisInput): Promise<AnalysisResult> {
    if (this.primary.name === "heuristic") return this.primary.analyze(input);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    if (this.dailyCap > 0 && this.events.countSince("ai.call", since) >= this.dailyCap) {
      this.events.record({ type: "ai.cap_reached", payload: { cap: this.dailyCap, provider: this.primary.name } });
      log.warn("AI daily call cap reached; using heuristic analyser", { cap: this.dailyCap });
      return this.fallback.analyze(input);
    }

    const started = Date.now();
    try {
      const result = await this.primary.analyze(input);
      this.events.record({
        type: "ai.call",
        payload: {
          provider: result.provider,
          model: result.model,
          prompt_version: PROMPT_VERSION,
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          duration_ms: Date.now() - started,
        },
      });
      return result;
    } catch (err) {
      this.events.record({ type: "ai.failed", payload: { provider: this.primary.name, ...errorFields(err) } });
      log.error("primary analyser failed; falling back to heuristic", errorFields(err));
      return this.fallback.analyze(input);
    }
  }
}

export function createAnalyzer(cfg: Config, events: Events): Analyzer {
  const primary: Analyzer =
    cfg.AI_PROVIDER === "anthropic"
      ? new AnthropicAnalyzer({ apiKey: cfg.ANTHROPIC_API_KEY!, model: cfg.ANTHROPIC_MODEL })
      : new HeuristicAnalyzer();
  return new GuardedAnalyzer(primary, events, cfg.AI_DAILY_CALL_CAP);
}
