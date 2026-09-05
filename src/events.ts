import type { Db } from "./db/index.js";
import { log } from "./logger.js";

/**
 * Structured, append-only business/agent event log.
 * This is the system of record for metrics, audit and (later) the owner dashboard.
 * Keep event types dotted and stable; add new ones freely, never repurpose old ones.
 */
export type EventType =
  // customer/business lifecycle
  | "business.created"
  | "business.updated"
  | "competitor.added"
  | "competitor.removed"
  | "page.added"
  | "page.removed"
  // monitoring pipeline
  | "page.fetched"
  | "page.fetch_failed"
  | "page.blocked_by_robots"
  | "page.unchanged"
  | "snapshot.created"
  | "change.ignored_noise"
  | "change.detected"
  | "insight.generated"
  // AI cost/usage
  | "ai.call"
  | "ai.failed"
  | "ai.cap_reached"
  // scheduler / ops
  | "scheduler.tick"
  | "scheduler.error"
  | "app.started"
  // agent governance (future use, defined now so the vocabulary is stable)
  | "agent.action"
  | "approval.requested"
  | "approval.granted"
  | "approval.denied";

export type EntityType = "business" | "competitor" | "page" | "snapshot" | "change" | "insight";

export interface EventRow {
  id: number;
  ts: string;
  type: EventType | string;
  actor: string;
  entity_type: EntityType | null;
  entity_id: number | null;
  payload: string;
}

export interface EventInput {
  type: EventType;
  actor?: string;
  entity?: { type: EntityType; id: number };
  payload?: Record<string, unknown>;
}

export class Events {
  constructor(private readonly db: Db) {}

  record(e: EventInput): void {
    this.db
      .prepare("INSERT INTO events (type, actor, entity_type, entity_id, payload) VALUES (?, ?, ?, ?, ?)")
      .run(e.type, e.actor ?? "system", e.entity?.type ?? null, e.entity?.id ?? null, JSON.stringify(e.payload ?? {}));
    log.debug("event", { type: e.type, entity: e.entity, ...e.payload });
  }

  list(opts: { type?: string; entityType?: string; entityId?: number; since?: string; limit?: number } = {}): EventRow[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (opts.type) {
      clauses.push("type = ?");
      params.push(opts.type);
    }
    if (opts.entityType) {
      clauses.push("entity_type = ?");
      params.push(opts.entityType);
    }
    if (opts.entityId !== undefined) {
      clauses.push("entity_id = ?");
      params.push(opts.entityId);
    }
    if (opts.since) {
      clauses.push("ts >= ?");
      params.push(opts.since);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(opts.limit ?? 100);
    return this.db.prepare(`SELECT * FROM events ${where} ORDER BY ts DESC, id DESC LIMIT ?`).all(...params) as unknown as EventRow[];
  }

  /** Counts per event type since a timestamp. Cheap health/metrics primitive. */
  countsSince(since: string): Record<string, number> {
    const rows = this.db
      .prepare("SELECT type, COUNT(*) c FROM events WHERE ts >= ? GROUP BY type")
      .all(since) as unknown as { type: string; c: number }[];
    return Object.fromEntries(rows.map((r) => [r.type, r.c]));
  }

  countSince(type: EventType, since: string): number {
    return (this.db.prepare("SELECT COUNT(*) c FROM events WHERE type = ? AND ts >= ?").get(type, since) as { c: number }).c;
  }
}
