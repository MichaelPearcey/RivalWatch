import type { MonitoredPage } from "../../db/repo.js";
import type { FetchOutcome, Source } from "../types.js";
import { extractFromHtml, type Extracted } from "./extract.js";
import type { PoliteFetcher } from "./fetcher.js";
import type { PageRenderer } from "./render.js";

export class WebsiteSource implements Source {
  readonly type = "website";
  constructor(
    private readonly fetcher: PoliteFetcher,
    private readonly renderer?: PageRenderer,
  ) {}

  async fetch(page: MonitoredPage): Promise<FetchOutcome> {
    let result: Awaited<ReturnType<PoliteFetcher["get"]>>;
    try {
      result = await this.fetcher.get(page.url);
    } catch (err) {
      const e = err as Error;
      return { ok: false, reason: "fetch_error", status: null, message: e.name === "AbortError" ? "timeout" : e.message };
    }
    if (result.kind === "blocked") return { ok: false, reason: "robots_blocked", status: null, message: result.reason };

    const { status, contentType, body, finalUrl } = result.response;
    if (status === 401 || status === 403) return { ok: false, reason: "auth_required", status, message: `HTTP ${status} - login required or automated access refused` };
    if (status === 429 || status === 503) return { ok: false, reason: "rate_limited", status, message: `HTTP ${status} - rate limited or temporarily unavailable` };
    if (status < 200 || status >= 300) return { ok: false, reason: "fetch_error", status, message: `HTTP ${status}` };
    if (contentType && !/html|xml|text\/plain/i.test(contentType)) {
      return { ok: false, reason: "content_unreadable", status, message: `unsupported content-type ${contentType}` };
    }

    let extracted = extractFromHtml(body);
    let html = body;
    let url = finalUrl;
    let rendered = false;

    // Single-page apps serve an empty shell; robots already allowed this URL, so
    // reading it the way a visitor's browser would is the same permission.
    if (needsBrowser(extracted) && this.renderer) {
      const render = await this.renderer.render(page.url);
      if (render) {
        const fromBrowser = extractFromHtml(render.html);
        if (fromBrowser.meta.wordCount > extracted.meta.wordCount) {
          extracted = fromBrowser;
          html = render.html;
          url = render.finalUrl;
          rendered = true;
        }
      }
    }

    if (needsBrowser(extracted)) {
      return { ok: false, reason: "content_unreadable", status, message: extracted.meta.thin ? "page appears to be rendered by JavaScript; no readable text" : "no readable text" };
    }
    return {
      ok: true,
      status,
      contentType,
      title: extracted.title,
      text: extracted.text,
      raw: html,
      meta: { ...extracted.meta, finalUrl: url, rendered },
    };
  }
}

function needsBrowser(extracted: Extracted): boolean {
  return extracted.meta.thin || extracted.meta.wordCount < 5;
}
