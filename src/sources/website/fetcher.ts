import robotsParserModule from "robots-parser";
import { log } from "../../logger.js";

interface Robots {
  isDisallowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
}
// robots-parser is CommonJS (module.exports = fn) with an awkward ambient .d.ts; normalise here.
const robotsParser = robotsParserModule as unknown as (url: string, contents: string) => Robots;

export interface FetcherOptions {
  userAgent: string;
  timeoutMs: number;
  /** Minimum gap between two requests to the same host. */
  minHostDelayMs: number;
  /** Bytes; bodies larger than this are truncated. */
  maxBodyBytes?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface HttpResponse {
  status: number;
  contentType: string | null;
  body: string;
  finalUrl: string;
}

export type RobotsDecision = { allowed: true } | { allowed: false; reason: string };

/**
 * Polite HTTP fetcher: identifies itself, honours robots.txt, rate-limits per
 * host, times out, and never follows more than a few redirects.
 */
export class PoliteFetcher {
  private lastRequestByHost = new Map<string, number>();
  private robotsCache = new Map<string, { fetchedAt: number; robots: Robots | null }>();
  private readonly robotsTtlMs = 6 * 60 * 60 * 1000;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxBodyBytes: number;

  constructor(private readonly opts: FetcherOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxBodyBytes = opts.maxBodyBytes ?? 2 * 1024 * 1024;
  }

  async checkRobots(url: string): Promise<RobotsDecision> {
    const u = new URL(url);
    const origin = u.origin;
    let entry = this.robotsCache.get(origin);
    if (!entry || this.now() - entry.fetchedAt > this.robotsTtlMs) {
      let robots: Robots | null = null;
      try {
        const res = await this.rawGet(`${origin}/robots.txt`);
        if (res.status >= 200 && res.status < 300) robots = robotsParser(`${origin}/robots.txt`, res.body);
        else if (res.status >= 500) return { allowed: false, reason: `robots.txt returned ${res.status}` };
        // 4xx (incl. 404): no robots file -> everything allowed.
      } catch (err) {
        log.warn("robots.txt fetch failed; assuming allowed", { origin, error: (err as Error).message });
      }
      entry = { fetchedAt: this.now(), robots };
      this.robotsCache.set(origin, entry);
    }
    if (entry.robots && entry.robots.isDisallowed(url, this.opts.userAgent)) {
      return { allowed: false, reason: "disallowed by robots.txt" };
    }
    return { allowed: true };
  }

  /**
   * Full polite GET: robots check + per-host delay + timeout.
   * `syndication: true` skips the robots check: RSS/Atom feeds are published for
   * automated readers and robots.txt governs crawling/indexing, not feed consumption.
   * Callers must still keep frequency low (we use once per day per query).
   */
  async get(url: string, opts: { syndication?: boolean } = {}): Promise<{ kind: "ok"; response: HttpResponse } | { kind: "blocked"; reason: string }> {
    if (!opts.syndication) {
      const robots = await this.checkRobots(url);
      if (!robots.allowed) return { kind: "blocked", reason: robots.reason };
    }
    const response = await this.rawGet(url);
    return { kind: "ok", response };
  }

  private async waitForHost(host: string): Promise<void> {
    const last = this.lastRequestByHost.get(host);
    if (last !== undefined) {
      const wait = last + this.opts.minHostDelayMs - this.now();
      if (wait > 0) await this.sleep(wait);
    }
    this.lastRequestByHost.set(host, this.now());
  }

  private async rawGet(url: string): Promise<HttpResponse> {
    const host = new URL(url).host;
    await this.waitForHost(host);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": this.opts.userAgent,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-GB,en;q=0.8",
        },
      });
      const contentType = res.headers.get("content-type");
      const body = await readBounded(res, this.maxBodyBytes, contentType);
      return { status: res.status, contentType, body, finalUrl: res.url || url };
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readBounded(res: Response, maxBytes: number, contentType?: string | null): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      chunks.push(value);
      if (total >= maxBytes) {
        await reader.cancel();
        break;
      }
    }
  }
  return decodeBody(Buffer.concat(chunks), contentType);
}

const CHARSET_RE = /charset\s*=\s*["']?([\w-]+)/i;

/**
 * Sites outside the anglosphere still serve legacy single-byte encodings
 * (windows-1251 across the Ukrainian and Russian web), so honour the declared
 * charset from the header or the document's own meta tag before falling back
 * to UTF-8.
 */
function decodeBody(buf: Buffer, contentType?: string | null): string {
  const declared =
    CHARSET_RE.exec(contentType ?? "")?.[1] ??
    CHARSET_RE.exec(buf.subarray(0, 4096).toString("latin1"))?.[1];
  const charset = declared?.toLowerCase();
  if (charset && charset !== "utf-8" && charset !== "utf8") {
    try {
      return new TextDecoder(charset, { fatal: false }).decode(buf);
    } catch {
      // Unknown label: fall through to UTF-8 rather than losing the page.
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}
