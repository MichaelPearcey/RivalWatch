import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError } from "../config.js";
import { log } from "../logger.js";

export type Db = DatabaseSync;

function migrationsDir(): string {
  // Works both from src/ (tsx) and dist/ (after build copies the .sql files).
  const here = dirname(fileURLToPath(import.meta.url));
  const local = join(here, "migrations");
  if (existsSync(local)) return local;
  const fromSrc = resolve(process.cwd(), "src/db/migrations");
  if (existsSync(fromSrc)) return fromSrc;
  throw new Error("Could not locate migrations directory");
}

export function openDb(path: string): Db {
  let db: DatabaseSync;
  try {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
    db = new DatabaseSync(path);
  } catch (err) {
    throw new ConfigError(`Cannot open database at ${path} (${(err as Error).message}). Is the directory writable by this user and the volume mounted? Set DATABASE_PATH to a writable location.`);
  }
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

export function migrate(db: Db): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`);
  const applied = new Set(
    (db.prepare("SELECT name FROM schema_migrations").all() as { name: string }[]).map((r) => r.name),
  );
  const dir = migrationsDir();
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(file);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
    ran.push(file);
    log.info("migration applied", { file });
  }
  return ran;
}

export function openAndMigrate(path: string): Db {
  const db = openDb(path);
  migrate(db);
  return db;
}

export function nowIso(): string {
  return new Date().toISOString();
}
