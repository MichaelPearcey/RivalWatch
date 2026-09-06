// One real founder-assistant exchange against the configured Anthropic key. Usage: ... live-founder-check.ts "message"
import { createApp } from "../src/app.js";
import type { Principal } from "../src/auth.js";
import { loadConfig, type Config } from "../src/config.js";

const msg = process.argv[2] ?? "Привіт! Що вже побудовано в цьому продукті і що я можу змінити?";
const cfg: Config = { ...loadConfig(), DATABASE_PATH: ":memory:", SCHEDULER_ENABLED: false, AI_PROVIDER: "anthropic", LOG_LEVEL: "warn" };
const app = createApp(cfg);
const account = app.repo.createAccount({ name: "owner", plan: "plus" });
const user = app.repo.createUser({ account_id: account.id, email: "owner@example.com", is_admin: true });
const p: Principal = { user, accountId: account.id, actor: `user:${user.id}`, via: "session", isAdmin: true };
app.memory.add({ author: "user:1", kind: "fact", title: "Who this is for", body: "RivalWatch is being built as a gift for the owner's partner in Ukraine, so she has work she can run herself. She is an admin and may request changes.", tags: ["context"] });
const conv = app.founder.createConversation(user.id);
const started = Date.now();
let deltas = 0;
const reply = await app.founder.send(p, conv.id, msg, (ev) => {
  if (ev.type === "text") {
    deltas++;
    process.stdout.write(ev.delta);
  } else if (ev.type === "tool_start") process.stdout.write(`\n[${ev.label}]`);
  else if (ev.type === "tool_end") process.stdout.write(` ${ev.ok ? "✓" : "✗"} ${ev.summary}\n`);
});
console.log(`\n--- ${Date.now() - started} ms, ${deltas} text deltas, ${reply.tool_calls} tool calls, $${reply.estimated_cost_usd.toFixed(4)} ---`);
console.log("\nmemory now:", app.memory.list().map((n) => `#${n.id} ${n.kind}: ${n.title}`));
app.close();
