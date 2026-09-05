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

const bool = z
  .string()
  .optional()
  .transform((v) => v === undefined || !["false", "0", "no", "off"].includes(v.toLowerCase()));

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_PATH: z.string().default("./data/rivalwatch.db"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  SCHEDULER_ENABLED: bool,
  SCHEDULER_TICK_SECONDS: z.coerce.number().int().positive().default(60),

  FETCH_USER_AGENT: z.string().default("RivalWatchBot/0.1 (+https://rivalwatch.example/bot)"),
  FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  FETCH_MIN_HOST_DELAY_MS: z.coerce.number().int().nonnegative().default(2_000),

  AI_PROVIDER: z.enum(["heuristic", "anthropic"]).default("heuristic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-3-5-haiku-latest"),
  AI_DAILY_CALL_CAP: z.coerce.number().int().nonnegative().default(500),

  DEMO_SITE_ENABLED: bool,
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  loadDotenv();
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.message}`);
  }
  const cfg = parsed.data;
  if (cfg.AI_PROVIDER === "anthropic" && !cfg.ANTHROPIC_API_KEY) {
    throw new Error("AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
  }
  return cfg;
}

/** Config with secrets removed, safe to log or expose on /health. */
export function redactConfig(cfg: Config): Record<string, unknown> {
  const { ANTHROPIC_API_KEY, ...rest } = cfg;
  return { ...rest, ANTHROPIC_API_KEY: ANTHROPIC_API_KEY ? "[set]" : "[unset]" };
}
