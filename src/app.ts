import { createAnalyzer } from "./ai/index.js";
import type { Analyzer } from "./ai/types.js";
import type { Config } from "./config.js";
import { openAndMigrate, type Db } from "./db/index.js";
import { Repo } from "./db/repo.js";
import { Events } from "./events.js";
import { setLogLevel } from "./logger.js";
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
  analyzer: Analyzer;
  pipeline: Pipeline;
  scheduler: Scheduler;
  close(): void;
}

export interface AppOverrides {
  analyzer?: Analyzer;
  fetchImpl?: typeof fetch;
  pipeline?: PipelineOptions;
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
  const pipeline = new Pipeline(repo, events, sources, analyzer, overrides.pipeline ?? {});
  const scheduler = new Scheduler(repo, events, pipeline, { tickSeconds: cfg.SCHEDULER_TICK_SECONDS });

  return {
    cfg,
    db,
    repo,
    events,
    sources,
    analyzer,
    pipeline,
    scheduler,
    close() {
      scheduler.stop();
      db.close();
    },
  };
}
