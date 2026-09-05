import type { Repo } from "../db/repo.js";
import type { Events } from "../events.js";
import { errorFields, log } from "../logger.js";
import type { Pipeline } from "./pipeline.js";

export interface SchedulerOptions {
  tickSeconds: number;
  /** Max pages processed per tick. Keeps a single tick bounded. */
  batchSize?: number;
}

export interface SchedulerStatus {
  running: boolean;
  lastTickAt: string | null;
  lastTickProcessed: number;
  ticks: number;
}

/**
 * Single-instance in-process scheduler. Each tick processes pages whose
 * next_check_at is due, sequentially (the fetcher already rate-limits per host).
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private inTick = false;
  private status: SchedulerStatus = { running: false, lastTickAt: null, lastTickProcessed: 0, ticks: 0 };
  private readonly batchSize: number;

  constructor(
    private readonly repo: Repo,
    private readonly events: Events,
    private readonly pipeline: Pipeline,
    private readonly opts: SchedulerOptions,
  ) {
    this.batchSize = opts.batchSize ?? 25;
  }

  start(): void {
    if (this.timer) return;
    this.status.running = true;
    this.timer = setInterval(() => void this.tick(), this.opts.tickSeconds * 1000);
    this.timer.unref();
    void this.tick();
    log.info("scheduler started", { tick_seconds: this.opts.tickSeconds });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status.running = false;
  }

  getStatus(): SchedulerStatus {
    return { ...this.status };
  }

  /** Process all due pages once. Safe to call manually (CLI, API). */
  async tick(): Promise<number> {
    if (this.inTick) return 0;
    this.inTick = true;
    const started = Date.now();
    let processed = 0;
    try {
      const due = this.repo.duePages(new Date().toISOString(), this.batchSize);
      for (const page of due) {
        try {
          const outcome = await this.pipeline.processPage(page);
          log.debug("page processed", { page_id: page.id, url: page.url, outcome: outcome.status });
        } catch (err) {
          log.error("pipeline error", { page_id: page.id, ...errorFields(err) });
          this.events.record({ type: "scheduler.error", entity: { type: "page", id: page.id }, payload: errorFields(err) });
        }
        processed++;
      }
      this.status = { ...this.status, lastTickAt: new Date().toISOString(), lastTickProcessed: processed, ticks: this.status.ticks + 1 };
      if (processed > 0) {
        this.events.record({ type: "scheduler.tick", payload: { processed, duration_ms: Date.now() - started } });
      }
    } finally {
      this.inTick = false;
    }
    return processed;
  }
}
