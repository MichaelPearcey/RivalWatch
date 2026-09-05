import type { InsightCategory } from "../db/repo.js";
import type { AnalysisInput, AnalysisResult, Analyzer, InsightDraft } from "./types.js";

interface Money {
  raw: string;
  symbol: string;
  amount: number;
  period: string | null;
}

const MONEY_RE = /([£$€])\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)(?:\s?\/\s?(month|mo|year|yr|user|seat))?/gi;

export function parseMoney(text: string): Money[] {
  const out: Money[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    out.push({
      raw: m[0].replace(/\s+/g, ""),
      symbol: m[1]!,
      amount: Number(m[2]!.replace(/,/g, "")),
      period: m[3] ? (m[3].startsWith("y") ? "year" : m[3].startsWith("m") ? "month" : m[3]) : null,
    });
  }
  return out;
}

function fmt(m: Money): string {
  return `${m.symbol}${m.amount}${m.period ? `/${m.period}` : ""}`;
}

function pct(from: number, to: number): string {
  const p = ((to - from) / from) * 100;
  return `${p > 0 ? "+" : ""}${p.toFixed(0)}%`;
}

/**
 * Deterministic, zero-cost analyser. Used by default, in tests, and as a
 * fallback when the LLM provider is unavailable. Quality is deliberately
 * modest; its job is to keep the loop working and be obviously "rule-based".
 */
export class HeuristicAnalyzer implements Analyzer {
  readonly name = "heuristic";

  async analyze(input: AnalysisInput): Promise<AnalysisResult> {
    return { draft: this.draft(input), provider: this.name, model: null, inputTokens: null, outputTokens: null };
  }

  draft(input: AnalysisInput): InsightDraft {
    const { competitor, page, change, business } = input;
    const addedText = change.added.join("\n");
    const removedText = change.removed.join("\n");
    const signals = new Set(change.signals);

    // --- Pricing ---
    const oldPrices = parseMoney(removedText);
    const newPrices = parseMoney(addedText);
    if (signals.has("price") && (oldPrices.length || newPrices.length)) {
      const moves: string[] = [];
      const paired = Math.min(oldPrices.length, newPrices.length);
      for (let i = 0; i < paired; i++) {
        const a = oldPrices[i]!;
        const b = newPrices[i]!;
        if (a.amount !== b.amount) moves.push(`${fmt(a)} → ${fmt(b)} (${pct(a.amount, b.amount)})`);
      }
      const introduced = newPrices.slice(paired).map(fmt);
      const dropped = oldPrices.slice(paired).map(fmt);

      const bits: string[] = [];
      if (moves.length) bits.push(`price changes: ${moves.join(", ")}`);
      if (introduced.length) bits.push(`new price points: ${introduced.join(", ")}`);
      if (dropped.length) bits.push(`removed price points: ${dropped.join(", ")}`);
      if (bits.length === 0) bits.push("pricing copy was edited");

      const headline = moves.length
        ? `${competitor.name} changed pricing: ${moves[0]}${moves.length > 1 ? ` and ${moves.length - 1} more` : ""}`
        : introduced.length
          ? `${competitor.name} added new price point${introduced.length > 1 ? "s" : ""}: ${introduced.join(", ")}`
          : `${competitor.name} updated its pricing page`;

      const changedNew = newPrices.filter((b, i) => i >= paired || oldPrices[i]!.amount !== b.amount);
      const why = this.compareToOwnPricing(business.pricing_notes, changedNew.length ? changedNew : newPrices) ??
        "Pricing moves by a direct competitor change how your own prices are perceived. Check whether your positioning still holds.";

      return {
        matters: true,
        category: "pricing",
        importance: moves.length ? 4 : 3,
        headline,
        summary: `On ${page.url} ${bits.join("; ")}.`,
        why_it_matters: why,
      };
    }

    // --- Promotions ---
    if (signals.has("promo")) {
      const line = pickLine(change.added, /\b(?:sale|discount|off|coupon|promo|deal|save|free trial|limited|offer)\b/i) ?? change.added[0] ?? "";
      return {
        matters: true,
        category: "promotion",
        importance: 3,
        headline: `${competitor.name} is running a promotion`,
        summary: `New promotional copy appeared on ${page.url}: "${truncate(line, 160)}"`,
        why_it_matters: "Promotions pull price-sensitive customers for a limited window. Consider whether to respond, wait it out, or emphasise value over price.",
      };
    }

    // --- Launches / products ---
    if (signals.has("launch")) {
      const line = pickLine(change.added, /\b(?:new|launch|introducing|now available|coming soon|beta|announc|release)/i) ?? change.added[0] ?? "";
      // Short added lines are usually headings, i.e. the name of the thing launched.
      const name = change.added.filter((l) => l.length <= 40 && !/[.!?]$/.test(l)).sort((a, b) => a.length - b.length)[0];
      const category: InsightCategory = page.kind === "blog" ? "content" : page.kind === "products" || page.kind === "home" ? "product" : "announcement";
      return {
        matters: true,
        category,
        importance: page.kind === "blog" ? 2 : 3,
        headline: name ? `${competitor.name} launched "${name}"` : `${competitor.name} announced something new`,
        summary: `New copy on ${page.url}: "${truncate(line, 160)}"`,
        why_it_matters: "New offerings or announcements can shift what customers expect as standard. Check whether this overlaps with your roadmap or a gap in your offer.",
      };
    }

    // --- Large rewrites ---
    if (signals.has("large_edit")) {
      return {
        matters: page.kind !== "blog" && page.kind !== "other",
        category: page.kind === "blog" ? "content" : "positioning",
        importance: page.kind === "home" || page.kind === "pricing" ? 3 : 2,
        headline: `${competitor.name} substantially rewrote its ${page.kind} page`,
        summary: `${change.removed.length} lines removed and ${change.added.length} added on ${page.url}. First new line: "${truncate(change.added[0] ?? "", 160)}"`,
        why_it_matters: "A large rewrite usually signals a repositioning, redesign or new campaign. Worth a look to see who they are now targeting.",
      };
    }

    // --- Everything else: small edit, probably noise ---
    return {
      matters: false,
      category: "noise",
      importance: 1,
      headline: `Minor edit on ${competitor.name}'s ${page.kind} page`,
      summary: `${change.removed.length} lines removed, ${change.added.length} added; no pricing, promotion or launch vocabulary detected.`,
      why_it_matters: "Probably cosmetic. Recorded for the audit trail only.",
    };
  }

  /**
   * Compare each of their changed prices with the customer's nearest comparable
   * price (same billing period). Annual prices are compared on an effective
   * monthly basis. Returns null when there is nothing comparable.
   */
  private compareToOwnPricing(pricingNotes: string | null, theirs: Money[]): string | null {
    if (!pricingNotes || theirs.length === 0) return null;
    const monthly = (m: Money) => (m.period === "year" ? m.amount / 12 : m.amount);
    const mine = parseMoney(pricingNotes);
    if (mine.length === 0) return null;
    const mineMonthly = mine.filter((m) => m.period !== "year");

    const sentences: string[] = [];
    for (const t of theirs.slice(0, 3)) {
      const candidates = t.period === "year" ? mine : mineMonthly.length ? mineMonthly : mine;
      if (candidates.length === 0) continue;
      const nearest = candidates.reduce((a, b) => (Math.abs(monthly(b) - monthly(t)) < Math.abs(monthly(a) - monthly(t)) ? b : a));
      const diff = ((monthly(t) - monthly(nearest)) / monthly(nearest)) * 100;
      const theirLabel = t.period === "year" ? `${fmt(t)} (≈${t.symbol}${(t.amount / 12).toFixed(2)}/month)` : fmt(t);
      if (Math.abs(diff) < 1) sentences.push(`Their ${theirLabel} now matches your ${fmt(nearest)}.`);
      else sentences.push(`Their ${theirLabel} is ${Math.abs(diff).toFixed(0)}% ${diff > 0 ? "above" : "below"} your nearest tier (${fmt(nearest)}).`);
    }
    if (sentences.length === 0) return null;
    if (theirs.some((t) => t.period === "year") && !mine.some((m) => m.period === "year")) {
      sentences.push("You do not offer an annual option; they now do.");
    }
    return sentences.join(" ");
  }
}

function pickLine(lines: string[], re: RegExp): string | undefined {
  return lines.find((l) => re.test(l));
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
