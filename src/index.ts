import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig, redactConfig } from "./config.js";
import { log } from "./logger.js";
import { createWebApp } from "./web/app.js";

const cfg = loadConfig();
const app = createApp(cfg);
const web = createWebApp(app);

const server = serve({ fetch: web.fetch, port: cfg.PORT, hostname: cfg.HOST }, (info) => {
  log.info("rivalwatch listening", { url: `http://${cfg.HOST}:${info.port}`, config: redactConfig(cfg) });
  app.events.record({ type: "app.started", payload: { port: info.port, analyzer: app.analyzer.name, scheduler: cfg.SCHEDULER_ENABLED } });
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
