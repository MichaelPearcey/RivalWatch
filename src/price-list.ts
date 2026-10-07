/**
 * Turns a free-text price list (typed by the owner, or read from a page) into
 * labelled prices, and lines them up across businesses so like is compared with
 * like: trial with trial, an 8-class pass with an 8-class pass.
 */
import { currencyOf, moneyPattern, parseAmount } from "./money.js";

export type PriceKind = "trial" | "single" | "pass" | "unlimited" | "other";

export interface PriceItem {
  label: string;
  amount: number;
  currency: string | null;
  kind: PriceKind;
  /** Classes in a pass ("абонемент на 8 занять" = 8); null when not stated. */
  classes: number | null;
}

const TRIAL = /пробн|trial|probe|essai|prueba/iu;
const UNLIMITED = /безлім|безлим|unlimited|unbegrenzt|illimit|ilimitad/iu;
const SINGLE = /разов|одноразов|single|drop[- ]?in|einzel|à l'unité|suelta/iu;
const CLASS_WORD = "(?:занят\\p{L}*|тренуван\\p{L}*|трениров\\p{L}*|відвідуван\\p{L}*|посещен\\p{L}*|урок\\p{L}*|classes?|lessons?|sessions?|visits?|stunden?|cours|clases?)";
const COUNT = new RegExp(`(\\d{1,3})\\s*(?:-?\\s*)${CLASS_WORD}(?![\\p{L}])`, "iu");
const PASS = /абонемент|subscription|membership|pass\b|package|abo\b|carnet|bono/iu;

export function classify(label: string): { kind: PriceKind; classes: number | null } {
  if (TRIAL.test(label)) return { kind: "trial", classes: null };
  if (UNLIMITED.test(label)) return { kind: "unlimited", classes: null };
  const count = COUNT.exec(label);
  const classes = count ? Number(count[1]) : null;
  if (SINGLE.test(label) || classes === 1) return { kind: "single", classes: null };
  if (classes !== null || PASS.test(label)) return { kind: "pass", classes };
  return { kind: "other", classes: null };
}

const HAS_LETTER = /\p{L}/u;
const TRIM = /^[\s:;,.\-–—•*|()]+|[\s:;,\-–—•*|(]+$/gu;

function cleanLabel(text: string): string {
  return text.replace(moneyPattern(), " ").replace(/\s+/g, " ").replace(TRIM, "").trim();
}

/**
 * One price per amount found. A line's label is its own words; a line that is
 * only an amount (common on rendered pages: "1 відвідування" / "1 день" / "200 ₴")
 * borrows the few short lines above it.
 */
export function parsePriceList(text: string): PriceItem[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const items: PriceItem[] = [];
  const seen = new Set<string>();
  lines.forEach((line, i) => {
    if (!line) return;
    const matches = [...line.matchAll(moneyPattern())];
    if (!matches.length) return;
    // "Пробне - 300 грн, разове - 400 грн": each amount keeps the words beside it.
    const segments = matches.length > 1 ? line.split(/[;,](?!\d{3}\b)/u) : [line];
    for (const segment of segments) {
      const m = [...segment.matchAll(moneyPattern())][0];
      if (!m) continue;
      const amount = parseAmount(m[2] ?? m[3] ?? "");
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const currency = currencyOf(m[1] ?? m[4] ?? "");
      let label = cleanLabel(segment);
      let context = label;
      if (!HAS_LETTER.test(label)) ({ label, context } = labelFromAbove(lines, i));
      const key = `${label}|${amount}|${currency}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ label, amount, currency, ...classify(context) });
    }
  });
  return items;
}

/**
 * A price card on a rendered page reads top-down: title, subtitle, details, amount,
 * button. Walk up to the previous amount (skipping that card's button) to recover
 * the card: its first two lines name it, the whole card decides what kind it is.
 */
function labelFromAbove(lines: string[], index: number): { label: string; context: string } {
  const above: string[] = [];
  let bounded = false;
  for (let j = index - 1; j >= 0 && above.length < 10; j--) {
    const line = lines[j]!;
    if (!line) continue;
    if (moneyPattern().test(line) || line.length > 80) {
      bounded = moneyPattern().test(line);
      break;
    }
    above.unshift(line);
  }
  // A single word right after the previous amount is that card's button ("Купити").
  if (bounded && above[0] && !/\s/.test(above[0])) above.shift();
  const card = bounded ? above : above.slice(-6);
  return { label: card.slice(0, 2).join(" · "), context: card.join(" · ") };
}

export type PriceColumn = { kind: "trial" } | { kind: "single" } | { kind: "pass"; classes: number | null } | { kind: "unlimited" };

export const columnKey = (c: PriceColumn): string => (c.kind === "pass" ? `pass:${c.classes ?? "?"}` : c.kind);

function columnOf(item: PriceItem): PriceColumn | null {
  if (item.kind === "other") return null;
  return item.kind === "pass" ? { kind: "pass", classes: item.classes } : { kind: item.kind };
}

export interface ComparisonRow<S> {
  subject: S;
  items: PriceItem[];
  /** Cheapest price per column key; missing key = we have no such price. */
  cells: Record<string, PriceItem>;
}

export interface Comparison<S> {
  columns: PriceColumn[];
  rows: ComparisonRow<S>[];
  /** Column key -> lowest amount among rows quoting that column in the same currency as the first row that does. */
  lowest: Record<string, { amount: number; currency: string | null }>;
}

const ORDER: Record<PriceColumn["kind"], number> = { trial: 0, single: 1, pass: 2, unlimited: 3 };

export function compare<S>(subjects: { subject: S; items: PriceItem[] }[]): Comparison<S> {
  const columns = new Map<string, PriceColumn>();
  const rows = subjects.map(({ subject, items }) => {
    const cells: Record<string, PriceItem> = {};
    for (const item of items) {
      const column = columnOf(item);
      if (!column) continue;
      const key = columnKey(column);
      columns.set(key, column);
      const current = cells[key];
      if (!current || item.amount < current.amount) cells[key] = item;
    }
    return { subject, items, cells };
  });
  const sorted = [...columns.values()].sort((a, b) => {
    const byKind = ORDER[a.kind] - ORDER[b.kind];
    if (byKind || a.kind !== "pass" || b.kind !== "pass") return byKind;
    return (a.classes ?? Number.MAX_SAFE_INTEGER) - (b.classes ?? Number.MAX_SAFE_INTEGER);
  });
  const lowest: Comparison<S>["lowest"] = {};
  for (const column of sorted) {
    const key = columnKey(column);
    const quoted = rows.map((r) => r.cells[key]).filter((c): c is PriceItem => !!c);
    const currency = quoted[0]?.currency ?? null;
    const sameCurrency = quoted.filter((c) => c.currency === currency);
    // A "cheapest" mark needs at least two prices that can honestly be compared.
    if (sameCurrency.length >= 2) lowest[key] = { amount: Math.min(...sameCurrency.map((c) => c.amount)), currency };
  }
  return { columns: sorted, rows, lowest };
}
