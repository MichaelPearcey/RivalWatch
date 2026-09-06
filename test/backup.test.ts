import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { fixture, json, login, testApp } from "./helpers.js";

describe("backups and retention", () => {
  let dir: string;
  let t: ReturnType<typeof testApp>;
  afterEach(() => {
    t?.app.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("writes a consistent gzipped copy of the live database, rotates local copies, and is audited", async () => {
    dir = mkdtempSync(join(tmpdir(), "rw-backup-"));
    t = testApp({ DATABASE_PATH: join(dir, "live.db"), BACKUP_DIR: join(dir, "backups"), BACKUP_KEEP_LOCAL: 2 });
    const f = await fixture(t);
    await f.scan();

    const admin = await login(t.web, "admin@rivalwatch.test");
    const r1 = await json<{ ok: boolean; file: string; bytes: number; uploaded: boolean }>(t.web, "/api/admin/backups/run", { method: "POST", session: admin });
    expect(r1.body.ok).toBe(true);
    expect(r1.body.uploaded).toBe(false);
    expect(existsSync(r1.body.file)).toBe(true);

    // The copy is a valid SQLite database with the same data.
    const tmp = join(dir, "restored.db");
    writeFileSync(tmp, gunzipSync(readFileSync(r1.body.file)));
    const restored = new DatabaseSync(tmp);
    expect((restored.prepare("SELECT COUNT(*) c FROM snapshots").get() as { c: number }).c).toBe(3);
    expect((restored.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c).toBe(2);
    restored.close();

    await new Promise((r) => setTimeout(r, 1100)); // distinct timestamps
    await json(t.web, "/api/admin/backups/run", { method: "POST", session: admin });
    await new Promise((r) => setTimeout(r, 1100));
    await json(t.web, "/api/admin/backups/run", { method: "POST", session: admin });
    expect(readdirSync(join(dir, "backups")).filter((x) => x.endsWith(".db.gz"))).toHaveLength(2);

    const ev = t.app.events.list({ type: "backup.completed" });
    expect(ev).toHaveLength(3);
    expect(JSON.parse(ev[0]!.payload)).toMatchObject({ uploaded: false, offsite: false, pruned_local: 1 });
    const status = await json<{ offsite: boolean; local: unknown[] }>(t.web, "/api/admin/backups", { session: admin });
    expect(status.body.offsite).toBe(false);
    expect(status.body.local).toHaveLength(2);
  });

  it("refuses to back up an in-memory database and records the failure", async () => {
    t = testApp();
    const r = await t.app.backups.run();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/in-memory/);
  });

  it("retention clears raw HTML of old snapshots but keeps their text", async () => {
    t = testApp({ SNAPSHOT_RAW_RETENTION_DAYS: 10 });
    const f = await fixture(t);
    await f.scan();
    t.app.db.prepare("UPDATE snapshots SET fetched_at = '2020-01-01T00:00:00Z' WHERE id = 1").run();
    expect(t.app.backups.applyRetention()).toBe(1);
    const old = t.app.repo.getSnapshot(t.app.repo.getUserByEmail(f.session.email)!.account_id, 1)!;
    expect(old.raw_gzip).toBeNull();
    expect(old.text.length).toBeGreaterThan(0);
    const fresh = t.app.repo.latestSnapshot(f.pages[1]!.id)!;
    expect(fresh.raw_gzip).not.toBeNull();
    expect(t.app.events.list({ type: "retention.applied" })).toHaveLength(1);
  });

  it("runDue backs up at most once per day after the configured hour", async () => {
    dir = mkdtempSync(join(tmpdir(), "rw-backup-"));
    t = testApp({ DATABASE_PATH: join(dir, "live.db"), BACKUP_DIR: join(dir, "backups"), BACKUP_HOUR_UTC: 0 });
    expect(await t.app.backups.runDue(new Date())).toBe(true);
    expect(await t.app.backups.runDue(new Date())).toBe(false);
    t.app.close();
    t = testApp({ DATABASE_PATH: join(dir, "live2.db"), BACKUP_DIR: join(dir, "backups2"), BACKUP_HOUR_UTC: 23 });
    const beforeHour = new Date();
    beforeHour.setUTCHours(1);
    expect(await t.app.backups.runDue(beforeHour)).toBe(false);
  });
});
