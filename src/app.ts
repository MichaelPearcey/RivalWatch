import { createAnalyzer } from "./ai/index.js";
import { JsonLlm } from "./ai/llm.js";
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
import { Founder } from "./founder/index.js";
import { GitHub } from "./github.js";
import { setLogLevel } from "./logger.js";
import { Memory } from "./memory.js";
import { createMailer, type Mailer } from "./mail/index.js";
import { Pipeline, type PipelineOptions } from "./monitor/pipeline.js";
import { NewsMonitor } from "./news/index.js";
import { GoogleNewsRss } from "./news/source.js";
import { Scheduler } from "./monitor/scheduler.js";
import { SourceRegistry } from "./sources/types.js";
import { purgeDeletedAccounts } from "./web/actions.js";
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
  llm: JsonLlm;
  news: NewsMonitor;
  memory: Memory;
  founder: Founder;
  /** Repo access for the founder assistant; null when GITHUB_BOT_TOKEN/GITHUB_REPO are not set. */
  github: GitHub | null;
  /** Fire-and-forget work (e.g. competitor profiling) is tracked here so tests and shutdown can await it. */
  track<T>(p: Promise<T>): Promise<T>;
  idle(): Promise<void>;
  close(): void;
}

export interface AppOverrides {
  analyzer?: Analyzer;
  fetchImpl?: typeof fetch;
  pipeline?: PipelineOptions;
  /** Fake Anthropic messages client for agent tests. */
  agentClient?: MessagesClient;
  /** Fake client for JSON completions (competitor profiles) in tests. */
  llmClient?: MessagesClient;
  /** Fake client for the founder chat in tests. */
  founderClient?: MessagesClient;
  /** Fake GitHub client in tests. */
  github?: GitHub;
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
    llm: new JsonLlm(cfg, events, overrides.llmClient),
    news: undefined as unknown as NewsMonitor,
    memory: new Memory(db, events),
    founder: undefined as unknown as Founder,
    github: overrides.github ?? (cfg.GITHUB_BOT_TOKEN && cfg.GITHUB_REPO ? new GitHub({ token: cfg.GITHUB_BOT_TOKEN, repo: cfg.GITHUB_REPO }) : null),
    track(p) {
      tasks.add(p);
      void p.finally(() => tasks.delete(p));
      return p;
    },
    async idle() {
      while (tasks.size) await Promise.allSettled([...tasks]);
    },
    close() {
      scheduler.stop();
      db.close();
    },
  };
  const tasks = new Set<Promise<unknown>>();
  app.approvals = new Approvals(app);
  app.agents = new Agents(app, cfg, overrides.agentClient);
  app.news = new NewsMonitor(app, new GoogleNewsRss(fetcher));
  app.founder = new Founder(app, cfg, overrides.founderClient);
  scheduler.addJob({ name: "news", run: (now) => app.news.runDue(now).then(() => undefined) });
  scheduler.addJob({ name: "approvals_expire", run: (now) => void app.approvals.expireStale(now) });
  scheduler.addJob({ name: "agents", run: (now) => app.agents.runDue(now).then(() => undefined) });
  scheduler.addJob({ name: "backups", run: (now) => app.backups.runDue(now).then(() => undefined) });
  scheduler.addJob({ name: "account_purge", run: (now) => void purgeDeletedAccounts(app, now) });
  return app;
}
