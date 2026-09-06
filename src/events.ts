import type { Db } from "./db/index.js";
import { log } from "./logger.js";

/**
 * Structured, append-only audit/event log. System of record for metrics, audit
 * and (later) AI supervision. Field mapping to the audit format:
 *   actor -> actor, action -> type, target -> entity_type/entity_id,
 *   risk_level, requested_by, approved_by, result, estimated_cost -> estimated_cost_usd,
 *   metadata -> payload (JSON), timestamp -> ts. Tenant -> account_id.
 * Keep event types dotted and stable; add new ones freely, never repurpose old ones.
 */
export type EventType =
  // accounts / auth
  | "account.created"
  | "account.plan_changed"
  | "user.signup"
  | "user.login_requested"
  | "user.login"
  | "user.login_failed"
  | "user.logout"
  | "user.password_set"
  | "user.password_removed"
  | "user.consent_recorded"
  | "account.deletion_requested"
  | "account.deletion_cancelled"
  | "account.deleted"
  | "account.data_exported"
  | "api_key.created"
  | "api_key.revoked"
  // customer/business lifecycle
  | "business.created"
  | "business.updated"
  | "business.deleted"
  | "competitor.added"
  | "competitor.removed"
  | "competitor.profiled"
  | "news.fetched"
  | "news.fetch_failed"
  | "news.big"
  | "alert.sent"
  | "memory.added"
  | "memory.updated"
  | "user.email_verified"
  | "page.added"
  | "page.removed"
  | "page.paused"
  | "page.resumed"
  | "page.status_changed"
  | "page.suggested"
  | "page.suggestion_accepted"
  | "page.suggestion_dismissed"
  | "discovery.completed"
  | "discovery.failed"
  // monitoring pipeline
  | "page.fetched"
  | "page.fetch_failed"
  | "page.blocked_by_robots"
  | "page.unchanged"
  | "snapshot.created"
  | "change.ignored_noise"
  | "change.detected"
  | "change.pending_confirmation"
  | "change.confirmed"
  | "change.discarded_unconfirmed"
  | "insight.generated"
  | "insight.feedback"
  // AI cost/usage
  | "ai.call"
  | "ai.failed"
  | "ai.cap_reached"
  // email
  | "email.sent"
  | "email.failed"
  | "digest.sent"
  | "digest.skipped"
  // scheduler / ops
  | "backup.completed"
  | "backup.failed"
  | "retention.applied"
  | "scheduler.tick"
  | "scheduler.error"
  | "app.started"
  // agent governance (vocabulary reserved for the Manager AI layer)
  | "agent.action"
  | "agent.run_started"
  | "agent.run_finished"
  | "agent.enabled_changed"
  | "approval.requested"
  | "approval.granted"
  | "approval.denied"
  | "approval.expired"
  | "approval.execution_failed";

export type EntityType = "account" | "user" | "business" | "competitor" | "page" | "snapshot" | "change" | "insight" | "email" | "api_key" | "suggestion" | "approval" | "agent_run" | "news" | "memory";
export type RiskLevel = "low" | "medium" | "high";
export type EventResult = "ok" | "failed" | "pending" | "denied" | "skipped";

export interface EventRow {
  id: number;
  ts: string;
  type: EventType | string;
  actor: string;
  entity_type: EntityType | null;
  entity_id: number | null;
  payload: string;
  account_id: number | null;
  risk_level: RiskLevel;
  requested_by: string | null;
  approved_by: string | null;
  result: EventResult;
  estimated_cost_usd: number | null;
}

export interface EventInput {
  type: EventType;
  /** system | user:<id> | agent:<name> */
  actor?: string;
  accountId?: number | null;
  entity?: { type: EntityType; id: number };
  payload?: Record<string, unknown>;
  riskLevel?: RiskLevel;
  requestedBy?: string | null;
  approvedBy?: string | null;
  result?: EventResult;
  estimatedCostUsd?: number | null;
}

export interface EventQuery {
  accountId?: number;
  type?: string;
  types?: string[];
  entityType?: string;
  entityId?: number;
  result?: EventResult;
  since?: string;
  limit?: number;
}

export class Events {
  constructor(private readonly db: Db) {}

  record(e: EventInput): void {
    this.db
      .prepare(
        `INSERT INTO events (type, actor, account_id, entity_type, entity_id, payload, risk_level, requested_by, approved_by, result, estimated_cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.type,
        e.actor ?? "system",
        e.accountId ?? null,
        e.entity?.type ?? null,
        e.entity?.id ?? null,
        JSON.stringify(e.payload ?? {}),
        e.riskLevel ?? "low",
        e.requestedBy ?? null,
        e.approvedBy ?? null,
        e.result ?? "ok",
        e.estimatedCostUsd ?? null,
      );
    log.debug("event", { type: e.type, account_id: e.accountId, entity: e.entity, result: e.result ?? "ok", ...e.payload });
  }

  list(q: EventQuery = {}): EventRow[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (q.accountId !== undefined) {
      clauses.push("account_id = ?");
      params.push(q.accountId);
    }
    if (q.type) {
      clauses.push("type = ?");
      params.push(q.type);
    }
    if (q.types && q.types.length) {
      clauses.push(`type IN (${q.types.map(() => "?").join(",")})`);
      params.push(...q.types);
    }
    if (q.entityType) {
      clauses.push("entity_type = ?");
      params.push(q.entityType);
    }
    if (q.entityId !== undefined) {
      clauses.push("entity_id = ?");
      params.push(q.entityId);
    }
    if (q.result) {
      clauses.push("result = ?");
      params.push(q.result);
    }
    if (q.since) {
      clauses.push("ts >= ?");
      params.push(q.since);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(q.limit ?? 100);
    return this.db.prepare(`SELECT * FROM events ${where} ORDER BY ts DESC, id DESC LIMIT ?`).all(...params) as unknown as EventRow[];
  }

  countsSince(since: string, accountId?: number): Record<string, number> {
    const rows = (accountId === undefined
      ? this.db.prepare("SELECT type, COUNT(*) c FROM events WHERE ts >= ? GROUP BY type").all(since)
      : this.db.prepare("SELECT type, COUNT(*) c FROM events WHERE ts >= ? AND account_id = ? GROUP BY type").all(since, accountId)) as unknown as { type: string; c: number }[];
    return Object.fromEntries(rows.map((r) => [r.type, r.c]));
  }

  countSince(type: EventType, since: string): number {
    return (this.db.prepare("SELECT COUNT(*) c FROM events WHERE type = ? AND ts >= ?").get(type, since) as { c: number }).c;
  }

  costSince(since: string): number {
    return (this.db.prepare("SELECT COALESCE(SUM(estimated_cost_usd), 0) s FROM events WHERE ts >= ?").get(since) as { s: number }).s;
  }
}
