import * as cheerio from "cheerio";
import type { PageKind } from "../../db/repo.js";
import type { PoliteFetcher } from "./fetcher.js";

export interface DiscoveredPage {
  url: string;
  kind: PageKind;
  /** Machine-readable so the UI can show it in the reader's language: `both|path|text` + ":" + the matched text. */
  reason: string;
  score: number;
}

const RULES: { kind: PageKind; score: number; path: RegExp; text: RegExp }[] = [
  { kind: "pricing", score: 1.0, path: /\/(pricing|prices|plans|packages|rates|tarif|preise)(\/|\.|$)/i, text: /^(pricing|prices|plans|plans & pricing|packages|rates|see pricing|view pricing)$/i },
  { kind: "products", score: 0.8, path: /\/(products?|services?|features|solutions|menu|shop|store|catalog)(\/|\.|$)/i, text: /^(products?|services?|features|solutions|menu|shop|our services|what we do)$/i },
  { kind: "blog", score: 0.6, path: /\/(blog|news|updates|changelog|articles|insights|press|resources)(\/|\.|$)/i, text: /^(blog|news|updates|changelog|articles|insights|press|resources|what's new)$/i },
];

/**
 * Fetches a competitor's home page and proposes same-site pages worth
 * monitoring, scored by URL path and link text. Pure heuristics; the user
 * confirms before anything is monitored.
 */
export async function discoverPages(fetcher: PoliteFetcher, homeUrl: string, maxResults = 6): Promise<DiscoveredPage[]> {
  const result = await fetcher.get(homeUrl);
  if (result.kind === "blocked") throw new Error(`home page blocked: ${result.reason}`);
  const { body, finalUrl, status } = result.response;
  if (status < 200 || status >= 300) throw new Error(`home page returned HTTP ${status}`);
  return rankLinks(body, finalUrl || homeUrl, maxResults);
}

export function rankLinks(html: string, baseUrl: string, maxResults = 6): DiscoveredPage[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const found = new Map<string, DiscoveredPage>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol)) return;
    if (url.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) return;
    url.hash = "";
    url.search = "";
    const normalised = url.href.replace(/\/$/, "");
    if (normalised === base.href.replace(/\/$/, "")) return;
    const text = $(el).text().replace(/\s+/g, " ").trim();

    for (const rule of RULES) {
      const pathHit = rule.path.test(url.pathname);
      const textHit = rule.text.test(text);
      if (!pathHit && !textHit) continue;
      const score = rule.score * (pathHit && textHit ? 1 : pathHit ? 0.85 : 0.7);
      const existing = found.get(normalised);
      if (!existing || existing.score < score) {
        found.set(normalised, { url: url.href, kind: rule.kind, score, reason: pathHit && textHit ? `both:${text}` : pathHit ? `path:${url.pathname}` : `text:${text}` });
      }
      break;
    }
  });

  return [...found.values()].sort((a, b) => b.score - a.score).slice(0, maxResults);
}
