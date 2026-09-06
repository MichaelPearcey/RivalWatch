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

let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  log.info("shutting down", { signal });
  const finish = (code: number) => {
    try {
      app.close();
    } catch {
      /* already closed */
    }
    process.exit(code);
  };
  server.close(() => finish(0));
  // Long-lived requests (e.g. the founder chat waiting on the model) would otherwise hold the process open
  // past the platform's grace period. Cut them after a few seconds; a forced-but-orderly stop is exit 0, not a crash.
  setTimeout(() => {
    log.warn("forcing shutdown with connections still open", { signal });
    (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    finish(0);
  }, 4000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => log.error("unhandled promise rejection", { error: reason instanceof Error ? reason.message : String(reason), stack: reason instanceof Error ? reason.stack : undefined }));
process.on("uncaughtException", (err) => {
  log.error("uncaught exception; exiting", { error: err.message, stack: err.stack });
  process.exit(1);
});
