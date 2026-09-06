// Generates ONE competitor profile for real against the configured Anthropic key, using the demo site.
import { serve } from "@hono/node-server";
import { createApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { seedDemo } from "../src/demo-seed.js";
import { profileCompetitor } from "../src/web/actions.js";
import { createWebApp } from "../src/web/app.js";

const cfg: Config = { ...loadConfig(), DATABASE_PATH: ":memory:", DEMO_SITE_ENABLED: true, SCHEDULER_ENABLED: false, AI_PROVIDER: "anthropic", FETCH_MIN_HOST_DELAY_MS: 0, PORT: 3378, LOG_LEVEL: "warn" };
const app = createApp(cfg);
const server = serve({ fetch: createWebApp(app).fetch, port: cfg.PORT, hostname: "127.0.0.1" });
await new Promise((r) => setTimeout(r, 200));
const seeded = seedDemo(app, `http://127.0.0.1:${cfg.PORT}/demo`);
const r = seeded.seedCompetitor ? await seeded.seedCompetitor() : null;
await app.idle();
const comp = app.repo.listCompetitors(seeded.principal.accountId, seeded.business.id)[0]!;
console.log("pages:", app.repo.listPages(seeded.principal.accountId, comp.id).map((p) => `${p.kind}:${p.url}`));
console.log("status after add:", comp.profile_status);
const profile = await profileCompetitor(app, seeded.principal, comp.id);
console.log(JSON.stringify(profile, null, 2));
console.log("ai events:", app.events.list({ types: ["ai.call", "ai.failed"], limit: 5 }).map((e) => `${e.type} $${e.estimated_cost_usd} ${e.payload.slice(0, 120)}`));
void r;
server.close();
app.close();
