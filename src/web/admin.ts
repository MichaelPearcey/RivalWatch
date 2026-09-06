import type { App } from "../app.js";
import type { Approval } from "../approvals.js";
import type { MonitoredPage, User } from "../db/repo.js";
import type { AdminOverview } from "./views.js";

/** Operator/owner overview. Reads only aggregate and cross-tenant data; admin-only. */
export function adminOverview(app: App): AdminOverview {
  const { repo, events, db } = app;
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const d1 = ago(1);
  const d7 = ago(7);
  const d30 = ago(30);
  const c1 = events.countsSince(d1);

  const count = (sql: string, ...params: (string | number)[]) => repo.count(sql, ...params);
  const totals = {
    accounts: count("SELECT COUNT(*) c FROM accounts"),
    users: count("SELECT COUNT(*) c FROM users"),
    businesses: count("SELECT COUNT(*) c FROM businesses"),
    competitors: count("SELECT COUNT(*) c FROM competitors"),
    pages: count("SELECT COUNT(*) c FROM monitored_pages"),
    snapshots: count("SELECT COUNT(*) c FROM snapshots"),
    changes: count("SELECT COUNT(*) c FROM changes"),
    insights: count("SELECT COUNT(*) c FROM insights WHERE matters = 1"),
  };

  const users = db
    .prepare("SELECT u.*, a.name account_name, a.plan account_plan FROM users u JOIN accounts a ON a.id = u.account_id ORDER BY u.id DESC LIMIT 200")
    .all() as unknown as (User & { account_name: string; account_plan: string })[];

  const unhealthyPages = (db.prepare("SELECT * FROM monitored_pages WHERE status NOT IN ('ACTIVE','PAUSED') ORDER BY status_since DESC LIMIT 200").all() as unknown as MonitoredPage[]);

  const aiCost = (since: string) => (db.prepare("SELECT COALESCE(SUM(estimated_cost_usd),0) s FROM events WHERE type = 'ai.call' AND ts >= ?").get(since) as { s: number }).s;

  const describe = (a: Approval) => ({ ...a, summary: app.approvals.describe(a) });
  const lastBackup = events.list({ types: ["backup.completed", "backup.failed"], limit: 1 })[0];
  return {
    backups: { offsite: app.backups.offsiteConfigured, lastAt: lastBackup?.ts ?? null, lastOk: lastBackup ? lastBackup.type === "backup.completed" : null, local: app.backups.listLocal().length },
    agents: { enabled: app.agents.enabled, state: app.agents.state(), runs: app.agents.runs({ limit: 10 }), notes: app.agents.notes({ limit: 20 }), cost24h: app.agents.costSince(d1) },
    pendingApprovals: app.approvals.list({ status: "pending" }).map(describe),
    recentApprovals: app.approvals.list({ limit: 20 }).filter((a) => a.status !== "pending").map(describe),
    totals,
    pagesByStatus: repo.countPagesByStatus(),
    fetch24h: { fetched: c1["page.fetched"] ?? 0, failed: (c1["page.fetch_failed"] ?? 0) + (c1["page.blocked_by_robots"] ?? 0) },
    insights: {
      d1: count("SELECT COUNT(*) c FROM insights WHERE matters = 1 AND created_at >= ?", d1),
      d7: count("SELECT COUNT(*) c FROM insights WHERE matters = 1 AND created_at >= ?", d7),
      d30: count("SELECT COUNT(*) c FROM insights WHERE matters = 1 AND created_at >= ?", d30),
    },
    ai: {
      calls24h: c1["ai.call"] ?? 0,
      calls7d: events.countSince("ai.call", d7),
      cost24h: aiCost(d1),
      cost7d: aiCost(d7),
      cost30d: aiCost(d30),
      capReached24h: c1["ai.cap_reached"] ?? 0,
      provider: app.analyzer.name,
      model: app.cfg.AI_PROVIDER === "anthropic" ? app.cfg.ANTHROPIC_MODEL : "n/a",
      callCap: app.cfg.AI_DAILY_CALL_CAP,
      costCapUsd: app.cfg.AI_DAILY_COST_CAP_USD,
    },
    feedback: repo.feedbackCounts(d30),
    scheduler: app.scheduler.getStatus() as unknown as Record<string, unknown>,
    errors: events.list({ result: "failed", limit: 50 }),
    unhealthyPages,
    users,
    emails: repo.listEmails({ limit: 30 }),
    recent: events.list({ limit: 100 }),
  };
}
