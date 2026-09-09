/**
 * Currency recognition shared by the extractor, the change detector and the
 * heuristic analyser. Amounts appear either symbol-first (£49) or amount-first
 * (800 грн, 49 GBP), and billing periods are written in the site's own language.
 */

const SYMBOL = "[£$€₴]";
const CODE = "(?:GBP|USD|EUR|UAH|PLN|грн\\.?|zł)";
const AMOUNT = "\\d{1,3}(?:[ \u00a0,]\\d{3})*(?:[.,]\\d{1,2})?";
const PERIOD = "(?:months?|mo|years?|yr|user|seat|міс\\.?|мес\\.?|рік|год)";
/** Stops "100 Gbps" and "20 EURO" being read as currency codes. */
const NOT_WORD = "(?![\\p{L}\\d])";

/** Matches one amount. Groups: 1+2 = symbol-first, 3+4 = amount-first, 5 = period. */
export function moneyPattern(flags = "gi"): RegExp {
  return new RegExp(
    `(?:(${SYMBOL})\\s?(${AMOUNT})|(${AMOUNT})\\s?(${SYMBOL}|${CODE})${NOT_WORD})(?:\\s?/\\s?(${PERIOD}))?`,
    `${flags}u`,
  );
}

/** Cheap "does this line talk about money at all" test, including a bare "/mo". */
export function pricePattern(): RegExp {
  return new RegExp(`(?:${SYMBOL}\\s?\\d|\\d\\s?${CODE}${NOT_WORD}|/\\s?${PERIOD}\\b)`, "iu");
}

const CURRENCIES: Record<string, string> = {
  "£": "GBP", gbp: "GBP",
  $: "USD", usd: "USD",
  "€": "EUR", eur: "EUR",
  "₴": "UAH", uah: "UAH", грн: "UAH", "грн.": "UAH",
  "zł": "PLN", pln: "PLN",
};

const PREFIXED = new Set(["GBP", "USD", "EUR"]);
const SYMBOL_OF: Record<string, string> = { GBP: "£", USD: "$", EUR: "€", UAH: "₴", PLN: "zł" };

/** ISO code for a matched symbol or code, or null when it is not one we know. */
export function currencyOf(token: string): string | null {
  return CURRENCIES[token.toLowerCase()] ?? null;
}

/** "month" | "year" | the raw word (user, seat), normalised across languages. */
export function periodOf(raw: string | undefined): string | null {
  if (!raw) return null;
  const p = raw.toLowerCase().replace(/\.$/, "");
  if (/^(months?|mo|міс|мес)$/.test(p)) return "month";
  if (/^(years?|yr|рік|год)$/.test(p)) return "year";
  return p;
}

export function parseAmount(raw: string): number {
  return Number(raw.replace(/[ \u00a0,]/g, ""));
}

/** Writes an amount the way its currency is normally written. */
export function formatMoney(currency: string | null, amount: number, period: string | null): string {
  const suffix = period ? `/${period}` : "";
  if (!currency) return `${amount}${suffix}`;
  const symbol = SYMBOL_OF[currency] ?? currency;
  return PREFIXED.has(currency) ? `${symbol}${amount}${suffix}` : `${amount} ${symbol}${suffix}`;
}
