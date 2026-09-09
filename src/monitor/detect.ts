import { createHash } from "node:crypto";
import { diffLines } from "diff";
import type { PageKind } from "../db/repo.js";
import { pricePattern } from "../money.js";

export type Signal = "price" | "percentage" | "promo" | "launch" | "announcement" | "large_edit" | "heading";

export interface Detection {
  changed: boolean;
  /** Fraction of characters in the union of both texts that differ (0..1). */
  changeRatio: number;
  /** 0..1 score combining change size, page kind and vocabulary signals. */
  significance: number;
  added: string[];
  removed: string[];
  signals: Signal[];
}

export interface DetectOptions {
  kind: PageKind;
  /** Significance below this is treated as noise. */
  threshold?: number;
}

export const DEFAULT_THRESHOLD = 0.15;

const PRICE_RE = pricePattern();
const PCT_RE = /\d+\s?%/;
const PROMO_RE = /\b(?:sale|discount|off\b|coupon|promo|deal|save|free trial|limited time|black friday|offer)\b/i;
const LAUNCH_RE = /\b(?:new|launch(?:ed|ing)?|introducing|now available|coming soon|beta|announc\w+|release[sd]?)\b/i;
const ANNOUNCE_RE = /\b(?:acquir\w+|partner\w+|funding|raised|series [a-z]|hiring|webinar|event)\b/i;

const KIND_WEIGHT: Record<PageKind, number> = {
  pricing: 1.0,
  products: 0.85,
  home: 0.7,
  blog: 0.6,
  other: 0.6,
};

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Lines that are pure noise even after normalisation (menu crumbs, single tokens). */
function isNoiseLine(line: string): boolean {
  const t = line.trim();
  if (t.length < 3) return true;
  if (/^<(?:date|time|ago|year|hex|token|counter)>$/.test(t)) return true;
  if (/^[\d\W]+$/.test(t) && !PRICE_RE.test(t)) return true; // digits/punct only, unless it is a price
  return false;
}

export function detectChange(prevText: string, nextText: string, opts: DetectOptions): Detection {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  if (prevText === nextText) {
    return { changed: false, changeRatio: 0, significance: 0, added: [], removed: [], signals: [] };
  }

  const parts = diffLines(prevText.endsWith("\n") ? prevText : prevText + "\n", nextText.endsWith("\n") ? nextText : nextText + "\n");
  const added: string[] = [];
  const removed: string[] = [];
  let changedChars = 0;
  for (const p of parts) {
    if (!p.added && !p.removed) continue;
    const lines = p.value.split("\n").filter((l) => l.length > 0 && !isNoiseLine(l));
    changedChars += lines.join("").length;
    (p.added ? added : removed).push(...lines);
  }

  // Lines that merely moved (present in both added and removed) are not changes.
  const removedSet = new Set(removed);
  const addedSet = new Set(added);
  const realAdded = added.filter((l) => !removedSet.has(l));
  const realRemoved = removed.filter((l) => !addedSet.has(l));

  if (realAdded.length === 0 && realRemoved.length === 0) {
    return { changed: false, changeRatio: 0, significance: 0, added: [], removed: [], signals: [] };
  }

  const total = Math.max(1, Math.max(prevText.length, nextText.length));
  const changeRatio = Math.min(1, changedChars / total);

  const all = [...realAdded, ...realRemoved].join("\n");
  const signals: Signal[] = [];
  if (PRICE_RE.test(all)) signals.push("price");
  if (PCT_RE.test(all)) signals.push("percentage");
  if (PROMO_RE.test(all)) signals.push("promo");
  if (LAUNCH_RE.test(all)) signals.push("launch");
  if (ANNOUNCE_RE.test(all)) signals.push("announcement");
  if (changeRatio > 0.3) signals.push("large_edit");

  // Score: size of change (log-scaled so a one-line price change still counts),
  // boosted by vocabulary signals and page kind.
  const sizeScore = Math.min(1, Math.log1p(changeRatio * 40) / Math.log1p(40)); // 0..1
  let signalScore = 0;
  if (signals.includes("price")) signalScore += 0.45;
  if (signals.includes("promo")) signalScore += 0.25;
  if (signals.includes("launch")) signalScore += 0.25;
  if (signals.includes("percentage")) signalScore += 0.1;
  if (signals.includes("announcement")) signalScore += 0.15;
  signalScore = Math.min(1, signalScore);

  const raw = 0.5 * sizeScore + 0.5 * signalScore;
  const significance = Math.min(1, raw * (0.6 + 0.4 * KIND_WEIGHT[opts.kind]) + (opts.kind === "pricing" && signals.includes("price") ? 0.2 : 0));

  return {
    changed: significance >= threshold,
    changeRatio,
    significance: round3(significance),
    added: realAdded,
    removed: realRemoved,
    signals,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
