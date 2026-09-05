import type { Hono } from "hono";
import { createApp, type App, type AppOverrides } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { createWebApp } from "../src/web/app.js";

export const BASE = "http://rivalwatch.test";

/**
 * Boots the full application in-memory with the demo competitor site, and
 * routes the fetcher's HTTP calls straight into the Hono app (no sockets).
 */
export function testApp(overrides: Partial<Config> = {}, appOverrides: AppOverrides = {}): { app: App; web: Hono; base: string } {
  const cfg: Config = {
    ...loadConfig({ PUBLIC_URL: BASE }),
    DATABASE_PATH: ":memory:",
    SCHEDULER_ENABLED: false,
    DEMO_SITE_ENABLED: true,
    FETCH_MIN_HOST_DELAY_MS: 0,
    CONFIRM_DELAY_MINUTES: 0,
    LOG_LEVEL: "error",
    AI_PROVIDER: "heuristic",
    EMAIL_PROVIDER: "log",
    ADMIN_EMAILS: ["admin@rivalwatch.test"],
    ...overrides,
  };
  let web: Hono;
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => web.request(input as string, init)) as typeof fetch;
  const app = createApp(cfg, { fetchImpl, ...appOverrides });
  web = createWebApp(app);
  return { app, web, base: BASE };
}

export interface Session {
  cookie: string;
  email: string;
}

/** Full magic-link flow through the HTTP layer; returns the session cookie. */
export async function login(web: Hono, email: string): Promise<Session> {
  const req = await web.request(`${BASE}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
  const { dev_link } = (await req.json()) as { dev_link: string };
  if (!dev_link) throw new Error("no dev_link returned; is the log email provider active?");
  const verify = await web.request(dev_link);
  const setCookie = verify.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0] ?? "";
  if (!cookie.startsWith("rw_session=")) throw new Error(`login failed: ${verify.status} ${setCookie}`);
  return { cookie, email };
}

export async function json<T = unknown>(web: Hono, path: string, init: RequestInit & { session?: Session; bearer?: string } = {}): Promise<{ status: number; body: T }> {
  const { session, bearer, ...rest } = init;
  const res = await web.request(`${BASE}${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(session ? { cookie: session.cookie } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(rest.headers ?? {}),
    },
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

export async function html(web: Hono, path: string, session?: Session, init: RequestInit = {}): Promise<{ status: number; text: string; location: string | null }> {
  const res = await web.request(`${BASE}${path}`, { ...init, headers: { accept: "text/html", ...(session ? { cookie: session.cookie } : {}), ...(init.headers ?? {}) } });
  return { status: res.status, text: await res.text(), location: res.headers.get("location") };
}

/** Standard fixture: a logged-in user with a business and the demo competitor (home + pricing + products). */
export async function fixture(t: ReturnType<typeof testApp>, email = "owner@rivalwatch.test") {
  const session = await login(t.web, email);
  // Plan upgrades are an operator action (no self-service API yet); the fixture needs Pro limits.
  t.app.repo.updateAccountPlan(t.app.repo.getUserByEmail(email)!.account_id, "pro");
  const business = (await json<{ id: number }>(t.web, "/api/businesses", { method: "POST", session, body: JSON.stringify({ name: "Bright Pixel", pricing_notes: "Starter £25/month, Studio £55/month" }) })).body;
  const created = await json<{ competitor: { id: number }; pages: { id: number; url: string; kind: string }[]; suggestions: unknown[] }>(t.web, `/api/businesses/${business.id}/competitors`, {
    method: "POST",
    session,
    body: JSON.stringify({
      name: "Acme Studio",
      website: `${BASE}/demo/`,
      discover: false,
      pages: [
        { url: `${BASE}/demo/`, kind: "home" },
        { url: `${BASE}/demo/pricing`, kind: "pricing" },
        { url: `${BASE}/demo/products`, kind: "products" },
      ],
    }),
  });
  if (created.status !== 201) throw new Error(`fixture failed: ${JSON.stringify(created.body)}`);
  const scan = () => json<{ page_id: number; status: string }[]>(t.web, `/api/businesses/${business.id}/scan`, { method: "POST", session });
  const setDemo = (patch: Record<string, unknown>) => json(t.web, "/demo/state", { method: "POST", body: JSON.stringify(patch) });
  const insights = (noise = false) => json<Insight[]>(t.web, `/api/businesses/${business.id}/insights${noise ? "?include_noise=1" : ""}`, { session });
  return { session, business, competitor: created.body.competitor, pages: created.body.pages, scan, setDemo, insights };
}

export interface Insight {
  id: number;
  category: string;
  matters: number;
  headline: string;
  why_it_matters: string;
  provider: string;
  competitor_id: number;
  change_id: number;
  feedback: { verdict: string }[];
}
