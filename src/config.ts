import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/** Minimal .env loader (no dependency). Does not override existing env vars. */
function loadDotenv(path = resolve(process.cwd(), ".env")): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : !["false", "0", "no", "off"].includes(v.toLowerCase())));

const csv = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : []));

const ConfigSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().optional(),
  /** Public base URL used in emails (magic links, digests). Required in production. */
  PUBLIC_URL: z.string().optional(),
  DATABASE_PATH: z.string().default("./data/rivalwatch.db"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  SCHEDULER_ENABLED: bool(true),
  SCHEDULER_TICK_SECONDS: z.coerce.number().int().positive().default(60),

  FETCH_USER_AGENT: z.string().default("RivalWatchBot/0.1 (+https://rivalwatch.example/bot)"),
  FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  FETCH_MIN_HOST_DELAY_MS: z.coerce.number().int().nonnegative().default(2_000),

  /** Minutes to wait before re-fetching to confirm a detected change. 0 = confirm on the very next fetch. */
  CONFIRM_DELAY_MINUTES: z.coerce.number().int().nonnegative().default(60),

  AI_PROVIDER: z.enum(["heuristic", "anthropic"]).default("heuristic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-haiku-4-5"),
  /** Required when the API key is not scoped to a workspace (Console -> Settings -> Workspaces). */
  ANTHROPIC_WORKSPACE_ID: z.string().optional(),
  /** USD per million tokens, used for cost estimates. Defaults match Claude Haiku 4.5 list price. */
  AI_INPUT_COST_PER_MTOK: z.coerce.number().nonnegative().default(1.0),
  AI_OUTPUT_COST_PER_MTOK: z.coerce.number().nonnegative().default(5.0),
  /** Hard cap on model calls per rolling 24h. 0 = unlimited (not recommended). */
  AI_DAILY_CALL_CAP: z.coerce.number().int().nonnegative().default(300),
  /** Hard cap on estimated spend per rolling 24h in USD. 0 = unlimited. */
  AI_DAILY_COST_CAP_USD: z.coerce.number().nonnegative().default(2),

  /** Autonomous agents (support-ops, manager, growth). Off by default; requires the Anthropic provider. */
  AGENTS_ENABLED: bool(false),
  AGENT_MODEL: z.string().optional(),
  /** Rolling 24h cap across all agent runs (USD). */
  AGENT_DAILY_COST_CAP_USD: z.coerce.number().nonnegative().default(1),

  /** Nightly SQLite backups (VACUUM INTO + gzip) kept on the volume and optionally uploaded to S3-compatible storage. */
  BACKUP_ENABLED: bool(true),
  BACKUP_DIR: z.string().default("./data/backups"),
  BACKUP_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(3),
  BACKUP_KEEP_LOCAL: z.coerce.number().int().min(1).default(7),
  BACKUP_S3_BUCKET: z.string().optional(),
  BACKUP_S3_ENDPOINT: z.string().optional(),
  BACKUP_S3_REGION: z.string().default("auto"),
  BACKUP_S3_PREFIX: z.string().default("rivalwatch/"),
  BACKUP_S3_ACCESS_KEY_ID: z.string().optional(),
  BACKUP_S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Raw HTML of snapshots older than this is dropped; extracted text is kept. */
  SNAPSHOT_RAW_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),

  EMAIL_PROVIDER: z.enum(["log", "resend"]).default("log"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("RivalWatch <onboarding@resend.dev>"),
  /** Comma-separated emails that get the admin (operator) dashboard. */
  ADMIN_EMAILS: csv,
  /** Digest schedule: ISO weekday 1=Mon..7=Sun and hour (UTC). */
  DIGEST_WEEKDAY: z.coerce.number().int().min(1).max(7).default(1),
  DIGEST_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(8),

  /** One-time operator sign-in for fresh deployments without email. >= 16 chars. Remove after first login. */
  BOOTSTRAP_ADMIN_TOKEN: z.string().optional(),
  SESSION_DAYS: z.coerce.number().int().positive().default(30),
  MAGIC_LINK_MINUTES: z.coerce.number().int().positive().default(15),

  DEMO_SITE_ENABLED: bool(false),
});

export type Config = z.infer<typeof ConfigSchema> & { HOST: string; isProduction: boolean; publicUrl: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env === process.env) loadDotenv();
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(`Invalid configuration: ${issues}`);
  }
  const c = parsed.data;
  const isProduction = c.NODE_ENV === "production";
  const cfg: Config = {
    ...c,
    isProduction,
    // Bind to all interfaces in containers (platform injects PORT), loopback locally.
    HOST: c.HOST ?? (isProduction ? "0.0.0.0" : "127.0.0.1"),
    publicUrl: (c.PUBLIC_URL ?? `http://127.0.0.1:${c.PORT}`).replace(/\/$/, ""),
  };
  if (cfg.AI_PROVIDER === "anthropic" && !cfg.ANTHROPIC_API_KEY) throw new ConfigError("AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
  if (cfg.EMAIL_PROVIDER === "resend" && !cfg.RESEND_API_KEY) throw new ConfigError("EMAIL_PROVIDER=resend requires RESEND_API_KEY");
  if (isProduction && !c.PUBLIC_URL) throw new ConfigError("PUBLIC_URL is required in production (used in magic links)");
  if (isProduction && cfg.DEMO_SITE_ENABLED) throw new ConfigError("DEMO_SITE_ENABLED must be false in production");
  if (cfg.BOOTSTRAP_ADMIN_TOKEN && cfg.BOOTSTRAP_ADMIN_TOKEN.length < 16) throw new ConfigError("BOOTSTRAP_ADMIN_TOKEN must be at least 16 characters");
  return cfg;
}

/** Thrown for misconfiguration; the entrypoint prints these without a stack trace. */
export class ConfigError extends Error {
  readonly name = "ConfigError";
}

const SECRET_KEYS = ["ANTHROPIC_API_KEY", "RESEND_API_KEY", "BOOTSTRAP_ADMIN_TOKEN", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"] as const;

/** Config with secrets removed, safe to log or expose on /health. */
export function redactConfig(cfg: Config): Record<string, unknown> {
  const out: Record<string, unknown> = { ...cfg };
  for (const k of SECRET_KEYS) out[k] = cfg[k] ? "[set]" : "[unset]";
  return out;
}
