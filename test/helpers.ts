import type { Hono } from "hono";
import { createApp, type App, type AppOverrides } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { createWebApp } from "../src/web/app.js";

/**
 * Boots the full application in-memory with the demo competitor site, and
 * routes the fetcher's HTTP calls straight into the Hono app (no sockets).
 */
export function testApp(overrides: Partial<Config> = {}, appOverrides: AppOverrides = {}): { app: App; web: Hono; base: string } {
  const cfg: Config = {
    ...loadConfig({}),
    DATABASE_PATH: ":memory:",
    SCHEDULER_ENABLED: false,
    DEMO_SITE_ENABLED: true,
    FETCH_MIN_HOST_DELAY_MS: 0,
    LOG_LEVEL: "error",
    AI_PROVIDER: "heuristic",
    ...overrides,
  };
  let web: Hono;
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => web.request(input as string, init)) as typeof fetch;
  const app = createApp(cfg, { fetchImpl, ...appOverrides });
  web = createWebApp(app);
  return { app, web, base: "http://rivalwatch.test" };
}

export async function json<T = unknown>(web: Hono, path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await web.request(`http://rivalwatch.test${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}
