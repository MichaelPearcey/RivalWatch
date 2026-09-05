import type { MonitoredPage } from "../db/repo.js";

/**
 * A Source knows how to obtain the current "content" of a monitored page for one
 * source type (website, rss, youtube, instagram...). Everything downstream
 * (snapshots, diffing, analysis) only sees the normalised FetchResult.
 */
export interface FetchResult {
  ok: true;
  status: number | null;
  contentType: string | null;
  /** Human-readable title if available. */
  title: string | null;
  /** Normalised main text; this is what gets hashed and diffed. */
  text: string;
  /** Original payload (HTML, JSON...) for archival. Optional. */
  raw: string | null;
  /** Adapter-specific metadata (prices found, word count, post ids...). */
  meta: Record<string, unknown>;
}

/** Maps 1:1 onto the non-ACTIVE, non-PAUSED page statuses. */
export type FetchFailureReason = "robots_blocked" | "auth_required" | "rate_limited" | "fetch_error" | "content_unreadable";

export interface FetchFailure {
  ok: false;
  reason: FetchFailureReason;
  status: number | null;
  message: string;
}

export type FetchOutcome = FetchResult | FetchFailure;

export interface Source {
  readonly type: string;
  fetch(page: MonitoredPage): Promise<FetchOutcome>;
}

export class SourceRegistry {
  private sources = new Map<string, Source>();
  register(source: Source): this {
    this.sources.set(source.type, source);
    return this;
  }
  get(type: string): Source | undefined {
    return this.sources.get(type);
  }
  types(): string[] {
    return [...this.sources.keys()];
  }
}
