import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ConfigError, loadConfig, redactConfig } from "./config.js";
import { log } from "./logger.js";
import { createWebApp } from "./web/app.js";

function fatalConfig(err: unknown): never {
  if (err instanceof ConfigError) {
    // Misconfiguration is an operator problem, not a bug: say so plainly and exit without a stack trace.
    process.stderr.write(`\nRivalWatch cannot start: ${err.message}\nSee docs/07-deployment.md for the required environment variables.\n\n`);
    process.exit(78); // EX_CONFIG
  }
  throw err;
}

let cfg: ReturnType<typeof loadConfig>;
let app: ReturnType<typeof createApp>;
try {
  cfg = loadConfig();
  app = createApp(cfg);
} catch (err) {
  fatalConfig(err);
}
const web = createWebApp(app);

const server = serve({ fetch: web.fetch, port: cfg.PORT, hostname: cfg.HOST }, (info) => {
  log.info("rivalwatch listening", { url: `http://${cfg.HOST}:${info.port}`, config: redactConfig(cfg) });
  app.events.record({ type: "app.started", payload: { port: info.port, analyzer: app.analyzer.name, mail: app.mailer.providerName, scheduler: cfg.SCHEDULER_ENABLED, env: cfg.NODE_ENV } });
  if (cfg.SCHEDULER_ENABLED) app.scheduler.start();
});

function shutdown(signal: string): void {
  log.info("shutting down", { signal });
  server.close(() => {
    app.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
