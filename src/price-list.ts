/**
 * Turns a free-text price list (typed by the owner, or read from a page) into
 * labelled prices, and lines them up across businesses so like is compared with
 * like: trial with trial, an 8-class pass with an 8-class pass.
 */
import { currencyOf, moneyPattern, parseAmount, periodOf } from "./money.js";

export type PriceKind = "trial" | "single" | "pass" | "unlimited" | "other";

export interface PriceItem {
  label: string;
  amount: number;
  currency: string | null;
  /** Billing period as written ("month", "year"); null for a one-off price. */
  period: string | null;
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

/** A number standing alone ("разове заняття 350"): not a time, a decimal part or a longer number. */
const BARE_AMOUNT = /(?<![\d.,:\p{L}])(\d{2,6})(?![\d:\p{L}%]|[.,]\d)/u;

/** The currency a typed list is written in: the one its amounts name most often. */
function mainCurrency(text: string): string | null {
  const counts = new Map<string, number>();
  for (const m of text.matchAll(moneyPattern())) {
    const c = currencyOf(m[1] ?? m[4] ?? "");
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * A price written as a plain number, accepted only where the words say what it is
 * ("разове заняття 350"). Class counts ("на 8 занять") are taken out first so they
 * are never mistaken for the price.
 */
function bareAmount(segment: string, currency: string | null): PriceItem | null {
  const { kind, classes } = classify(segment);
  if (kind === "other") return null;
  const m = BARE_AMOUNT.exec(segment.replace(new RegExp(COUNT.source, "giu"), " "));
  if (!m) return null;
  const amount = Number(m[1]);
  const label = segment.replace(m[1]!, " ").replace(/\s+/g, " ").replace(TRIM, "").trim();
  return { label, amount, currency, period: null, kind, classes };
}

export interface ParseOptions {
  /**
   * Owner-typed lists: read a plain number as a price when its words name a kind
   * of price, in the list's main currency. Off for page text, where plain numbers
   * are mostly times, dates and addresses.
   */
  bareAmounts?: boolean;
}

/**
 * One price per amount found. A line's label is its own words; a line that is
 * only an amount (common on rendered pages: "1 відвідування" / "1 день" / "200 ₴")
 * borrows the few short lines above it.
 */
export function parsePriceList(text: string, options: ParseOptions = {}): PriceItem[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const items: PriceItem[] = [];
  const seen = new Set<string>();
  const listCurrency = options.bareAmounts ? mainCurrency(text) : null;
  const push = (item: PriceItem) => {
    const key = `${item.label}|${item.amount}|${item.currency}|${item.period}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };
  lines.forEach((line, i) => {
    if (!line) return;
    const matches = [...line.matchAll(moneyPattern())];
    if (!matches.length && !options.bareAmounts) return;
    // "Пробне - 300 грн, разове - 400 грн": each amount keeps the words beside it.
    const parts = line.split(/[;,](?!\d{3}\b)/u);
    const hasBare = !!options.bareAmounts && parts.some((part) => !moneyPattern().test(part) && bareAmount(part, listCurrency));
    const segments = matches.length > 1 || hasBare ? parts : [line];
    for (const segment of segments) {
      const m = [...segment.matchAll(moneyPattern())][0];
      if (!m) {
        const bare = options.bareAmounts ? bareAmount(segment, listCurrency) : null;
        if (bare && HAS_LETTER.test(bare.label)) push(bare);
        continue;
      }
      const amount = parseAmount(m[2] ?? m[3] ?? "");
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const currency = currencyOf(m[1] ?? m[4] ?? "");
      const period = periodOf(m[5]);
      let label = cleanLabel(segment);
      let context = label;
      if (!HAS_LETTER.test(label)) ({ label, context } = labelFromAbove(lines, i));
      push({ label, amount, currency, period, ...classify(context) });
    }
  });
  return items;
}

/**
 * Recovers the name of an amount that sits on a line of its own. Two layouts are
 * common: the name directly above the amount, with features listed after it
 * ("Starter" / "£19/month" / "1 project"), or a card whose details sit between
 * name and amount ("Разове заняття" / "Кількість" / "1 день" / "350 ₴" / "Купити").
 * A wordy line right above the amount is the name; otherwise walk up to the
 * previous amount (skipping that card's one-word button) and name the card by its
 * first two lines, letting the whole card decide what kind of price it is.
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
  const nearest = above[above.length - 1];
  if (nearest && !/\d/.test(nearest)) return { label: nearest, context: nearest };
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
