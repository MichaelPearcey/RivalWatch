import type { MonitoredPage } from "../../db/repo.js";
import type { FetchOutcome, Source } from "../types.js";
import { extractFromHtml } from "./extract.js";
import type { PoliteFetcher } from "./fetcher.js";

export class WebsiteSource implements Source {
  readonly type = "website";
  constructor(private readonly fetcher: PoliteFetcher) {}

  async fetch(page: MonitoredPage): Promise<FetchOutcome> {
    let result: Awaited<ReturnType<PoliteFetcher["get"]>>;
    try {
      result = await this.fetcher.get(page.url);
    } catch (err) {
      const e = err as Error;
      return { ok: false, reason: "error", status: null, message: e.name === "AbortError" ? "timeout" : e.message };
    }
    if (result.kind === "blocked") return { ok: false, reason: "blocked", status: null, message: result.reason };

    const { status, contentType, body, finalUrl } = result.response;
    if (status === 401 || status === 403 || status === 429) {
      return { ok: false, reason: "blocked", status, message: `HTTP ${status}` };
    }
    if (status < 200 || status >= 300) {
      return { ok: false, reason: "error", status, message: `HTTP ${status}` };
    }
    if (contentType && !/html|xml|text\/plain/i.test(contentType)) {
      return { ok: false, reason: "error", status, message: `unsupported content-type ${contentType}` };
    }

    const extracted = extractFromHtml(body);
    return {
      ok: true,
      status,
      contentType,
      title: extracted.title,
      text: extracted.text,
      raw: body,
      meta: { ...extracted.meta, finalUrl },
    };
  }
}
