// Runs ONE agent for real against the configured Anthropic key on a seeded in-memory demo dataset.
// Usage: node --import tsx scripts/live-agent-check.ts <agent-name>
import { serve } from "@hono/node-server";
import { createApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { createWebApp } from "../src/web/app.js";
import { scanBusiness } from "../src/web/actions.js";
import { seedDemo } from "../src/demo-seed.js";

const name = process.argv[2] ?? "support-ops";
const cfg: Config = { ...loadConfig(), DATABASE_PATH: ":memory:", DEMO_SITE_ENABLED: true, SCHEDULER_ENABLED: false, AGENTS_ENABLED: true, AI_PROVIDER: "anthropic", FETCH_MIN_HOST_DELAY_MS: 0, CONFIRM_DELAY_MINUTES: 0, PORT: 3377, LOG_LEVEL: "warn" };
const app = createApp(cfg);
const web = createWebApp(app);
const server = serve({ fetch: web.fetch, port: cfg.PORT, hostname: "127.0.0.1" });
await new Promise((r) => setTimeout(r, 200));
const base = `http://127.0.0.1:${cfg.PORT}`;

// Seed: demo business + competitor, a baseline, a confirmed price change, and two broken pages.
const seeded = seedDemo(app, `${base}/demo`);
if (seeded.seedCompetitor) await seeded.seedCompetitor();
const { principal, business } = seeded;
const compId = app.repo.listCompetitors(principal.accountId, business.id)[0]!.id;
app.repo.createPage({ account_id: principal.accountId, competitor_id: compId, url: `${base}/demo/status/403`, kind: "other" });
app.repo.createPage({ account_id: principal.accountId, competitor_id: compId, url: `${base}/demo/spa`, kind: "products" });
await scanBusiness(app, principal, business.id);
await fetch(`${base}/demo/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proPrice: 59, annualPrice: 399 }) });
await scanBusiness(app, principal, business.id);
await scanBusiness(app, principal, business.id);
// Make the broken pages look long-broken.
app.db.prepare("UPDATE monitored_pages SET consecutive_failures = 9, status_since = '2026-08-20T00:00:00Z' WHERE status IN ('AUTH_REQUIRED','CONTENT_UNREADABLE')").run();
// Some feedback for the agent to read.
const insight = app.repo.listInsights(principal.accountId, business.id)[0];
if (insight) app.repo.upsertFeedback({ account_id: principal.accountId, insight_id: insight.id, user_id: principal.user.id, verdict: "useful" });

if (name === "manager") {
  // Give the manager something to decide: two sensible medium-risk pauses and one high-risk plan change.
  const broken = app.repo.listPagesAny().filter((p) => p.status === "AUTH_REQUIRED" || p.status === "CONTENT_UNREADABLE");
  for (const p of broken) app.approvals.request({ actor: "agent:support-ops" }, { action: "page.set_paused", payload: { page_id: p.id, paused: true }, accountId: p.account_id, reason: `${p.status} for 17 days, 9 consecutive failures; structural, will not self-resolve.` });
  app.approvals.request({ actor: "agent:support-ops" }, { action: "account.set_plan", payload: { account_id: principal.accountId, plan: "plus" }, accountId: principal.accountId, reason: "Customer emailed asking for more competitors." });
}

console.log(`--- running agent "${name}" (model ${cfg.AGENT_MODEL ?? cfg.ANTHROPIC_MODEL}) ---`);
const run = await app.agents.runNow(name, "manual");
console.log(JSON.stringify({ status: run.status, turns: run.turns, tool_calls: run.tool_calls, tokens: { in: run.input_tokens, out: run.output_tokens }, cost_usd: run.estimated_cost_usd, error: run.error }, null, 2));
console.log("\nSUMMARY:\n" + (run.summary ?? ""));
console.log("\nTOOL CALLS:");
for (const e of app.events.list({ type: "agent.action", limit: 50 }).reverse()) {
  const p = JSON.parse(e.payload);
  console.log(` - ${p.tool} [${e.result}]${p.input ? " " + JSON.stringify(p.input).slice(0, 300) : ""}`);
}
console.log("\nAPPROVALS:", app.approvals.list().map((a) => `#${a.id} ${a.status} ${a.risk_level} ${app.approvals.describe(a)} — ${a.reason}`));
console.log("\nNOTES:");
for (const n of app.agents.notes()) console.log(`### [${n.kind}] ${n.title}\n${n.body}\n`);
server.close();
app.close();
