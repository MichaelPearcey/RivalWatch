import Anthropic from "@anthropic-ai/sdk";
import { log } from "../logger.js";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt.js";
import { InsightDraftSchema, type AnalysisInput, type AnalysisResult, type Analyzer } from "./types.js";

export interface AnthropicAnalyzerOptions {
  apiKey: string;
  model: string;
  /** Injectable for tests. */
  client?: Pick<Anthropic["messages"], "create">;
}

export class AnthropicAnalyzer implements Analyzer {
  readonly name = "anthropic";
  private readonly client: Pick<Anthropic["messages"], "create">;

  constructor(private readonly opts: AnthropicAnalyzerOptions) {
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey }).messages;
  }

  async analyze(input: AnalysisInput): Promise<AnalysisResult> {
    const user = buildUserPrompt(input);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.client.create({
        model: this.opts.model,
        max_tokens: 600,
        temperature: 0.2,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: user }],
      });
      const text = res.content.map((c) => ("text" in c ? c.text : "")).join("");
      try {
        const json = JSON.parse(extractJsonObject(text));
        const draft = InsightDraftSchema.parse(json);
        return {
          draft,
          provider: this.name,
          model: res.model,
          inputTokens: res.usage?.input_tokens ?? null,
          outputTokens: res.usage?.output_tokens ?? null,
        };
      } catch (err) {
        lastError = err;
        log.warn("anthropic analyser returned invalid JSON; retrying", { attempt, error: (err as Error).message });
      }
    }
    throw new Error(`Anthropic analyser produced invalid output: ${(lastError as Error)?.message}`);
  }
}

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("no JSON object found");
  return text.slice(start, end + 1);
}
