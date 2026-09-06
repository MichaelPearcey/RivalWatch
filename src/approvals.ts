import { z } from "zod";
import type { App } from "./app.js";
import type { Principal } from "./auth.js";
import type { EntityType, RiskLevel } from "./events.js";
import { errorFields, log } from "./logger.js";
import { PLANS } from "./plans.js";

/**
 * Approvals: the human-in-the-loop primitive.
 *
 * Anything consequential is modelled as an *action* with a risk level:
 *   - medium: the Manager agent (or a human) may approve
 *   - high:   only a human admin may approve
 * Requesters (agents, users, admins) create an approval row; deciders approve or
 * deny; the *system* executes approved actions. Agents therefore never hold the
 * power to act, only to ask. Every step is an audit event.
 */

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "executed" | "failed";

export interface Approval {
  id: number;
  created_at: string;
  action: string;
  account_id: number | null;
  target_type: string | null;
  target_id: number | null;
  risk_level: "medium" | "high";
  requested_by: string;
  reason: string | null;
  payload: string;
  status: ApprovalStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  executed_at: string | null;
  result: string | null;
  expires_at: string;
}

export interface ActionDefinition<T = unknown> {
  action: string;
  risk: "medium" | "high";
  description: string;
  schema: z.ZodType<T>;
  /** Human-readable one-liner for the inbox. */
  summarise(payload: T): string;
  /** Performs the action. Throws on failure. */
  execute(app: App, approval: Approval, payload: T): Promise<Record<string, unknown>> | Record<string, unknown>;
}

export class ApprovalError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Action catalogue. Adding a consequential capability = adding an entry here.
// ---------------------------------------------------------------------------

const SetPlanPayload = z.object({ account_id: z.number().int().positive(), plan: z.string().refine((p) => p in PLANS, "unknown plan") });

export const ACTIONS: Record<string, ActionDefinition<never>> = {};

function define<T>(def: ActionDefinition<T>): void {
  ACTIONS[def.action] = def as unknown as ActionDefinition<never>;
}

define<z.infer<typeof SetPlanPayload>>({
  action: "account.set_plan",
  risk: "high",
  description: "Change what a customer account is entitled to (and will be billed for).",
  schema: SetPlanPayload,
  summarise: (p) => `Set account #${p.account_id} to the ${PLANS[p.plan]?.name ?? p.plan} plan`,
  execute(app, approval, p) {
    const account = app.repo.getAccount(p.account_id);
    if (!account) throw new Error("account not found");
    app.repo.updateAccountPlan(p.account_id, p.plan);
    app.events.record({
      type: "account.plan_changed",
      actor: "system",
      accountId: p.account_id,
      entity: { type: "account", id: p.account_id },
      riskLevel: "high",
      requestedBy: approval.requested_by,
      approvedBy: approval.decided_by,
      payload: { from: account.plan, to: p.plan, approval_id: approval.id, ...(approval.reason ? { reason: approval.reason } : {}) },
    });
    return { from: account.plan, to: p.plan };
  },
});

const PausePagePayload = z.object({ page_id: z.number().int().positive(), paused: z.boolean() });
define<z.infer<typeof PausePagePayload>>({
  action: "page.set_paused",
  risk: "medium",
  description: "Pause or resume monitoring of a customer's page (e.g. a page that is permanently blocked).",
  schema: PausePagePayload,
  summarise: (p) => `${p.paused ? "Pause" : "Resume"} monitoring of page #${p.page_id}`,
  execute(app, approval, p) {
    const page = app.repo.getPageAny(p.page_id);
    if (!page) throw new Error("page not found");
    app.repo.setPageEnabled(page.account_id, page.id, !p.paused);
    app.events.record({ type: p.paused ? "page.paused" : "page.resumed", actor: "system", accountId: page.account_id, entity: { type: "page", id: page.id }, requestedBy: approval.requested_by, approvedBy: approval.decided_by, payload: { approval_id: approval.id, url: page.url } });
    return { page_id: page.id, paused: p.paused };
  },
});

const SendEmailPayload = z.object({
  account_id: z.number().int().positive().nullable(),
  to: z.string().email(),
  subject: z.string().min(1).max(200),
  text: z.string().min(1).max(20_000),
  kind: z.string().min(1).max(50),
});
define<z.infer<typeof SendEmailPayload>>({
  action: "email.send",
  risk: "medium",
  description: "Send a single email to a customer (support reply, notice).",
  schema: SendEmailPayload,
  summarise: (p) => `Email "${p.subject}" to ${p.to.replace(/^(.).*(@.*)$/, "$1***$2")}`,
  async execute(app, approval, p) {
    const r = await app.mailer.send({ to: p.to, subject: p.subject, text: p.text, kind: p.kind, accountId: p.account_id }, approval.requested_by);
    if (!r.ok) throw new Error(r.error ?? "send failed");
    return { provider: r.provider, provider_id: r.providerId ?? null };
  },
});

// ---------------------------------------------------------------------------

export interface RequestInput {
  action: string;
  payload: unknown;
  reason?: string | undefined;
  accountId?: number | null | undefined;
  target?: { type: EntityType | "system"; id: number } | undefined;
  /** Hours until an undecided request expires. Default 72. */
  ttlHours?: number | undefined;
}

export class Approvals {
  constructor(private readonly app: App) {}

  private get db() {
    return this.app.db;
  }

  get(id: number): Approval | undefined {
    return this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as Approval | undefined;
  }

  list(opts: { status?: ApprovalStatus; accountId?: number; limit?: number } = {}): Approval[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (opts.status) {
      clauses.push("status = ?");
      params.push(opts.status);
    }
    if (opts.accountId !== undefined) {
      clauses.push("account_id = ?");
      params.push(opts.accountId);
    }
    params.push(opts.limit ?? 100);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db.prepare(`SELECT * FROM approvals ${where} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...params) as unknown as Approval[];
  }

  pendingCount(): number {
    return this.app.repo.count("SELECT COUNT(*) c FROM approvals WHERE status = 'pending'");
  }

  describe(a: Approval): string {
    const def = ACTIONS[a.action];
    if (!def) return a.action;
    try {
      return def.summarise(JSON.parse(a.payload) as never);
    } catch {
      return a.action;
    }
  }

  /** Create a request. Validates the payload now so deciders never see garbage. */
  request(requester: Principal | { actor: string; accountId?: number | null }, input: RequestInput): Approval {
    const def = ACTIONS[input.action];
    if (!def) throw new ApprovalError(400, `unknown action "${input.action}"; known: ${Object.keys(ACTIONS).join(", ")}`);
    const parsed = def.schema.safeParse(input.payload);
    if (!parsed.success) throw new ApprovalError(400, `invalid payload for ${input.action}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    const actor = requester.actor;
    const accountId = input.accountId ?? ("accountId" in requester ? (requester.accountId ?? null) : null);
    const expires = new Date(Date.now() + (input.ttlHours ?? 72) * 3_600_000).toISOString();
    const row = this.db
      .prepare(
        `INSERT INTO approvals (action, account_id, target_type, target_id, risk_level, requested_by, reason, payload, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(def.action, accountId, input.target?.type ?? null, input.target?.id ?? null, def.risk, actor, input.reason ?? null, JSON.stringify(parsed.data), expires) as unknown as Approval;
    this.app.events.record({
      type: "approval.requested",
      actor,
      accountId,
      entity: { type: "approval", id: row.id },
      riskLevel: def.risk as RiskLevel,
      requestedBy: actor,
      result: "pending",
      payload: { action: def.action, summary: this.describe(row), reason: input.reason ?? null, expires_at: expires },
    });
    return row;
  }

  /**
   * Decide a pending request. Humans (admins) may decide anything; a Manager
   * agent principal may decide medium-risk requests only. Approval executes
   * the action immediately.
   */
  async decide(decider: Principal | { actor: string; isAdmin: boolean; isManagerAgent?: boolean }, id: number, approve: boolean, note?: string): Promise<Approval> {
    const a = this.get(id);
    if (!a) throw new ApprovalError(404, "approval not found");
    if (a.status !== "pending") throw new ApprovalError(409, `approval is already ${a.status}`);
    if (new Date(a.expires_at).getTime() < Date.now()) {
      this.markExpired(a);
      throw new ApprovalError(409, "approval has expired");
    }
    const isAdmin = decider.isAdmin;
    const isManager = "isManagerAgent" in decider && decider.isManagerAgent === true;
    if (!isAdmin && !(isManager && a.risk_level === "medium")) throw new ApprovalError(403, `${a.risk_level}-risk actions require ${a.risk_level === "high" ? "a human admin" : "the Manager agent or a human admin"}`);
    if (a.requested_by === decider.actor && !isAdmin) throw new ApprovalError(403, "requesters cannot approve their own requests");

    const status: ApprovalStatus = approve ? "approved" : "denied";
    this.db.prepare(`UPDATE approvals SET status = ?, decided_by = ?, decided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), decision_note = ? WHERE id = ?`).run(status, decider.actor, note ?? null, id);
    this.app.events.record({
      type: approve ? "approval.granted" : "approval.denied",
      actor: decider.actor,
      accountId: a.account_id,
      entity: { type: "approval", id },
      riskLevel: a.risk_level,
      requestedBy: a.requested_by,
      approvedBy: approve ? decider.actor : null,
      result: approve ? "ok" : "denied",
      payload: { action: a.action, summary: this.describe(a), note: note ?? null },
    });
    if (!approve) return this.get(id)!;
    return this.execute(this.get(id)!);
  }

  private async execute(a: Approval): Promise<Approval> {
    const def = ACTIONS[a.action]!;
    try {
      const result = await def.execute(this.app, a, def.schema.parse(JSON.parse(a.payload)) as never);
      this.db.prepare(`UPDATE approvals SET status = 'executed', executed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), result = ? WHERE id = ?`).run(JSON.stringify(result), a.id);
    } catch (err) {
      this.db.prepare(`UPDATE approvals SET status = 'failed', executed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), result = ? WHERE id = ?`).run((err as Error).message, a.id);
      this.app.events.record({ type: "approval.execution_failed", actor: "system", accountId: a.account_id, entity: { type: "approval", id: a.id }, riskLevel: a.risk_level, requestedBy: a.requested_by, approvedBy: a.decided_by, result: "failed", payload: { action: a.action, ...errorFields(err) } });
      log.error("approved action failed", { approval_id: a.id, action: a.action, ...errorFields(err) });
    }
    return this.get(a.id)!;
  }

  /** Scheduler job: expire stale pending requests. */
  expireStale(now = new Date()): number {
    const stale = this.db.prepare("SELECT * FROM approvals WHERE status = 'pending' AND expires_at < ?").all(now.toISOString()) as unknown as Approval[];
    for (const a of stale) this.markExpired(a);
    return stale.length;
  }

  private markExpired(a: Approval): void {
    this.db.prepare("UPDATE approvals SET status = 'expired' WHERE id = ? AND status = 'pending'").run(a.id);
    this.app.events.record({ type: "approval.expired", actor: "system", accountId: a.account_id, entity: { type: "approval", id: a.id }, riskLevel: a.risk_level, requestedBy: a.requested_by, result: "skipped", payload: { action: a.action, summary: this.describe(a) } });
  }
}
