import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { createWriteStream } from "node:fs";
import type { Config } from "./config.js";
import type { Db } from "./db/index.js";
import type { Events } from "./events.js";
import { errorFields, log } from "./logger.js";

export interface BackupResult {
  ok: boolean;
  file: string | null;
  bytes: number;
  uploaded: boolean;
  error?: string;
}

/**
 * Nightly SQLite backup: `VACUUM INTO` (consistent copy while the app runs),
 * gzip, keep N local copies on the volume, optionally upload to S3-compatible
 * object storage (R2/B2/S3). Also applies data retention (raw HTML of old snapshots).
 */
export class Backups {
  private readonly s3: S3Client | null;

  constructor(
    private readonly cfg: Config,
    private readonly db: Db,
    private readonly events: Events,
  ) {
    this.s3 =
      cfg.BACKUP_S3_BUCKET && cfg.BACKUP_S3_ENDPOINT && cfg.BACKUP_S3_ACCESS_KEY_ID && cfg.BACKUP_S3_SECRET_ACCESS_KEY
        ? new S3Client({ region: cfg.BACKUP_S3_REGION, endpoint: cfg.BACKUP_S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: cfg.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: cfg.BACKUP_S3_SECRET_ACCESS_KEY } })
        : null;
  }

  get offsiteConfigured(): boolean {
    return this.s3 !== null;
  }

  private get dir(): string {
    return resolve(this.cfg.BACKUP_DIR);
  }

  async run(actor = "system"): Promise<BackupResult> {
    if (this.cfg.DATABASE_PATH === ":memory:") return { ok: false, file: null, bytes: 0, uploaded: false, error: "in-memory database cannot be backed up" };
    mkdirSync(this.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const raw = join(this.dir, `rivalwatch-${stamp}.db`);
    const gz = `${raw}.gz`;
    try {
      this.db.exec(`VACUUM INTO '${raw.replace(/'/g, "''")}'`);
      await pipeline(createReadStream(raw), createGzip({ level: 6 }), createWriteStream(gz));
      unlinkSync(raw);
      const bytes = statSync(gz).size;
      let uploaded = false;
      if (this.s3) {
        await this.s3.send(new PutObjectCommand({ Bucket: this.cfg.BACKUP_S3_BUCKET!, Key: `${this.cfg.BACKUP_S3_PREFIX}${basename(gz)}`, Body: createReadStream(gz), ContentType: "application/gzip", ContentLength: bytes }));
        uploaded = true;
      }
      const pruned = this.pruneLocal();
      this.events.record({ type: "backup.completed", actor, payload: { file: basename(gz), bytes, uploaded, offsite: this.offsiteConfigured, pruned_local: pruned } });
      log.info("backup completed", { file: basename(gz), bytes, uploaded });
      return { ok: true, file: gz, bytes, uploaded };
    } catch (err) {
      for (const f of [raw, gz]) if (existsSync(f) && statSync(f).size === 0) unlinkSync(f);
      this.events.record({ type: "backup.failed", actor, result: "failed", riskLevel: "high", payload: errorFields(err) });
      log.error("backup failed", errorFields(err));
      return { ok: false, file: existsSync(gz) ? gz : null, bytes: 0, uploaded: false, error: (err as Error).message };
    }
  }

  listLocal(): { file: string; bytes: number; mtime: string }[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".db.gz"))
      .map((f) => ({ file: f, bytes: statSync(join(this.dir, f)).size, mtime: statSync(join(this.dir, f)).mtime.toISOString() }))
      .sort((a, b) => b.file.localeCompare(a.file));
  }

  private pruneLocal(): number {
    const files = this.listLocal();
    const excess = files.slice(this.cfg.BACKUP_KEEP_LOCAL);
    for (const f of excess) unlinkSync(join(this.dir, f.file));
    return excess.length;
  }

  /** Drop stored raw HTML for snapshots older than the retention window; extracted text is kept forever. */
  applyRetention(actor = "system"): number {
    const cutoff = new Date(Date.now() - this.cfg.SNAPSHOT_RAW_RETENTION_DAYS * 86_400_000).toISOString();
    const n = Number(this.db.prepare("UPDATE snapshots SET raw_gzip = NULL WHERE raw_gzip IS NOT NULL AND fetched_at < ?").run(cutoff).changes);
    if (n > 0) this.events.record({ type: "retention.applied", actor, payload: { snapshots_raw_cleared: n, older_than: cutoff } });
    return n;
  }

  /** Scheduler job: backup once per day after BACKUP_HOUR_UTC, retention alongside. */
  async runDue(now = new Date()): Promise<boolean> {
    if (!this.cfg.BACKUP_ENABLED) return false;
    const today = now.toISOString().slice(0, 10);
    const last = this.events.list({ type: "backup.completed", limit: 1 })[0];
    if (last && last.ts.slice(0, 10) === today) return false;
    if (now.getUTCHours() < this.cfg.BACKUP_HOUR_UTC) return false;
    const attemptedToday = this.events.list({ type: "backup.failed", limit: 1 })[0];
    if (attemptedToday && attemptedToday.ts.slice(0, 10) === today && Date.now() - new Date(attemptedToday.ts).getTime() < 3_600_000) return false; // retry hourly at most
    this.applyRetention();
    await this.run();
    return true;
  }
}
