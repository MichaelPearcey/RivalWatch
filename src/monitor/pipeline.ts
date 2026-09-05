import { gzipSync } from "node:zlib";
import type { Analyzer } from "../ai/types.js";
import type { Change, Insight, MonitoredPage, PageStatus, Repo } from "../db/repo.js";
import type { Events } from "../events.js";
import { errorFields, log } from "../logger.js";
import type { FetchFailureReason, SourceRegistry } from "../sources/types.js";
import { DEFAULT_THRESHOLD, detectChange, hashText } from "./detect.js";

export type ProcessOutcome =
  | { status: "fetch_failed"; pageStatus: PageStatus; message: string }
  | { status: "first_snapshot"; snapshotId: number }
  | { status: "unchanged"; snapshotId: number }
  | { status: "noise"; snapshotId: number; significance: number }
  | { status: "pending_confirmation"; snapshotId: number; change: Change; confirmAfter: string }
  | { status: "awaiting_confirmation"; snapshotId: number; change: Change; confirmAfter: string }
  | { status: "reverted"; snapshotId: number; change: Change }
  | { status: "changed"; snapshotId: number; change: Change; insight: Insight | null };

export interface PipelineOptions {
  /** Store gzipped raw bodies with snapshots. Default true. */
  storeRaw?: boolean;
  significanceThreshold?: number;
  /** Hold detected changes until a later fetch confirms them. Default true. */
  requireConfirmation?: boolean;
  /** Minutes before a confirming fetch counts. 0 = next fetch. */
  confirmDelayMinutes?: number;
  now?: () => Date;
}

const FAILURE_STATUS: Record<FetchFailureReason, PageStatus> = {
  robots_blocked: "ROBOTS_BLOCKED",
  auth_required: "AUTH_REQUIRED",
  rate_limited: "RATE_LIMITED",
  fetch_error: "FETCH_ERROR",
  content_unreadable: "CONTENT_UNREADABLE",
};

/**
 * The core loop for one page:
 * fetch -> extract -> snapshot -> detect -> (confirm on next fetch) -> analyse -> insight,
 * emitting events at every step. Idempotent: identical content never creates
 * duplicate snapshots or changes.
 */
export class Pipeline {
  private readonly storeRaw: boolean;
  private readonly threshold: number;
  private readonly requireConfirmation: boolean;
  private readonly confirmDelayMs: number;
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
    this.requireConfirmation = opts.requireConfirmation ?? true;
    this.confirmDelayMs = (opts.confirmDelayMinutes ?? 60) * 60_000;
    this.now = opts.now ?? (() => new Date());
  }

  async processPage(page: MonitoredPage): Promise<ProcessOutcome> {
    const ctx = this.repo.pageContext(page.id);
    if (!ctx) return { status: "fetch_failed", pageStatus: "FETCH_ERROR", message: "page context missing" };
    const acct = page.account_id;
    const source = this.sources.get(page.source_type);
    if (!source) {
      this.finish(page, "error", "FETCH_ERROR", `no source adapter for ${page.source_type}`);
      return { status: "fetch_failed", pageStatus: "FETCH_ERROR", message: `no source adapter for ${page.source_type}` };
    }

    const started = Date.now();
    const outcome = await source.fetch(page);
    const durationMs = Date.now() - started;

    if (!outcome.ok) {
      const pageStatus = FAILURE_STATUS[outcome.reason];
      this.events.record({
        type: outcome.reason === "robots_blocked" ? "page.blocked_by_robots" : "page.fetch_failed",
        accountId: acct,
        entity: { type: "page", id: page.id },
        result: "failed",
        payload: { url: page.url, reason: outcome.reason, status: outcome.status, message: outcome.message, duration_ms: durationMs },
      });
      this.finish(page, "error", pageStatus, outcome.message);
      return { status: "fetch_failed", pageStatus, message: outcome.message };
    }

    this.events.record({
      type: "page.fetched",
      accountId: acct,
      entity: { type: "page", id: page.id },
      payload: { url: page.url, status: outcome.status, bytes: outcome.raw?.length ?? 0, words: outcome.meta.wordCount, duration_ms: durationMs },
    });

    const hash = hashText(outcome.text);
    const previous = this.repo.latestSnapshot(page.id);

    // --- Confirmation of a previously detected change ---
    const pending = this.repo.pendingConfirmation(page.id);
    if (pending && previous) {
      const toSnap = this.repo.getSnapshot(acct, pending.to_snapshot_id);
      const fromSnap = this.repo.getSnapshot(acct, pending.from_snapshot_id);
      if (toSnap && fromSnap) {
        if (hash === toSnap.content_hash) {
          this.repo.touchSnapshot(toSnap.id);
          if (pending.confirm_after && this.now().toISOString() < pending.confirm_after) {
            this.finish(page, "ok", "ACTIVE", null);
            this.repo.schedulePageCheck(page.id, pending.confirm_after);
            return { status: "awaiting_confirmation", snapshotId: toSnap.id, change: pending, confirmAfter: pending.confirm_after };
          }
          this.repo.setChangeStatus(pending.id, "pending", true);
          this.events.record({ type: "change.confirmed", accountId: acct, entity: { type: "change", id: pending.id }, payload: { page_id: page.id, significance: pending.significance } });
          const insight = await this.analyzeChange({ ...pending, analysis_status: "pending" }, toSnap.title);
          this.finish(page, "ok", "ACTIVE", null);
          return { status: "changed", snapshotId: toSnap.id, change: pending, insight };
        }
        if (hash === fromSnap.content_hash) {
          // Content reverted: A/B test, transient error page, or rolled-back edit.
          this.repo.setChangeStatus(pending.id, "discarded_unconfirmed");
          const snap = this.storeSnapshot(page, outcome, hash);
          this.events.record({
            type: "change.discarded_unconfirmed",
            accountId: acct,
            entity: { type: "change", id: pending.id },
            result: "skipped",
            payload: { page_id: page.id, reason: "content_reverted", significance: pending.significance },
          });
          this.finish(page, "ok", "ACTIVE", null);
          return { status: "reverted", snapshotId: snap.id, change: pending };
        }
        // Content changed again to something new: drop the unconfirmed change and evaluate afresh below.
        this.repo.setChangeStatus(pending.id, "discarded_unconfirmed");
        this.events.record({
          type: "change.discarded_unconfirmed",
          accountId: acct,
          entity: { type: "change", id: pending.id },
          result: "skipped",
          payload: { page_id: page.id, reason: "content_changed_again", significance: pending.significance },
        });
      }
    }

    if (previous && previous.content_hash === hash) {
      this.repo.touchSnapshot(previous.id);
      this.events.record({ type: "page.unchanged", accountId: acct, entity: { type: "page", id: page.id }, payload: { snapshot_id: previous.id } });
      this.finish(page, "unchanged", "ACTIVE", null);
      return { status: "unchanged", snapshotId: previous.id };
    }

    const snapshot = this.storeSnapshot(page, outcome, hash, !previous);
    if (!previous) {
      this.finish(page, "ok", "ACTIVE", null);
      return { status: "first_snapshot", snapshotId: snapshot.id };
    }

    const detection = detectChange(previous.text, outcome.text, { kind: page.kind, threshold: this.threshold });
    if (!detection.changed) {
      this.events.record({
        type: "change.ignored_noise",
        accountId: acct,
        entity: { type: "page", id: page.id },
        result: "skipped",
        payload: { from: previous.id, to: snapshot.id, significance: detection.significance, change_ratio: detection.changeRatio, signals: detection.signals },
      });
      this.finish(page, "ok", "ACTIVE", null);
      return { status: "noise", snapshotId: snapshot.id, significance: detection.significance };
    }

    const confirmAfter = this.requireConfirmation ? new Date(this.now().getTime() + this.confirmDelayMs).toISOString() : null;
    const change = this.repo.createChange({
      account_id: acct,
      page_id: page.id,
      from_snapshot_id: previous.id,
      to_snapshot_id: snapshot.id,
      significance: detection.significance,
      change_ratio: detection.changeRatio,
      added: detection.added,
      removed: detection.removed,
      signals: detection.signals,
      analysis_status: confirmAfter ? "pending_confirmation" : "pending",
      confirm_after: confirmAfter,
    });
    this.events.record({
      type: "change.detected",
      accountId: acct,
      entity: { type: "change", id: change.id },
      payload: { page_id: page.id, competitor_id: ctx.competitor.id, business_id: ctx.business.id, significance: change.significance, signals: detection.signals, added: detection.added.length, removed: detection.removed.length, requires_confirmation: !!confirmAfter },
    });

    if (confirmAfter) {
      this.events.record({ type: "change.pending_confirmation", accountId: acct, entity: { type: "change", id: change.id }, result: "pending", payload: { page_id: page.id, confirm_after: confirmAfter } });
      this.finish(page, "ok", "ACTIVE", null);
      this.repo.schedulePageCheck(page.id, confirmAfter);
      return { status: "pending_confirmation", snapshotId: snapshot.id, change, confirmAfter };
    }

    const insight = await this.analyzeChange(change, snapshot.title);
    this.finish(page, "ok", "ACTIVE", null);
    return { status: "changed", snapshotId: snapshot.id, change, insight };
  }

  /** Runs (or re-runs) analysis for a stored change and persists the insight. */
  async analyzeChange(change: Change, pageTitle: string | null = null, actor = "system"): Promise<Insight | null> {
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
        account_id: change.account_id,
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
        estimated_cost_usd: result.estimatedCostUsd ?? null,
      });
      this.repo.setChangeStatus(change.id, "done");
      this.events.record({
        type: "insight.generated",
        actor,
        accountId: change.account_id,
        entity: { type: "insight", id: insight.id },
        estimatedCostUsd: result.estimatedCostUsd ?? null,
        payload: { business_id: business.id, competitor_id: competitor.id, change_id: change.id, matters: insight.matters === 1, category: insight.category, importance: insight.importance, provider: insight.provider, model: insight.model },
      });
      log.info("insight generated", { insight_id: insight.id, headline: insight.headline, matters: insight.matters === 1 });
      return insight;
    } catch (err) {
      this.repo.setChangeStatus(change.id, "failed");
      this.events.record({ type: "insight.generated", actor, accountId: change.account_id, entity: { type: "change", id: change.id }, result: "failed", payload: errorFields(err) });
      log.error("analysis failed", { change_id: change.id, ...errorFields(err) });
      return null;
    }
  }

  private storeSnapshot(page: MonitoredPage, outcome: { status: number | null; contentType: string | null; title: string | null; text: string; raw: string | null; meta: Record<string, unknown> }, hash: string, first = false) {
    const snapshot = this.repo.createSnapshot({
      account_id: page.account_id,
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
      accountId: page.account_id,
      entity: { type: "snapshot", id: snapshot.id },
      payload: { page_id: page.id, first, words: outcome.meta.wordCount },
    });
    return snapshot;
  }

  private finish(page: MonitoredPage, lastStatus: string, status: PageStatus, message: string | null): void {
    const failed = status !== "ACTIVE";
    // Back off exponentially on repeated failures (max 8x the normal interval).
    const failures = failed ? page.consecutive_failures + 1 : 0;
    const multiplier = failed ? Math.min(8, 2 ** Math.min(failures, 3)) : 1;
    const next = new Date(this.now().getTime() + page.check_interval_minutes * 60_000 * multiplier).toISOString();
    this.repo.markPageChecked(page.id, { lastStatus, nextCheckAt: next, failed, status, statusMessage: message });
    if (page.status !== status) {
      this.events.record({
        type: "page.status_changed",
        accountId: page.account_id,
        entity: { type: "page", id: page.id },
        riskLevel: failed ? "medium" : "low",
        result: failed ? "failed" : "ok",
        payload: { url: page.url, from: page.status, to: status, message, consecutive_failures: failures },
      });
    }
  }
}
