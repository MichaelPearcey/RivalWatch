import { z } from "zod";
import { ACTIONS } from "../approvals.js";
import { maskEmail } from "../mail/index.js";
import { adminOverview } from "../web/admin.js";
import type { Tool } from "./types.js";

const limit = z.number().int().min(1).max(200).default(50);

function tool<T>(t: Tool<T>): Tool {
  return t as unknown as Tool;
}

// ---------------- Read-only tools (tier 1) ----------------

export const getOverview = tool({
  name: "get_overview",
  description: "Business and system health overview: totals, page statuses, fetch health, insights per period, LLM spend, feedback tallies, scheduler status.",
  kind: "read",
  schema: z.object({}),
  run({ app }) {
    const o = adminOverview(app);
    return { totals: o.totals, pagesByStatus: o.pagesByStatus, fetch24h: o.fetch24h, insights: o.insights, ai: o.ai, feedback: o.feedback, scheduler: o.scheduler, pendingApprovals: o.pendingApprovals.length };
  },
});

export const listUnhealthyPages = tool({
  name: "list_unhealthy_pages",
  description: "Pages whose monitoring is failing (status other than ACTIVE/PAUSED), with status, message, failure count and how long they have been unhealthy.",
  kind: "read",
  schema: z.object({ limit }),
  run({ app }, { limit }) {
    return app.repo
      .listPagesAny({ limit: 500 })
      .filter((p) => p.status !== "ACTIVE" && p.status !== "PAUSED")
      .slice(0, limit)
      .map((p) => ({ page_id: p.id, account_id: p.account_id, competitor_id: p.competitor_id, url: p.url, kind: p.kind, status: p.status, message: p.status_message, consecutive_failures: p.consecutive_failures, status_since: p.status_since, next_check_at: p.next_check_at }));
  },
});

export const listRecentEvents = tool({
  name: "list_recent_events",
  description: "Audit events, newest first. Filter by type (e.g. 'page.fetch_failed', 'email.failed', 'ai.failed', 'insight.feedback') and/or result ('failed', 'denied', 'skipped'). Payload is JSON metadata.",
  kind: "read",
  schema: z.object({ type: z.string().optional(), result: z.enum(["ok", "failed", "pending", "denied", "skipped"]).optional(), since_hours: z.number().min(1).max(24 * 90).default(24 * 7), limit }),
  run({ app }, q) {
    return app.events
      .list({ ...(q.type ? { type: q.type } : {}), ...(q.result ? { result: q.result } : {}), since: new Date(Date.now() - q.since_hours * 3_600_000).toISOString(), limit: q.limit })
      .map((e) => ({ ts: e.ts, type: e.type, actor: e.actor, account_id: e.account_id, target: e.entity_type ? `${e.entity_type}#${e.entity_id}` : null, result: e.result, risk: e.risk_level, cost_usd: e.estimated_cost_usd, payload: JSON.parse(e.payload) }));
  },
});

export const listInsightFeedback = tool({
  name: "list_insight_feedback",
  description: "Recent user feedback on insights (useful / not_useful / incorrect / too_noisy) together with the insight text, category, importance, provider and model. Use it to judge analysis quality.",
  kind: "read",
  schema: z.object({ since_days: z.number().min(1).max(365).default(30), limit }),
  run({ app }, q) {
    const since = new Date(Date.now() - q.since_days * 86_400_000).toISOString();
    return app.db
      .prepare(
        `SELECT f.verdict, f.comment, f.created_at, i.id insight_id, i.account_id, i.category, i.importance, i.headline, i.summary, i.why_it_matters, i.provider, i.model
         FROM insight_feedback f JOIN insights i ON i.id = f.insight_id WHERE f.created_at >= ? ORDER BY f.created_at DESC LIMIT ?`,
      )
      .all(since, q.limit);
  },
});

export const listRecentInsights = tool({
  name: "list_recent_insights",
  description: "Insights generated recently across all accounts (matters=true only unless include_noise), with category, importance, provider, cost.",
  kind: "read",
  schema: z.object({ since_days: z.number().min(1).max(90).default(7), include_noise: z.boolean().default(false), limit }),
  run({ app }, q) {
    const since = new Date(Date.now() - q.since_days * 86_400_000).toISOString();
    return app.db
      .prepare(`SELECT id, account_id, business_id, competitor_id, created_at, matters, category, importance, headline, summary, why_it_matters, provider, model, estimated_cost_usd FROM insights WHERE created_at >= ? ${q.include_noise ? "" : "AND matters = 1"} ORDER BY created_at DESC LIMIT ?`)
      .all(since, q.limit);
  },
});

export const listAccounts = tool({
  name: "list_accounts",
  description: "Customer accounts with plan, member emails (masked), counts of businesses/competitors/pages, signup and last login dates.",
  kind: "read",
  schema: z.object({ limit }),
  run({ app }, { limit }) {
    return app.repo.listAccounts().slice(0, limit).map((a) => ({
      account_id: a.id,
      name: a.name,
      plan: a.plan,
      created_at: a.created_at,
      users: app.repo.listUsers(a.id).map((u) => ({ email_masked: maskEmail(u.email), last_login_at: u.last_login_at, is_admin: u.is_admin === 1 })),
      businesses: app.repo.count("SELECT COUNT(*) c FROM businesses WHERE account_id = ?", a.id),
      competitors: app.repo.count("SELECT COUNT(*) c FROM competitors WHERE account_id = ?", a.id),
      pages: app.repo.count("SELECT COUNT(*) c FROM monitored_pages WHERE account_id = ?", a.id),
      insights_30d: app.repo.count("SELECT COUNT(*) c FROM insights WHERE account_id = ? AND matters = 1 AND created_at >= ?", a.id, new Date(Date.now() - 30 * 86_400_000).toISOString()),
    }));
  },
});

export const listPendingApprovals = tool({
  name: "list_pending_approvals",
  description: "Approval requests awaiting a decision, with action, risk level, requester, reason, payload and summary.",
  kind: "read",
  schema: z.object({}),
  run({ app }) {
    return app.approvals.list({ status: "pending" }).map((a) => ({ ...a, payload: JSON.parse(a.payload), summary: app.approvals.describe(a) }));
  },
});

export const listAgentNotes = tool({
  name: "list_agent_notes",
  description: "Recent notes written by any agent (reports, drafts, recommendations). Use to avoid repeating yourself and to follow up on earlier findings.",
  kind: "read",
  schema: z.object({ agent: z.string().optional(), since_days: z.number().min(1).max(90).default(14), limit }),
  run({ app }, q) {
    const since = new Date(Date.now() - q.since_days * 86_400_000).toISOString();
    return q.agent
      ? app.db.prepare("SELECT id, agent, created_at, kind, title, body, read_at FROM agent_notes WHERE created_at >= ? AND agent = ? ORDER BY created_at DESC LIMIT ?").all(since, q.agent, q.limit)
      : app.db.prepare("SELECT id, agent, created_at, kind, title, body, read_at FROM agent_notes WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?").all(since, q.limit);
  },
});

// ---------------- Write tools: the only two ways to affect the world ----------------

export const requestApproval = tool({
  name: "request_approval",
  description: `Request that the system perform a consequential action. A human (or, for medium-risk actions, the Manager agent) must approve before anything happens. Available actions: ${Object.values(ACTIONS)
    .map((a) => `${a.action} [${a.risk}] - ${a.description}`)
    .join(" | ")}. Always give a clear reason.`,
  kind: "write",
  schema: z.object({ action: z.string(), payload: z.record(z.string(), z.unknown()), reason: z.string().min(5).max(2000), account_id: z.number().int().nullable().optional() }),
  run(ctx, input) {
    const a = ctx.app.approvals.request({ actor: ctx.actor, accountId: input.account_id ?? null }, { action: input.action, payload: input.payload, reason: input.reason, accountId: input.account_id ?? null });
    return { approval_id: a.id, status: a.status, risk_level: a.risk_level, summary: ctx.app.approvals.describe(a) };
  },
});

export const writeNote = tool({
  name: "write_note",
  description: "Write a note for the human owner: a 'report' (what you found and did), a 'draft' (content for review, e.g. a support reply or blog post) or a 'recommendation' (a decision you think the owner should make). Markdown allowed. Be concise and specific.",
  kind: "write",
  schema: z.object({ kind: z.enum(["report", "draft", "recommendation"]), title: z.string().min(3).max(200), body: z.string().min(10).max(20_000) }),
  run(ctx, input) {
    const row = ctx.app.db
      .prepare("INSERT INTO agent_notes (agent, run_id, kind, title, body) VALUES (?, ?, ?, ?, ?) RETURNING id")
      .get(ctx.agent.name, ctx.runId, input.kind, input.title, input.body) as { id: number };
    return { note_id: row.id };
  },
});

/** Manager-only: decide medium-risk approvals. */
export const decideApproval = tool({
  name: "decide_approval",
  description: "Approve or deny a pending MEDIUM-risk approval request. High-risk requests can only be decided by the human owner; for those, write a recommendation instead. Never approve your own requests.",
  kind: "write",
  schema: z.object({ approval_id: z.number().int().positive(), approve: z.boolean(), note: z.string().min(5).max(1000) }),
  async run(ctx, input) {
    const a = await ctx.app.approvals.decide({ actor: ctx.actor, isAdmin: false, isManagerAgent: true }, input.approval_id, input.approve, input.note);
    return { approval_id: a.id, status: a.status, result: a.result };
  },
});

export const READ_TOOLS: Tool[] = [getOverview, listUnhealthyPages, listRecentEvents, listInsightFeedback, listRecentInsights, listAccounts, listPendingApprovals, listAgentNotes];
