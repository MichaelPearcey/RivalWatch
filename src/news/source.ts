import * as cheerio from "cheerio";
import type { PoliteFetcher } from "../sources/website/fetcher.js";

export interface NewsHeadline {
  url: string;
  title: string;
  source: string | null;
  publishedAt: string | null; // ISO
  snippet: string | null;
}

/** A place we can search for news about a company. Google News RSS now; Brave/NewsAPI later. */
export interface NewsSource {
  readonly name: string;
  search(query: string, opts: { locale?: string; limit?: number }): Promise<NewsHeadline[]>;
}

/** Locale -> Google News edition parameters. */
const EDITIONS: Record<string, { hl: string; gl: string; ceid: string }> = {
  en: { hl: "en-GB", gl: "GB", ceid: "GB:en" },
  uk: { hl: "uk", gl: "UA", ceid: "UA:uk" },
  ru: { hl: "ru", gl: "UA", ceid: "UA:ru" },
  de: { hl: "de", gl: "DE", ceid: "DE:de" },
  fr: { hl: "fr", gl: "FR", ceid: "FR:fr" },
  es: { hl: "es", gl: "ES", ceid: "ES:es" },
};

/**
 * Google News publishes a public RSS search feed. No key, no cost. Results link
 * through news.google.com redirects; we keep the redirect URL as the identity
 * (stable per article) and show the publisher name from <source>.
 */
export class GoogleNewsRss implements NewsSource {
  readonly name = "google-news-rss";
  constructor(private readonly fetcher: PoliteFetcher) {}

  url(query: string, locale = "en"): string {
    const e = EDITIONS[locale] ?? EDITIONS.en!;
    return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${e.hl}&gl=${e.gl}&ceid=${e.ceid}`;
  }

  async search(query: string, opts: { locale?: string; limit?: number } = {}): Promise<NewsHeadline[]> {
    const r = await this.fetcher.get(this.url(query, opts.locale), { syndication: true });
    if (r.kind === "blocked") throw new Error(`news feed blocked: ${r.reason}`);
    if (r.response.status !== 200) throw new Error(`news feed HTTP ${r.response.status}`);
    return parseRss(r.response.body).slice(0, opts.limit ?? 30);
  }
}

export function parseRss(xml: string): NewsHeadline[] {
  const $ = cheerio.load(xml, { xml: true });
  const out: NewsHeadline[] = [];
  $("item").each((_, el) => {
    const item = $(el);
    const title = item.find("title").first().text().trim();
    const url = item.find("link").first().text().trim();
    if (!title || !url) return;
    const pub = item.find("pubDate").first().text().trim();
    const date = pub ? new Date(pub) : null;
    const source = item.find("source").first().text().trim() || null;
    const rawDesc = item.find("description").first().text();
    const snippet = rawDesc ? cheerio.load(rawDesc).text().replace(/\s+/g, " ").trim().slice(0, 400) || null : null;
    // Google appends " - Publisher" to titles; strip it when we know the publisher.
    const cleanTitle = source && title.endsWith(` - ${source}`) ? title.slice(0, -(source.length + 3)).trim() : title;
    out.push({ url, title: cleanTitle, source, publishedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null, snippet });
  });
  return out;
}
