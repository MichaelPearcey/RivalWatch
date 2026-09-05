import { serve } from "@hono/node-server";
import { createApp, type App } from "./app.js";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { addCompetitor, createBusiness, scanBusiness } from "./web/actions.js";
import { createWebApp } from "./web/app.js";

const USAGE = `rivalwatch CLI

  migrate            apply pending migrations and exit
  tick               process all due pages once and exit
  scan <businessId>  scan every page of a business now
  seed               create a demo business + competitor pointing at the local demo site
  demo               start the server with the demo site, seed, run the full loop, keep serving
`;

async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  const cfg = loadConfig();

  switch (cmd) {
    case "migrate": {
      const app = createApp(cfg);
      app.close();
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
    case "scan": {
      const id = Number(rest[0]);
      if (!id) throw new Error("usage: scan <businessId>");
      const app = createApp(cfg);
      const results = await scanBusiness(app, id);
      for (const r of results) log.info("scanned", { url: r.page.url, ...r.outcome });
      app.close();
      return;
    }
    case "seed": {
      const app = createApp(cfg);
      const base = `http://${cfg.HOST}:${cfg.PORT}/demo`;
      seed(app, base);
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

function seed(app: App, demoBase: string) {
  const business = createBusiness(app, {
    name: "Bright Pixel Design",
    website: "https://brightpixel.example",
    description: "Freelance brand and web design studio for small businesses in the UK.",
    pricing_notes: "Starter £25/month, Studio £55/month. No annual plan yet.",
    plan: "pro",
  }, "system");
  const { competitor, pages } = addCompetitor(
    app,
    business.id,
    {
      name: "Acme Studio",
      website: `${demoBase}/`,
      pages: [
        { url: `${demoBase}/`, kind: "home" },
        { url: `${demoBase}/pricing`, kind: "pricing" },
        { url: `${demoBase}/products`, kind: "products" },
      ],
    },
    "system",
  );
  log.info("seeded", { business_id: business.id, competitor_id: competitor.id, pages: pages.length });
  return { business, competitor, pages };
}

async function demo(cfg: ReturnType<typeof loadConfig>): Promise<void> {
  const demoCfg = { ...cfg, DEMO_SITE_ENABLED: true, FETCH_MIN_HOST_DELAY_MS: 0, DATABASE_PATH: cfg.DATABASE_PATH === "./data/rivalwatch.db" ? "./data/demo.db" : cfg.DATABASE_PATH };
  const app = createApp(demoCfg);
  const web = createWebApp(app);
  const server = serve({ fetch: web.fetch, port: demoCfg.PORT, hostname: demoCfg.HOST });
  const base = `http://${demoCfg.HOST}:${demoCfg.PORT}`;
  await new Promise((r) => setTimeout(r, 200));

  const existing = app.repo.listBusinesses()[0];
  const business = existing ?? seed(app, `${base}/demo`).business;

  const say = (s: string) => process.stdout.write(`\n>>> ${s}\n`);
  say("1) Baseline scan of Acme Studio (the fake competitor served at /demo)");
  await scanBusiness(app, business.id);

  say("2) Second scan with no real change (only dates/testimonials/counters rotate) - should be filtered as noise");
  await scanBusiness(app, business.id);

  say("3) Acme raises Professional from £49 to £59/month, adds a £399/year annual plan and a promo");
  await fetch(`${base}/demo/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proPrice: 59, annualPrice: 399, promo: "Launch offer: 20% off your first year" }) });
  await scanBusiness(app, business.id);

  say("4) Acme launches a new product");
  await fetch(`${base}/demo/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newProduct: "Acme Invoice" }) });
  await scanBusiness(app, business.id);

  say("Insights generated:");
  for (const i of app.repo.listInsights(business.id, { includeNoise: true })) {
    process.stdout.write(`\n[${i.matters ? "MATTERS" : "filtered"}] ${i.category} (${i.importance}/5) - ${i.headline}\n  ${i.summary}\n  Why: ${i.why_it_matters}\n`);
  }
  say(`Open ${base}/b/${business.id} to browse. Scheduler ${demoCfg.SCHEDULER_ENABLED ? "running" : "disabled"}. Ctrl+C to stop.`);
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
