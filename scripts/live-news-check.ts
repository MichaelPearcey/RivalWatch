// Real Google News RSS + real Claude classification for one competitor name. Usage: ... live-news-check.ts "Company Name" https://site
import { createApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";

const name = process.argv[2] ?? "Figma";
const site = process.argv[3] ?? "https://www.figma.com";
const cfg: Config = { ...loadConfig(), DATABASE_PATH: ":memory:", SCHEDULER_ENABLED: false, AI_PROVIDER: "anthropic", LOG_LEVEL: "warn", FETCH_MIN_HOST_DELAY_MS: 0 };
const app = createApp(cfg);
const account = app.repo.createAccount({ name: "t", plan: "pro" });
const user = app.repo.createUser({ account_id: account.id, email: "t@example.com" });
app.repo.markEmailVerified(user.id);
const business = app.repo.createBusiness({ account_id: account.id, name: "Bright Pixel Design", description: "Freelance design studio for small UK businesses." });
const comp = app.repo.createCompetitor({ account_id: account.id, business_id: business.id, name, website: site });
const started = Date.now();
const r = await app.news.refresh(comp.id, "cli");
console.log(JSON.stringify({ fetched: r.fetched, added: r.added, big: r.big.length, provider: r.provider, error: r.error, ms: Date.now() - started }));
for (const n of app.repo.listNews(account.id, comp.id, { limit: 25 })) {
  console.log(`${n.about_competitor ? "✓" : "✗"} ${String(n.magnitude ?? "?").padStart(1)}/5 ${(n.category ?? "").padEnd(11)} ${n.published_at?.slice(0, 10) ?? "undated"} ${n.title.slice(0, 90)}${n.source ? ` — ${n.source}` : ""}`);
  if ((n.magnitude ?? 0) >= 3 && n.why_it_matters) console.log(`      ↳ ${n.why_it_matters}`);
}
console.log("ai:", app.events.list({ types: ["ai.call", "ai.failed"], limit: 3 }).map((e) => `${e.type} $${e.estimated_cost_usd}`));
app.close();
