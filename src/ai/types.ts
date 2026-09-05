import { z } from "zod";
import type { InsightCategory, PageKind } from "../db/repo.js";
import type { Signal } from "../monitor/detect.js";

export interface AnalysisInput {
  business: { name: string; description: string | null; pricing_notes: string | null };
  competitor: { name: string; website: string };
  page: { url: string; kind: PageKind; title: string | null };
  change: {
    added: string[];
    removed: string[];
    signals: Signal[];
    significance: number;
    /** Optional surrounding context from the new page (bounded). */
    context?: string;
  };
}

export const InsightDraftSchema = z.object({
  matters: z.boolean(),
  category: z.enum(["pricing", "product", "promotion", "positioning", "content", "announcement", "landing_page", "noise", "other"]),
  importance: z.number().int().min(1).max(5),
  headline: z.string().min(1).max(200),
  summary: z.string().min(1).max(1200),
  why_it_matters: z.string().min(1).max(1200),
});

export type InsightDraft = z.infer<typeof InsightDraftSchema> & { category: InsightCategory };

export interface AnalysisResult {
  draft: InsightDraft;
  provider: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface Analyzer {
  readonly name: string;
  analyze(input: AnalysisInput): Promise<AnalysisResult>;
}
