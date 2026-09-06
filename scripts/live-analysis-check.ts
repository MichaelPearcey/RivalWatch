// Sends ONE real change to the configured LLM provider and prints the result and cost.
// Usage: AI_PROVIDER=anthropic npm run cli:live-check   (reads .env)
import { createAnalyzer } from "../src/ai/index.js";
import { loadConfig } from "../src/config.js";
import { openAndMigrate } from "../src/db/index.js";
import { Events } from "../src/events.js";

const cfg = loadConfig();
const db = openAndMigrate(":memory:");
const events = new Events(db);
const analyzer = createAnalyzer(cfg, events);

const started = Date.now();
const result = await analyzer.analyze({
  business: { name: "Bright Pixel Design", description: "Freelance brand and web design studio for small UK businesses.", pricing_notes: "Starter £25/month, Studio £55/month. No annual plan." },
  competitor: { name: "Acme Studio", website: "https://acme.example" },
  page: { url: "https://acme.example/pricing", kind: "pricing", title: "Pricing - Acme Studio" },
  change: {
    added: ["£59/month", "Professional (annual)", "£399/year", "Save with annual billing"],
    removed: ["£49/month"],
    signals: ["price"],
    significance: 1,
  },
});

console.log(JSON.stringify({ provider: result.provider, model: result.model, tokens: { in: result.inputTokens, out: result.outputTokens }, estimated_cost_usd: result.estimatedCostUsd, duration_ms: Date.now() - started }, null, 2));
console.log(JSON.stringify(result.draft, null, 2));
console.log("events:", events.list({ limit: 5 }).map((e) => `${e.type} result=${e.result} cost=${e.estimated_cost_usd} ${e.payload}`));
db.close();
