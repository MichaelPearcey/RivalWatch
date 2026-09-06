import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { seedDemo } from "./demo-seed.js";
import { log } from "./logger.js";
import { scanBusiness } from "./web/actions.js";
import { createWebApp } from "./web/app.js";

const USAGE = `rivalwatch CLI

  migrate                 apply pending migrations and exit
  tick                    process all due pages + jobs once and exit (cron-friendly)
  make-admin <email>      create (if needed) and flag a user as platform admin
  login-link <email>      print a one-time sign-in link (local/ops use; requires log email provider or prints anyway)
  backup                  write a gzipped SQLite backup now (and upload if BACKUP_S3_* is set)
  memory pull [open]      read shared memory from production (Devin: run at the start of every session)
  memory push <kind> <title> <body...>   write a note to shared memory as agent:devin
  memory done <id>        mark a request fulfilled
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
    case "backup": {
      const app = createApp(cfg);
      const r = await app.backups.run("cli");
      process.stdout.write(`${JSON.stringify(r)}\n`);
      app.close();
      if (!r.ok) process.exitCode = 1;
      return;
    }
    case "memory": {
      // Devin <-> production shared memory. Requires RIVALWATCH_URL and RIVALWATCH_API_KEY (an admin's API key) in .env.
      const base = (process.env.RIVALWATCH_URL ?? "").replace(/\/$/, "");
      const key = process.env.RIVALWATCH_API_KEY;
      if (!base || !key) throw new Error("set RIVALWATCH_URL and RIVALWATCH_API_KEY in .env (create the key in /settings as an admin)");
      const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };
      const sub = rest[0];
      if (sub === "pull") {
        const res = await fetch(`${base}/api/admin/memory?limit=200${rest[1] ? `&status=${rest[1]}` : ""}`, { headers });
        if (!res.ok) throw new Error(`pull failed: HTTP ${res.status}`);
        const notes = (await res.json()) as { id: number; created_at: string; author: string; kind: string; status: string; title: string; body: string; tags: string }[];
        for (const n of notes.reverse()) process.stdout.write(`#${n.id} [${n.kind}/${n.status}] ${n.created_at.slice(0, 16)} ${n.author}\n  ${n.title}\n  ${n.body.replace(/\n/g, "\n  ")}\n${n.tags ? `  tags: ${n.tags}\n` : ""}\n`);
        return;
      }
      if (sub === "push") {
        const [, kind, title, ...bodyParts] = rest;
        if (!kind || !title || bodyParts.length === 0) throw new Error("usage: memory push <kind> <title> <body...>");
        const res = await fetch(`${base}/api/admin/memory`, { method: "POST", headers, body: JSON.stringify({ kind, title, body: bodyParts.join(" "), author: "agent:devin", source: "devin-cli" }) });
        if (!res.ok) throw new Error(`push failed: HTTP ${res.status} ${await res.text()}`);
        process.stdout.write(`saved #${((await res.json()) as { id: number }).id}\n`);
        return;
      }
      if (sub === "done") {
        const res = await fetch(`${base}/api/admin/memory/${Number(rest[1])}/status`, { method: "POST", headers, body: JSON.stringify({ status: "done" }) });
        process.stdout.write(res.ok ? "marked done\n" : `failed: HTTP ${res.status}\n`);
        return;
      }
      throw new Error("usage: memory pull [open] | memory push <kind> <title> <body...> | memory done <id>");
    }
    case "demo":
      return demo(cfg);
    default:
      process.stdout.write(USAGE);
      if (cmd) process.exitCode = 1;
  }
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
