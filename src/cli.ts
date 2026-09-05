import { serve } from "@hono/node-server";
import { createApp, type App } from "./app.js";
import type { Principal } from "./auth.js";
import { loadConfig, type Config } from "./config.js";
import { log } from "./logger.js";
import { addCompetitor, createBusiness, scanBusiness } from "./web/actions.js";
import { createWebApp } from "./web/app.js";

const USAGE = `rivalwatch CLI

  migrate                 apply pending migrations and exit
  tick                    process all due pages + jobs once and exit (cron-friendly)
  make-admin <email>      create (if needed) and flag a user as platform admin
  login-link <email>      print a one-time sign-in link (local/ops use; requires log email provider or prints anyway)
  demo                    start the server with the demo site, seed a demo account, run the full loop, keep serving
`;

async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  const cfg = loadConfig();

  switch (cmd) {
    case "migrate": {
      createApp(cfg).close();
      log.info("migrations up to date");
      return;
    }
    case "tick": {
      const app = createApp(cfg);
      const n = await app.scheduler.tick();
      log.info("tick complete", { processed: n });
      app.close();
      return;
    }
    case "make-admin": {
      const email = rest[0]?.toLowerCase();
      if (!email) throw new Error("usage: make-admin <email>");
      const app = createApp(cfg);
      let user = app.repo.getUserByEmail(email);
      if (!user) {
        const account = app.repo.createAccount({ name: email.split("@")[0] ?? "admin", plan: "plus" });
        user = app.repo.createUser({ account_id: account.id, email, is_admin: true });
      }
      app.repo.touchUserLogin(user.id, true);
      app.events.record({ type: "agent.action", actor: "system", accountId: user.account_id, entity: { type: "user", id: user.id }, riskLevel: "high", requestedBy: "cli", payload: { action: "make_admin" } });
      log.info("admin flag set", { user_id: user.id });
      app.close();
      return;
    }
    case "login-link": {
      const email = rest[0];
      if (!email) throw new Error("usage: login-link <email>");
      const app = createApp(cfg);
      const r = await app.auth.requestLogin(email, "cli");
      process.stdout.write(r.devLink ? `${r.devLink}\n` : `Sign-in email sent via ${app.mailer.providerName}.\n`);
      app.close();
      return;
    }
    case "demo":
      return demo(cfg);
    default:
      process.stdout.write(USAGE);
      if (cmd) process.exitCode = 1;
  }
}

/** Creates a demo account/user and returns a Principal to act as. */
export function seedDemo(app: App, demoBase: string, email = "demo@rivalwatch.local") {
  let user = app.repo.getUserByEmail(email);
  if (!user) {
    const account = app.repo.createAccount({ name: "Bright Pixel Design", plan: "pro" });
    user = app.repo.createUser({ account_id: account.id, email, is_admin: true });
    app.events.record({ type: "account.created", actor: "system", accountId: account.id, entity: { type: "account", id: account.id }, payload: { demo: true } });
  }
  const principal: Principal = { user, accountId: user.account_id, actor: `user:${user.id}`, via: "session", isAdmin: true };
  const existing = app.repo.listBusinesses(user.account_id)[0];
  if (existing) return { principal, business: existing };
  const business = createBusiness(app, principal, {
    name: "Bright Pixel Design",
    website: "https://brightpixel.example",
    description: "Freelance brand and web design studio for small businesses in the UK.",
    pricing_notes: "Starter £25/month, Studio £55/month. No annual plan yet.",
  });
  return { principal, business, seedCompetitor: () => addCompetitor(app, principal, business.id, { name: "Acme Studio", website: `${demoBase}/`, discover: true, pages: [{ url: `${demoBase}/`, kind: "home" }, { url: `${demoBase}/pricing`, kind: "pricing" }] }) };
}

async function demo(cfg: Config): Promise<void> {
  const demoCfg: Config = {
    ...cfg,
    DEMO_SITE_ENABLED: true,
    FETCH_MIN_HOST_DELAY_MS: 0,
    CONFIRM_DELAY_MINUTES: 0,
    DATABASE_PATH: cfg.DATABASE_PATH === "./data/rivalwatch.db" ? "./data/demo.db" : cfg.DATABASE_PATH,
  };
  const app = createApp(demoCfg);
  const web = createWebApp(app);
  const server = serve({ fetch: web.fetch, port: demoCfg.PORT, hostname: demoCfg.HOST });
  const base = `http://${demoCfg.HOST}:${demoCfg.PORT}`;
  await new Promise((r) => setTimeout(r, 200));

  const say = (s: string) => process.stdout.write(`\n>>> ${s}\n`);
  const seeded = seedDemo(app, `${base}/demo`);
  const { principal, business } = seeded;
  if (seeded.seedCompetitor) {
    const r = await seeded.seedCompetitor();
    say(`Seeded competitor with ${r.pages.length} pages; discovery suggested ${r.suggestions.length} more: ${r.suggestions.map((s) => `${s.kind} ${s.url}`).join(", ")}`);
  }
  const scan = () => scanBusiness(app, principal, business.id);
  const mutate = (patch: Record<string, unknown>) => fetch(`${base}/demo/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });

  say("1) Baseline scan");
  await scan();
  say("2) Acme raises Professional from £49 to £59/month and adds an annual plan. First fetch detects it and holds it for confirmation");
  await mutate({ proPrice: 59, annualPrice: 399 });
  await scan();
  say("3) Second fetch confirms the change persists -> analysed -> insight");
  await scan();
  say("4) Acme runs an A/B test: promo appears for one fetch, then disappears. Detected, then discarded unconfirmed");
  await mutate({ promo: "Launch offer: 20% off your first year" });
  await scan();
  await mutate({ promo: null });
  await scan();

  say("Insights:");
  for (const i of app.repo.listInsights(principal.accountId, business.id, { includeNoise: true })) {
    process.stdout.write(`\n[${i.matters ? "MATTERS" : "filtered"}] ${i.category} (${i.importance}/5) - ${i.headline}\n  ${i.summary}\n  Why: ${i.why_it_matters}\n  provider=${i.provider} cost=$${(i.estimated_cost_usd ?? 0).toFixed(4)}\n`);
  }
  const changes = app.repo.db.prepare("SELECT analysis_status, COUNT(*) c FROM changes GROUP BY analysis_status").all() as { analysis_status: string; c: number }[];
  say(`Change statuses: ${changes.map((c) => `${c.analysis_status}=${c.c}`).join(", ")}`);

  const link = await app.auth.requestLogin(principal.user.email, "demo");
  say(`Sign in: ${link.devLink ?? "(check email)"}\nThen open ${base}/b/${business.id} and ${base}/admin. Ctrl+C to stop.`);
  if (demoCfg.SCHEDULER_ENABLED) app.scheduler.start();

  const stop = () => {
    server.close();
    app.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main(process.argv.slice(2)).catch((err) => {
  log.error("cli failed", { error: (err as Error).message });
  process.exit(1);
});
