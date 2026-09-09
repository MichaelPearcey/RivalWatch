import * as cheerio from "cheerio";
import { moneyPattern } from "../../money.js";

export interface Extracted {
  title: string | null;
  /** Normalised main text, one logical block per line. */
  text: string;
  meta: {
    wordCount: number;
    prices: string[];
    /** True when the page looks JS-rendered (almost no text, lots of script). */
    thin: boolean;
    links: number;
  };
}

const STRIP_SELECTORS = [
  "script",
  "style",
  "noscript",
  "svg",
  "iframe",
  "template",
  "nav",
  "header",
  "footer",
  "form",
  "[aria-hidden='true']",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  "[class*='cookie' i]",
  "[id*='cookie' i]",
  "[class*='consent' i]",
  "[id*='consent' i]",
  "[class*='newsletter' i]",
  "[class*='breadcrumb' i]",
  "[class*='social' i]",
  "[class*='share' i]",
  "[class*='advert' i]",
  "[class*='banner' i]",
].join(",");

const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "main", "aside", "li", "ul", "ol", "table", "tr", "td", "th",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "dl", "dt", "dd", "figure", "figcaption",
  "br", "hr", "summary", "details",
]);

// Currency amounts like £49, $1,299.00, €9.99, 49 GBP, 800 грн, "49/mo"
const PRICE_RE = moneyPattern();

/**
 * Replace volatile tokens so that harmless churn (dates, counters, nonces)
 * does not register as a change. Applied before hashing and diffing.
 */
export function normaliseVolatile(text: string): string {
  return text
    // ISO / numeric dates and times
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?\b/g, "<date>")
    .replace(/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/g, "<date>")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:am|pm)?\b/gi, "<time>")
    // "3 hours ago", "2 days ago"
    .replace(/\b\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\b/gi, "<ago>")
    // Month-name dates: "5 September 2026", "Sep 5, 2026"
    .replace(/\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{2,4}\b/gi, "<date>")
    .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{2,4}\b/gi, "<date>")
    // copyright years
    .replace(/(©|\(c\)|copyright)\s*\d{4}(?:\s*[-–]\s*\d{4})?/gi, "$1 <year>")
    // long hex / base64-ish tokens (nonces, cache busters)
    .replace(/\b[a-f0-9]{16,}\b/gi, "<hex>")
    .replace(/\b[A-Za-z0-9+/_-]{32,}={0,2}\b/g, "<token>")
    // view / like / follower counters
    .replace(/\b\d[\d,.]*[kKmM]?\s+(?:views?|likes?|followers?|comments?|shares?|reviews?|ratings?)\b/gi, "<counter>")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function extractFromHtml(html: string): Extracted {
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim() || $("h1").first().text().trim() || null;
  const scriptBytes = $("script").text().length;
  $(STRIP_SELECTORS).remove();

  const root = $("main").first().length ? $("main").first() : $("body").length ? $("body") : $("html");
  const links = root.find("a[href]").length;

  // Walk the DOM emitting a newline at block boundaries so diffs are line-oriented.
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    const n = node as { type: string; data?: string; name?: string; children?: unknown[] };
    if (n.type === "text") {
      parts.push((n.data ?? "").replace(/\s+/g, " "));
    } else if (n.type === "tag") {
      const isBlock = BLOCK_TAGS.has(n.name ?? "");
      if (isBlock) parts.push("\n");
      for (const c of n.children ?? []) walk(c);
      if (isBlock) parts.push("\n");
    }
  };
  for (const c of root.contents().toArray()) walk(c);

  const lines = parts
    .join("")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);

  const dedupedLines: string[] = [];
  for (const l of lines) if (dedupedLines[dedupedLines.length - 1] !== l) dedupedLines.push(l);

  const rawText = dedupedLines.join("\n");
  const text = normaliseVolatile(rawText);
  const prices = [...new Set((rawText.match(PRICE_RE) ?? []).map((p) => p.replace(/\s+/g, "")))];
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const thin = wordCount < 40 && scriptBytes > 20_000;

  return { title, text, meta: { wordCount, prices, thin, links } };
}
