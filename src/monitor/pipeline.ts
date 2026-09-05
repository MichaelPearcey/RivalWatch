import { gzipSync } from "node:zlib";
import type { Analyzer } from "../ai/types.js";
import type { Change, Insight, MonitoredPage, Repo } from "../db/repo.js";
import type { Events } from "../events.js";
import { errorFields, log } from "../logger.js";
import type { SourceRegistry } from "../sources/types.js";
import { DEFAULT_THRESHOLD, detectChange, hashText } from "./detect.js";

export type ProcessOutcome =
  | { status: "fetch_failed"; message: string }
  | { status: "blocked"; message: string }
  | { status: "first_snapshot"; snapshotId: number }
  | { status: "unchanged"; snapshotId: number }
  | { status: "noise"; snapshotId: number; significance: number }
  | { status: "changed"; snapshotId: number; change: Change; insight: Insight | null };

export interface PipelineOptions {
  /** Store gzipped raw bodies with snapshots. Default true. */
  storeRaw?: boolean;
  significanceThreshold?: number;
  now?: () => Date;
}

/**
 * The core loop for one page:
 * fetch -> extract -> snapshot -> detect -> analyse -> insight, emitting events at every step.
 * Safe to re-run: identical content never creates duplicate snapshots or changes.
 */
export class Pipeline {
  private readonly storeRaw: boolean;
  private readonly threshold: number;
  private readonly now: () => Date;

  constructor(
    private readonly repo: Repo,
    private readonly events: Events,
    private readonly sources: SourceRegistry,
    private readonly analyzer: Analyzer,
    opts: PipelineOptions = {},
  ) {
    this.storeRaw = opts.storeRaw ?? true;
    this.threshold = opts.significanceThreshold ?? DEFAULT_THRESHOLD;
    this.now = opts.now ?? (() => new Date());
  }

  async processPage(page: MonitoredPage): Promise<ProcessOutcome> {
    const ctx = this.repo.pageContext(page.id);
    if (!ctx) return { status: "fetch_failed", message: "page context missing" };
    const source = this.sources.get(page.source_type);
    if (!source) {
      this.finish(page, "error", true);
      return { status: "fetch_failed", message: `no source adapter for ${page.source_type}` };
    }

    const started = Date.now();
    const outcome = await source.fetch(page);
    const durationMs = Date.now() - started;

    if (!outcome.ok) {
      const blocked = outcome.reason === "blocked";
      this.events.record({
        type: blocked ? "page.blocked_by_robots" : "page.fetch_failed",
        entity: { type: "page", id: page.id },
        payload: { url: page.url, status: outcome.status, message: outcome.message, duration_ms: durationMs },
      });
      this.finish(page, blocked ? "blocked" : "error", true);
      return blocked ? { status: "blocked", message: outcome.message } : { status: "fetch_failed", message: outcome.message };
    }

    this.events.record({
      type: "page.fetched",
      entity: { type: "page", id: page.id },
      payload: { url: page.url, status: outcome.status, bytes: outcome.raw?.length ?? 0, words: outcome.meta.wordCount, duration_ms: durationMs },
    });

    const hash = hashText(outcome.text);
    const previous = this.repo.latestSnapshot(page.id);

    if (previous && previous.content_hash === hash) {
      this.repo.touchSnapshot(previous.id);
      this.events.record({ type: "page.unchanged", entity: { type: "page", id: page.id }, payload: { snapshot_id: previous.id } });
      this.finish(page, "unchanged", false);
      return { status: "unchanged", snapshotId: previous.id };
    }

    const snapshot = this.repo.createSnapshot({
      page_id: page.id,
      http_status: outcome.status,
      content_type: outcome.contentType,
      content_hash: hash,
      title: outcome.title,
      text: outcome.text,
      raw_gzip: this.storeRaw && outcome.raw ? gzipSync(Buffer.from(outcome.raw, "utf8")) : null,
      meta: outcome.meta,
    });
    this.events.record({
      type: "snapshot.created",
      entity: { type: "snapshot", id: snapshot.id },
      payload: { page_id: page.id, first: !previous, words: outcome.meta.wordCount, thin: outcome.meta.thin ?? false },
    });

    if (!previous) {
      this.finish(page, "ok", false);
      return { status: "first_snapshot", snapshotId: snapshot.id };
    }

    const detection = detectChange(previous.text, outcome.text, { kind: page.kind, threshold: this.threshold });
    if (!detection.changed) {
      this.events.record({
        type: "change.ignored_noise",
        entity: { type: "page", id: page.id },
        payload: { from: previous.id, to: snapshot.id, significance: detection.significance, change_ratio: detection.changeRatio, signals: detection.signals },
      });
      this.finish(page, "ok", false);
      return { status: "noise", snapshotId: snapshot.id, significance: detection.significance };
    }

    const change = this.repo.createChange({
      page_id: page.id,
      from_snapshot_id: previous.id,
      to_snapshot_id: snapshot.id,
      significance: detection.significance,
      change_ratio: detection.changeRatio,
      added: detection.added,
      removed: detection.removed,
      signals: detection.signals,
    });
    this.events.record({
      type: "change.detected",
      entity: { type: "change", id: change.id },
      payload: { page_id: page.id, competitor_id: ctx.competitor.id, business_id: ctx.business.id, significance: change.significance, signals: detection.signals, added: detection.added.length, removed: detection.removed.length },
    });

    const insight = await this.analyzeChange(change, snapshot.title);
    this.finish(page, "ok", false);
    return { status: "changed", snapshotId: snapshot.id, change, insight };
  }

  /** Runs (or re-runs) analysis for a stored change and persists the insight. */
  async analyzeChange(change: Change, pageTitle: string | null = null): Promise<Insight | null> {
    const ctx = this.repo.pageContext(change.page_id);
    if (!ctx) return null;
    const { page, competitor, business } = ctx;
    try {
      const result = await this.analyzer.analyze({
        business: { name: business.name, description: business.description, pricing_notes: business.pricing_notes },
        competitor: { name: competitor.name, website: competitor.website },
        page: { url: page.url, kind: page.kind, title: pageTitle },
        change: {
          added: JSON.parse(change.added_json),
          removed: JSON.parse(change.removed_json),
          signals: JSON.parse(change.signals_json),
          significance: change.significance,
        },
      });
      this.repo.deleteInsightsForChange(change.id);
      const insight = this.repo.createInsight({
        business_id: business.id,
        competitor_id: competitor.id,
        change_id: change.id,
        matters: result.draft.matters ? 1 : 0,
        category: result.draft.category,
        importance: result.draft.importance,
        headline: result.draft.headline,
        summary: result.draft.summary,
        why_it_matters: result.draft.why_it_matters,
        provider: result.provider,
        model: result.model,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
      });
      this.repo.setChangeStatus(change.id, "done");
      this.events.record({
        type: "insight.generated",
        entity: { type: "insight", id: insight.id },
        payload: { business_id: business.id, competitor_id: competitor.id, change_id: change.id, matters: insight.matters === 1, category: insight.category, importance: insight.importance, provider: insight.provider },
      });
      log.info("insight generated", { insight_id: insight.id, headline: insight.headline, matters: insight.matters === 1 });
      return insight;
    } catch (err) {
      this.repo.setChangeStatus(change.id, "failed");
      log.error("analysis failed", { change_id: change.id, ...errorFields(err) });
      return null;
    }
  }

  private finish(page: MonitoredPage, status: string, failed: boolean): void {
    // Back off exponentially on repeated failures (max 8x the normal interval).
    const failures = failed ? page.consecutive_failures + 1 : 0;
    const multiplier = failed ? Math.min(8, 2 ** Math.min(failures, 3)) : 1;
    const next = new Date(this.now().getTime() + page.check_interval_minutes * 60_000 * multiplier).toISOString();
    this.repo.markPageChecked(page.id, status, next, failed);
  }
}
