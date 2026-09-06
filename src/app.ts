import { createAnalyzer } from "./ai/index.js";
import type { Analyzer } from "./ai/types.js";
import { Agents } from "./agents/index.js";
import type { MessagesClient } from "./agents/runner.js";
import { Approvals } from "./approvals.js";
import { Auth } from "./auth.js";
import { Backups } from "./backup.js";
import type { Config } from "./config.js";
import { openAndMigrate, type Db } from "./db/index.js";
import { Repo } from "./db/repo.js";
import { DigestJob } from "./digest.js";
import { Events } from "./events.js";
import { setLogLevel } from "./logger.js";
import { createMailer, type Mailer } from "./mail/index.js";
import { Pipeline, type PipelineOptions } from "./monitor/pipeline.js";
import { Scheduler } from "./monitor/scheduler.js";
import { SourceRegistry } from "./sources/types.js";
import { PoliteFetcher } from "./sources/website/fetcher.js";
import { WebsiteSource } from "./sources/website/index.js";

/** Everything the HTTP layer, CLI and tests need, wired once. */
export interface App {
  cfg: Config;
  db: Db;
  repo: Repo;
  events: Events;
  sources: SourceRegistry;
  fetcher: PoliteFetcher;
  analyzer: Analyzer;
  pipeline: Pipeline;
  scheduler: Scheduler;
  mailer: Mailer;
  auth: Auth;
  digests: DigestJob;
  approvals: Approvals;
  agents: Agents;
  backups: Backups;
  close(): void;
}

export interface AppOverrides {
  analyzer?: Analyzer;
  fetchImpl?: typeof fetch;
  pipeline?: PipelineOptions;
  /** Fake Anthropic messages client for agent tests. */
  agentClient?: MessagesClient;
}

export function createApp(cfg: Config, overrides: AppOverrides = {}): App {
  setLogLevel(cfg.LOG_LEVEL);
  const db = openAndMigrate(cfg.DATABASE_PATH);
  const repo = new Repo(db);
  const events = new Events(db);

  const fetcher = new PoliteFetcher({
    userAgent: cfg.FETCH_USER_AGENT,
    timeoutMs: cfg.FETCH_TIMEOUT_MS,
    minHostDelayMs: cfg.FETCH_MIN_HOST_DELAY_MS,
    ...(overrides.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {}),
  });
  const sources = new SourceRegistry().register(new WebsiteSource(fetcher));

  const analyzer = overrides.analyzer ?? createAnalyzer(cfg, events);
  const pipeline = new Pipeline(repo, events, sources, analyzer, { confirmDelayMinutes: cfg.CONFIRM_DELAY_MINUTES, ...overrides.pipeline });
  const mailer = createMailer(cfg, repo, events, overrides.fetchImpl);
  const auth = new Auth(cfg, repo, events, mailer);
  const digests = new DigestJob(cfg, repo, events, mailer);

  const scheduler = new Scheduler(repo, events, pipeline, { tickSeconds: cfg.SCHEDULER_TICK_SECONDS })
    .addJob({ name: "digests", run: (now) => digests.runDue(now).then(() => undefined) })
    .addJob({ name: "auth_purge", run: (now) => repo.purgeExpiredAuth(now.toISOString()) });

  const app: App = {
    cfg,
    db,
    repo,
    events,
    sources,
    fetcher,
    analyzer,
    pipeline,
    scheduler,
    mailer,
    auth,
    digests,
    approvals: undefined as unknown as Approvals,
    agents: undefined as unknown as Agents,
    backups: new Backups(cfg, db, events),
    close() {
      scheduler.stop();
      db.close();
    },
  };
  app.approvals = new Approvals(app);
  app.agents = new Agents(app, cfg, overrides.agentClient);
  scheduler.addJob({ name: "approvals_expire", run: (now) => void app.approvals.expireStale(now) });
  scheduler.addJob({ name: "agents", run: (now) => app.agents.runDue(now).then(() => undefined) });
  scheduler.addJob({ name: "backups", run: (now) => app.backups.runDue(now).then(() => undefined) });
  return app;
}
