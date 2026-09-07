import { Hono, type Context, type Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import type { App } from "../app.js";
import { ACTIONS, ApprovalError } from "../approvals.js";
import { AuthError, SESSION_COOKIE, type Principal } from "../auth.js";
import { redactConfig } from "../config.js";
import { errorFields, log } from "../logger.js";
import { PLANS } from "../plans.js";
import * as A from "./actions.js";
import { adminOverview } from "./admin.js";
import { createDemoSite } from "./demo-site.js";
import { LANG_COOKIE, isLocale, resolveLocale, translator, type Locale, type MessageKey, type Translate } from "../i18n/index.js";
import { landscapeFilename, renderLandscapeDocument } from "./landscape-doc.js";
import { crawlerPage, privacyPolicy, termsOfService } from "../legal.js";
import { MEMORY_KINDS } from "../memory.js";
import { streamSSE } from "hono/streaming";
import { FounderPage } from "./founder-views.js";
import { renderMarkdown } from "./md.js";
import { AdminPage, BUSINESS_TABS, BusinessPage, BusinessesPage, ConsentPage, InsightDetailPage, LandingPage, LegalPage, LoginPage, PageDetailPage, PricingPage, SettingsPage, type BusinessTab } from "./views.js";

type Env = { Variables: { principal: Principal | undefined; t: Translate; locale: Locale } };
type Ctx = Context<Env>;

const idParam = z.coerce.number().int().positive();
// Works from src/ (tsx) and dist/ (built): public/ sits next to both at the project root.
const STATIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../public");

export function createWebApp(app: App) {
  const web = new Hono<Env>({ strict: false });
  const { repo, events, auth, cfg } = app;
  const secure = cfg.publicUrl.startsWith("https://");

  // ---------------- Error handling ----------------
  web.onError((err, c) => {
    const wantsHtml = !c.req.path.startsWith("/api/") && (c.req.header("accept") ?? "").includes("text/html");
    if (err instanceof A.ActionError || err instanceof AuthError || err instanceof ApprovalError) {
      if (wantsHtml && err.status === 404) return c.html(<LoginPage t={T(c)} error="Not found." />, 404);
      return c.json({ error: err.message }, err.status as 400);
    }
    if (err instanceof z.ZodError) return c.json({ error: "validation failed", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
    log.error("unhandled request error", { path: c.req.path, ...errorFields(err) });
    return c.json({ error: "internal error" }, 500);
  });

  // ---------------- Authentication + locale middleware ----------------
  web.use("*", async (c, next) => {
    const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const principal = bearer ? auth.principalFromApiKey(bearer) : auth.principalFromSession(getCookie(c, SESSION_COOKIE));
    c.set("principal", principal);
    const locale = resolveLocale({ cookie: getCookie(c, LANG_COOKIE), user: principal?.user.locale, acceptLanguage: c.req.header("accept-language") });
    c.set("t", translator(locale));
    c.set("locale", locale);
    await next();
  });
  const T = (c: Ctx): Translate => c.get("t");
  const localeOf = (c: Ctx): Locale => c.get("locale");

  /** Language switcher: remembers the choice in a functional cookie and, when signed in, on the user. */
  web.get("/lang", (c) => {
    const lang = c.req.query("lang");
    if (isLocale(lang)) {
      setCookie(c, LANG_COOKIE, lang, { httpOnly: true, sameSite: "Lax", secure, path: "/", maxAge: 365 * 86_400 });
      const p = c.get("principal");
      if (p?.via === "session") repo.setUserLocale(p.user.id, lang);
    }
    const back = c.req.header("referer");
    return c.redirect(back && back.startsWith(cfg.publicUrl) ? back : "/");
  });

  const requireAuth = async (c: Ctx, next: Next) => {
    const p = c.get("principal");
    if (!p) {
      if (c.req.path.startsWith("/api/")) return c.json({ error: "authentication required" }, 401);
      return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
    }
    // Browser sessions must have accepted the current legal documents (API keys inherit the owner's acceptance).
    if (p.via === "session" && !c.req.path.startsWith("/api/") && !auth.hasCurrentConsent(p.user)) {
      return c.redirect(`/legal/accept?next=${encodeURIComponent(c.req.path)}`);
    }
    return next();
  };
  const ipOf = (c: Ctx) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? null;
  const setSession = (c: Ctx, token: string) => setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: "Lax", secure, path: "/", maxAge: cfg.SESSION_DAYS * 86_400 });
  const safeNext = (v: unknown) => (typeof v === "string" && /^\/(?!\/)[\w\-./?=&%]*$/.test(v) ? v : "/");
  const requireAdmin = async (c: Ctx, next: Next) => {
    const p = c.get("principal");
    if (!p) return c.req.path.startsWith("/api/") ? c.json({ error: "authentication required" }, 401) : c.redirect("/login");
    if (!p.isAdmin) return c.json({ error: "admin only" }, 403);
    return next();
  };
  const P = (c: Ctx): Principal => c.get("principal")!;
  const id = (c: Ctx, name = "id") => idParam.parse(c.req.param(name));

  // ---------------- Public: health, auth, demo ----------------
  web.get("/health", (c) => {
    let db: "ok" | "error" = "ok";
    try {
      app.db.prepare("SELECT 1").get();
    } catch {
      db = "error";
    }
    const s = app.scheduler.getStatus();
    const body = { status: db === "ok" ? "ok" : "degraded", db, scheduler: s, analyzer: app.analyzer.name, mail: app.mailer.providerName, version: process.env.npm_package_version ?? "dev" };
    // Full config only for admins.
    const p = c.get("principal");
    return c.json(p?.isAdmin ? { ...body, sources: app.sources.types(), config: redactConfig(cfg) } : body, db === "ok" ? 200 : 503);
  });

  // Self-hosted static assets (fonts). Whitelisted names only; long-lived cache.
  web.get("/static/fonts/:file", (c) => {
    const file = String(c.req.param("file"));
    if (!/^[a-z0-9-]+\.woff2$/.test(file)) return c.notFound();
    const path = resolve(STATIC_DIR, "fonts", file);
    if (!existsSync(path)) return c.notFound();
    c.header("content-type", "font/woff2");
    c.header("cache-control", "public, max-age=31536000, immutable");
    return c.body(readFileSync(path));
  });

  // Public marketing + legal pages
  web.get("/", (c) => {
    const p = c.get("principal");
    if (!p) return c.html(<LandingPage t={T(c)} />);
    if (!auth.hasCurrentConsent(p.user)) return c.redirect("/legal/accept?next=%2F");
    return c.html(<BusinessesPage t={T(c)} principal={p} businesses={repo.listBusinesses(p.accountId)} account={repo.getAccount(p.accountId)!} flash={c.req.query("flash")} />);
  });
  web.get("/pricing", (c) => c.html(<PricingPage t={T(c)} principal={c.get("principal")} />));
  web.get("/privacy", (c) => c.html(<LegalPage t={T(c)} title="Privacy Policy" markdown={privacyPolicy()} principal={c.get("principal")} />));
  web.get("/terms", (c) => c.html(<LegalPage t={T(c)} title="Terms of Service" markdown={termsOfService()} principal={c.get("principal")} />));
  web.get("/bot", (c) => c.html(<LegalPage t={T(c)} title="About our crawler" markdown={crawlerPage()} principal={c.get("principal")} />));
  web.get("/legal/accept", (c) => {
    const p = c.get("principal");
    if (!p) return c.redirect("/login");
    if (auth.hasCurrentConsent(p.user)) return c.redirect(safeNext(c.req.query("next")));
    return c.html(<ConsentPage t={T(c)} principal={p} next={c.req.query("next")} firstTime={repo.listConsents(p.user.id).length === 0} />);
  });
  web.post("/legal/accept", async (c) => {
    const p = c.get("principal");
    if (!p) return c.redirect("/login");
    const form = await bodyOf(c);
    if (form.terms !== "1" || form.privacy !== "1") return c.html(<ConsentPage t={T(c)} principal={p} next={String(form.next ?? "/")} firstTime={repo.listConsents(p.user.id).length === 0} error="Please tick both boxes to continue." />, 400);
    auth.acceptLegal(p.user, ipOf(c));
    return c.redirect(safeNext(form.next));
  });

  web.get("/login", (c) => (c.get("principal") ? c.redirect("/") : c.html(<LoginPage t={T(c)} mode={c.req.query("mode") === "signup" ? "signup" : "signin"} next={c.req.query("next")} />)));
  web.post("/auth/login", async (c) => {
    const body = await bodyOf(c);
    const email = z.string().email().max(254).parse(body.email);
    try {
      const r = await auth.requestLogin(email, ipOf(c));
      if (isJson(c)) return c.json({ sent: r.sent, ...(r.devLink ? { dev_link: r.devLink } : {}), ...(r.error ? { error: r.error } : {}) }, r.sent ? 200 : 502);
      if (!r.sent) return c.html(<LoginPage t={T(c)} error={`We couldn't send your sign-in email. Email provider said: ${r.error ?? "unknown error"}`} email={email} />, 502);
      return c.html(<LoginPage t={T(c)} sent email={email} devLink={r.devLink} />);
    } catch (err) {
      if (err instanceof AuthError) return isJson(c) ? c.json({ error: err.message }, err.status) : c.html(<LoginPage t={T(c)} error={err.message} email={email} />, err.status);
      throw err;
    }
  });
  web.post("/auth/password", async (c) => {
    const body = await bodyOf(c);
    const { email, password } = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) }).parse(body);
    try {
      const { sessionToken } = await auth.loginWithPassword(email, password, ipOf(c));
      setSession(c, sessionToken);
      if (isJson(c)) return c.json({ ok: true });
      return c.redirect(safeNext(body.next));
    } catch (err) {
      if (err instanceof AuthError) return isJson(c) ? c.json({ error: err.message }, err.status) : c.html(<LoginPage t={T(c)} error={err.message} email={email} />, err.status);
      throw err;
    }
  });
  web.post("/auth/signup", async (c) => {
    const body = await bodyOf(c);
    const { email, password } = z.object({ email: z.string().email().max(254), password: z.string().max(128) }).parse(body);
    try {
      const { sessionToken } = await auth.signupWithPassword(email, password, ipOf(c));
      setSession(c, sessionToken);
      if (isJson(c)) return c.json({ ok: true }, 201);
      return c.redirect(safeNext(body.next));
    } catch (err) {
      if (err instanceof AuthError) return isJson(c) ? c.json({ error: err.message }, err.status) : c.html(<LoginPage t={T(c)} mode="signup" error={err.message} email={email} />, err.status);
      throw err;
    }
  });
  web.post("/auth/resend-verification", async (c) => {
    const p = c.get("principal");
    if (!p || p.via !== "session") return c.redirect("/login");
    try {
      const r = await auth.sendVerification(p.user, ipOf(c));
      if (isJson(c)) return c.json(r);
      return c.redirect(`/?flash=${encodeURIComponent(r.sent ? T(c)("verify.sent") : (r.error ?? "send failed"))}`);
    } catch (err) {
      if (err instanceof AuthError) return isJson(c) ? c.json({ error: err.message }, err.status) : c.redirect(`/?flash=${encodeURIComponent(err.message)}`);
      throw err;
    }
  });
  web.get("/auth/verify", (c) => {
    const token = c.req.query("token") ?? "";
    try {
      const { sessionToken } = auth.verify(token);
      setSession(c, sessionToken);
      return c.redirect("/");
    } catch (err) {
      if (err instanceof AuthError) return c.html(<LoginPage t={T(c)} error={err.message} />, err.status);
      throw err;
    }
  });
  web.get("/auth/logout-get", (c) => {
    auth.logout(getCookie(c, SESSION_COOKIE), c.get("principal"));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.redirect("/");
  });
  // One-time operator bootstrap (see Auth.bootstrapAdmin). GET so it can be opened from a browser.
  web.get("/auth/bootstrap", (c) => {
    try {
      const { sessionToken, user } = auth.bootstrapAdmin(c.req.query("token") ?? "", c.req.query("email") ?? "");
      setSession(c, sessionToken);
      // The operator bootstrapping the system is deemed to accept the documents they publish.
      auth.acceptLegal(user, ipOf(c));
      return c.redirect("/admin");
    } catch (err) {
      if (err instanceof AuthError) return c.html(<LoginPage t={T(c)} error={err.message} />, err.status);
      throw err;
    }
  });
  web.post("/auth/logout", (c) => {
    auth.logout(getCookie(c, SESSION_COOKIE), c.get("principal"));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.redirect("/login");
  });
  web.get("/api/plans", (c) => c.json(PLANS));

  if (cfg.DEMO_SITE_ENABLED) {
    web.route("/demo", createDemoSite().app);
    web.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /demo/private/\n"));
  } else {
    web.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));
  }

  // ---------------- Authenticated JSON API ----------------
  const api = new Hono<Env>({ strict: false });
  api.use("*", requireAuth);

  api.get("/me", (c) => {
    const p = P(c);
    return c.json({ user: { id: p.user.id, email: p.user.email, is_admin: p.isAdmin, has_password: !!p.user.password_hash, locale: p.user.locale }, account: repo.getAccount(p.accountId), actor: p.actor, via: p.via });
  });
  api.patch("/me", async (c) => {
    const p = P(c);
    const { locale } = z.object({ locale: z.string() }).parse(await c.req.json());
    if (!isLocale(locale)) return c.json({ error: "unsupported locale" }, 400);
    repo.setUserLocale(p.user.id, locale);
    return c.json({ locale });
  });
  api.post("/me/password", async (c) => {
    const p = P(c);
    if (p.via !== "session") return c.json({ error: "passwords can only be changed from a browser session" }, 403);
    const { password } = z.object({ password: z.string().max(128) }).parse(await c.req.json());
    await auth.setPassword(p, password, getCookie(c, SESSION_COOKIE));
    return c.body(null, 204);
  });
  api.get("/me/export", (c) => c.json(A.exportAccountData(app, P(c))));
  api.post("/account/delete", (c) => {
    if (P(c).via !== "session") return c.json({ error: "account deletion can only be requested from a browser session" }, 403);
    return c.json(A.requestAccountDeletion(app, P(c)), 202);
  });
  api.post("/account/delete/cancel", (c) => {
    A.cancelAccountDeletion(app, P(c));
    return c.body(null, 204);
  });

  api.get("/businesses", (c) => c.json(repo.listBusinesses(P(c).accountId)));
  api.post("/businesses", async (c) => c.json(A.createBusiness(app, P(c), A.BusinessInput.parse(await c.req.json())), 201));
  api.get("/businesses/:id", (c) => c.json(A.getBusiness(app, P(c), id(c))));
  api.patch("/businesses/:id", async (c) => c.json(A.updateBusiness(app, P(c), id(c), A.BusinessPatch.parse(await c.req.json()))));
  api.delete("/businesses/:id", (c) => {
    A.deleteBusiness(app, P(c), id(c));
    return c.body(null, 204);
  });

  api.get("/businesses/:id/competitors", (c) => {
    const p = P(c);
    A.getBusiness(app, p, id(c));
    return c.json(repo.listCompetitors(p.accountId, id(c)).map((comp) => ({ ...comp, pages: repo.listPages(p.accountId, comp.id), suggestions: repo.listSuggestions(p.accountId, comp.id) })));
  });
  api.post("/businesses/:id/competitors", async (c) => c.json(await A.addCompetitor(app, P(c), id(c), A.CompetitorInput.parse(await c.req.json())), 201));
  api.delete("/competitors/:id", (c) => {
    A.removeCompetitor(app, P(c), id(c));
    return c.body(null, 204);
  });
  api.get("/competitors/:id/pages", (c) => {
    A.getCompetitor(app, P(c), id(c));
    return c.json(repo.listPages(P(c).accountId, id(c)));
  });
  api.post("/competitors/:id/pages", async (c) => c.json(A.addPage(app, P(c), id(c), A.PageInput.parse(await c.req.json())), 201));
  api.post("/competitors/:id/discover", async (c) => c.json(await A.discoverForCompetitor(app, P(c), id(c))));
  api.get("/competitors/:id/news", (c) => {
    A.getCompetitor(app, P(c), id(c));
    return c.json(repo.listNews(P(c).accountId, id(c), { limit: Math.min(100, Number(c.req.query("limit") ?? 30)), relevantOnly: c.req.query("all") !== "1" }));
  });
  api.post("/competitors/:id/news/refresh", async (c) => c.json(await A.refreshNews(app, P(c), id(c))));
  api.get("/businesses/:id/news/big", (c) => {
    const p = P(c);
    A.getBusiness(app, p, id(c));
    return c.json(repo.bigNews(p.accountId, id(c), { since: new Date(Date.now() - 30 * 86_400_000).toISOString() }));
  });
  api.post("/competitors/:id/profile", async (c) => {
    const profile = await A.profileCompetitor(app, P(c), id(c));
    return profile ? c.json(profile) : c.json({ error: "profile generation failed" }, 502);
  });
  api.get("/competitors/:id", (c) => {
    const comp = A.getCompetitor(app, P(c), id(c));
    return c.json({ ...comp, profile: comp.profile_json ? JSON.parse(comp.profile_json) : null, profile_json: undefined });
  });
  api.get("/competitors/:id/suggestions", (c) => {
    A.getCompetitor(app, P(c), id(c));
    return c.json(repo.listSuggestions(P(c).accountId, id(c)));
  });
  api.post("/suggestions/:id/accept", (c) => c.json(A.resolveSuggestion(app, P(c), id(c), true), 201));
  api.post("/suggestions/:id/dismiss", (c) => {
    A.resolveSuggestion(app, P(c), id(c), false);
    return c.body(null, 204);
  });

  api.get("/pages/:id", (c) => c.json(A.getPage(app, P(c), id(c))));
  api.delete("/pages/:id", (c) => {
    A.removePage(app, P(c), id(c));
    return c.body(null, 204);
  });
  api.post("/pages/:id/pause", (c) => c.json(A.setPagePaused(app, P(c), id(c), true)));
  api.post("/pages/:id/resume", (c) => c.json(A.setPagePaused(app, P(c), id(c), false)));
  api.post("/pages/:id/scan", async (c) => c.json(await A.scanPage(app, P(c), id(c))));
  api.get("/pages/:id/snapshots", (c) => {
    A.getPage(app, P(c), id(c));
    return c.json(repo.listSnapshots(P(c).accountId, id(c)));
  });
  api.get("/pages/:id/changes", (c) => {
    A.getPage(app, P(c), id(c));
    return c.json(repo.listChanges(P(c).accountId, id(c)));
  });
  api.get("/snapshots/:id", (c) => {
    const s = repo.getSnapshot(P(c).accountId, id(c));
    if (!s) return c.json({ error: "not found" }, 404);
    const { raw_gzip, ...rest } = s;
    const raw = c.req.query("raw") === "1" && raw_gzip ? gunzipSync(raw_gzip).toString("utf8") : undefined;
    return c.json({ ...rest, has_raw: !!raw_gzip, ...(raw !== undefined ? { raw } : {}) });
  });

  api.post("/businesses/:id/scan", async (c) => {
    const results = await A.scanBusiness(app, P(c), id(c));
    return c.json(results.map((r) => ({ page_id: r.page.id, url: r.page.url, ...r.outcome })));
  });
  api.post("/businesses/:id/digest/send", async (c) => {
    const p = P(c);
    const b = A.getBusiness(app, p, id(c));
    return c.json(await app.digests.sendFor(b, p.actor, false, true));
  });

  api.get("/businesses/:id/insights", (c) => {
    const p = P(c);
    A.getBusiness(app, p, id(c));
    const insights = repo.listInsights(p.accountId, id(c), { includeNoise: c.req.query("include_noise") === "1", limit: Math.min(500, Number(c.req.query("limit") ?? 100)) });
    const fb = repo.feedbackForInsights(p.accountId, insights.map((i) => i.id));
    return c.json(insights.map((i) => ({ ...i, feedback: fb[i.id] ?? [] })));
  });
  api.get("/insights/:id", (c) => {
    const p = P(c);
    const i = A.getInsight(app, p, id(c));
    return c.json({ ...i, change: repo.getChange(p.accountId, i.change_id), feedback: repo.feedbackForInsights(p.accountId, [i.id])[i.id] ?? [] });
  });
  api.post("/insights/:id/read", (c) => {
    repo.markInsightRead(P(c).accountId, id(c));
    return c.body(null, 204);
  });
  api.post("/insights/:id/feedback", async (c) => c.json(A.giveFeedback(app, P(c), id(c), A.FeedbackInput.parse(await c.req.json())), 201));
  api.get("/changes/:id", (c) => {
    const ch = repo.getChange(P(c).accountId, id(c));
    return ch ? c.json(ch) : c.json({ error: "change not found" }, 404);
  });
  api.post("/changes/:id/reanalyze", async (c) => {
    const insight = await A.reanalyze(app, P(c), id(c));
    return insight ? c.json(insight) : c.json({ error: "analysis failed" }, 502);
  });

  // Tenant-scoped events: an account can audit what happened to its own data.
  api.get("/events", (c) => {
    const q = c.req.query();
    return c.json(events.list({ accountId: P(c).accountId, ...(q.type ? { type: q.type } : {}), ...(q.since ? { since: q.since } : {}), limit: Math.min(500, Number(q.limit ?? 100)) }));
  });

  // API keys
  api.get("/api-keys", (c) => c.json(repo.listApiKeys(P(c).accountId).map(({ key_hash, ...k }) => k)));
  api.post("/api-keys", async (c) => {
    const p = P(c);
    if (p.via !== "session") return c.json({ error: "API keys can only be created from a browser session" }, 403);
    const { name } = z.object({ name: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/) }).parse(await c.req.json());
    return c.json(auth.createApiKey(p, name), 201);
  });
  api.delete("/api-keys/:id", (c) => (auth.revokeApiKey(P(c), id(c)) ? c.body(null, 204) : c.json({ error: "not found" }, 404)));

  // Admin (operator) API
  api.get("/admin/overview", requireAdmin, (c) => c.json(adminOverview(app)));
  api.get("/admin/events", requireAdmin, (c) => {
    const q = c.req.query();
    return c.json(
      events.list({
        ...(q.type ? { type: q.type } : {}),
        ...(q.result ? { result: q.result as never } : {}),
        ...(q.account_id ? { accountId: Number(q.account_id) } : {}),
        ...(q.since ? { since: q.since } : {}),
        limit: Math.min(1000, Number(q.limit ?? 200)),
      }),
    );
  });
  api.post("/admin/accounts/:id/plan", requireAdmin, async (c) => {
    const { plan, reason } = z.object({ plan: z.string(), reason: z.string().max(500).optional() }).parse(await c.req.json());
    return c.json(await A.setAccountPlan(app, P(c), id(c), plan, reason));
  });

  // Approvals: anyone authenticated may *request*; admins (and later the Manager agent) decide.
  api.get("/approvals/actions", (c) => c.json(Object.values(ACTIONS).map(({ action, risk, description }) => ({ action, risk, description }))));
  api.post("/approvals", async (c) => {
    const p = P(c);
    const body = z.object({ action: z.string(), payload: z.unknown(), reason: z.string().max(2000).optional(), target: z.object({ type: z.string(), id: z.number().int() }).optional() }).parse(await c.req.json());
    const a = app.approvals.request(p, { action: body.action, payload: body.payload, reason: body.reason, accountId: p.accountId, target: body.target as never });
    return c.json({ ...a, summary: app.approvals.describe(a) }, 202);
  });
  api.get("/approvals", (c) => {
    const p = P(c);
    const status = c.req.query("status") as never;
    const rows = p.isAdmin ? app.approvals.list({ ...(status ? { status } : {}) }) : app.approvals.list({ accountId: p.accountId, ...(status ? { status } : {}) });
    return c.json(rows.map((a) => ({ ...a, summary: app.approvals.describe(a) })));
  });
  api.get("/approvals/:id", (c) => {
    const p = P(c);
    const a = app.approvals.get(id(c));
    if (!a || (!p.isAdmin && a.account_id !== p.accountId)) return c.json({ error: "not found" }, 404);
    return c.json({ ...a, summary: app.approvals.describe(a) });
  });
  api.post("/approvals/:id/decide", requireAdmin, async (c) => {
    const { approve, note } = z.object({ approve: z.boolean(), note: z.string().max(2000).optional() }).parse(await c.req.json());
    return c.json(await app.approvals.decide(P(c), id(c), approve, note));
  });
  api.post("/admin/scheduler/tick", requireAdmin, async (c) => c.json({ processed: await app.scheduler.tick() }));

  // Shared memory (admin + agents with admin-owned keys). Devin pulls/pushes through this.
  api.get("/admin/memory", requireAdmin, (c) => {
    const q = c.req.query();
    return c.json(app.memory.list({ ...(q.kind ? { kind: q.kind as never } : {}), ...(q.status ? { status: q.status as never } : {}), ...(q.since_id ? { sinceId: Number(q.since_id) } : {}), limit: Math.min(500, Number(q.limit ?? 100)) }));
  });
  api.get("/admin/memory/search", requireAdmin, (c) => c.json(app.memory.search(c.req.query("q") ?? "", Number(c.req.query("limit") ?? 20))));
  api.post("/admin/memory", requireAdmin, async (c) => {
    const p = P(c);
    const body = z.object({ kind: z.enum(MEMORY_KINDS), title: z.string().min(1).max(200), body: z.string().min(1).max(20_000), tags: z.array(z.string()).max(12).optional(), source: z.string().max(200).optional(), author: z.string().max(64).optional() }).parse(await c.req.json());
    // Agents may declare themselves (e.g. agent:devin); users are always attributed to their own id.
    const author = p.via === "api_key" && body.author && /^agent:[\w.-]+$/.test(body.author) ? body.author : p.actor;
    return c.json(app.memory.add({ author, kind: body.kind, title: body.title, body: body.body, tags: body.tags ?? [], source: body.source ?? null }), 201);
  });
  api.post("/admin/memory/:id/status", requireAdmin, async (c) => {
    const { status } = z.object({ status: z.enum(["open", "done", "superseded"]) }).parse(await c.req.json());
    app.memory.setStatus(id(c), status, P(c).actor);
    return c.body(null, 204);
  });

  // Founder chat (admin only, browser sessions)
  api.post("/admin/founder/conversations", requireAdmin, (c) => c.json(app.founder.createConversation(P(c).user.id), 201));
  api.post("/admin/founder/conversations/:id/messages", requireAdmin, async (c) => {
    const { text } = z.object({ text: z.string().min(1).max(8000) }).parse(await c.req.json());
    try {
      return c.json(await app.founder.send(P(c), id(c), text));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 409);
    }
  });

  // Backups (operator-only)
  api.get("/admin/backups", requireAdmin, (c) => c.json({ offsite: app.backups.offsiteConfigured, local: app.backups.listLocal(), last: events.list({ types: ["backup.completed", "backup.failed"], limit: 5 }) }));
  api.post("/admin/backups/run", requireAdmin, async (c) => c.json(await app.backups.run(P(c).actor)));

  // Agents (operator-only)
  api.get("/admin/agents", requireAdmin, (c) => c.json({ enabled: app.agents.enabled, agents: app.agents.state(), runs: app.agents.runs({ limit: 20 }), cost_24h_usd: app.agents.costSince(new Date(Date.now() - 86_400_000).toISOString()) }));
  api.post("/admin/agents/:name/run", requireAdmin, async (c) => {
    try {
      return c.json(await app.agents.runNow(String(c.req.param("name")), "manual"));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 409);
    }
  });
  api.post("/admin/agents/:name/enabled", requireAdmin, async (c) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(await c.req.json());
    app.agents.setEnabled(String(c.req.param("name")), enabled, P(c).actor);
    return c.json({ ok: true });
  });
  api.get("/admin/agents/notes", requireAdmin, (c) => c.json(app.agents.notes({ unreadOnly: c.req.query("unread") === "1", limit: Number(c.req.query("limit") ?? 50) })));
  api.post("/admin/agents/notes/:id/read", requireAdmin, (c) => {
    app.agents.markNoteRead(id(c));
    return c.body(null, 204);
  });
  api.post("/admin/digests/run", requireAdmin, async (c) => c.json({ sent: await app.digests.runDue() }));

  web.route("/api", api);

  // ---------------- HTML UI ----------------
  const ui = new Hono<Env>({ strict: false });
  ui.use("*", requireAuth);
  const back = (c: Ctx, path: string, flash?: string) => c.redirect(flash ? `${path}${path.includes("?") ? "&" : "?"}flash=${encodeURIComponent(flash)}` : path);
  const tryUi = async (c: Ctx, path: string, fn: () => Promise<string | void> | string | void) => {
    try {
      const msg = await fn();
      return back(c, path, msg ?? undefined);
    } catch (err) {
      return back(c, path, messageOf(err));
    }
  };

  ui.post("/b", async (c) => {
    const b = A.createBusiness(app, P(c), A.BusinessInput.parse(await bodyOf(c)));
    return c.redirect(`/b/${b.id}`);
  });
  ui.get("/b/:id", (c) => {
    const p = P(c);
    const business = A.getBusiness(app, p, id(c));
    const competitors = repo.listCompetitors(p.accountId, business.id).map((competitor) => ({ competitor, pages: repo.listPages(p.accountId, competitor.id), suggestions: repo.listSuggestions(p.accountId, competitor.id), news: repo.listNews(p.accountId, competitor.id, { limit: 15 }) }));
    const includeNoise = c.req.query("noise") === "1";
    const insights = repo.listInsights(p.accountId, business.id, { includeNoise });
    const feedback = repo.feedbackForInsights(p.accountId, insights.map((i) => i.id));
    const competitorNames = Object.fromEntries(competitors.map(({ competitor }) => [competitor.id, competitor.name]));
    const bigNews = repo.bigNews(p.accountId, business.id, { since: new Date(Date.now() - 30 * 86_400_000).toISOString() });
    const requested = c.req.query("tab");
    const tab = (BUSINESS_TABS as readonly string[]).includes(requested ?? "") ? (requested as BusinessTab) : "overview";
    return c.html(<BusinessPage t={T(c)} principal={p} business={business} account={repo.getAccount(p.accountId)!} competitors={competitors} bigNews={bigNews} insights={insights} feedback={feedback} competitorNames={competitorNames} includeNoise={includeNoise} tab={tab} landscape={repo.getLandscape(p.accountId, business.id) ?? null} flash={c.req.query("flash")} />);
  });
  ui.post("/b/:id/landscape", async (c) => {
    const bid = id(c);
    const t = T(c);
    return tryUi(c, `/b/${bid}?tab=landscape`, async () => {
      await A.generateLandscapeDoc(app, P(c), bid);
      return t("flash.landscape.done");
    });
  });
  /** Word (.doc) download and a printable page the browser can save as PDF. */
  ui.get("/b/:id/landscape.doc", (c) => {
    const p = P(c);
    const { business, landscape, doc } = A.landscapeForExport(app, p, id(c));
    const html = renderLandscapeDocument({ t: T(c), business, landscape, doc, lang: localeOf(c) });
    c.header("content-type", "application/msword; charset=utf-8");
    c.header("content-disposition", contentDisposition(landscapeFilename(business.name, "doc")));
    return c.body(html);
  });
  ui.get("/b/:id/landscape/print", (c) => {
    const p = P(c);
    const { business, landscape, doc } = A.landscapeForExport(app, p, id(c));
    return c.html(renderLandscapeDocument({ t: T(c), business, landscape, doc, print: true, lang: localeOf(c) }));
  });
  ui.post("/b/:id/competitors", async (c) => {
    const bid = id(c);
    return tryUi(c, `/b/${bid}`, async () => {
      const form = await bodyOf(c);
      const r = await A.addCompetitor(app, P(c), bid, A.CompetitorInput.parse({ name: form.name, website: form.website }));
      return r.suggestions.length ? T(c)("flash.comp.added.sugg", { name: r.competitor.name, n: r.suggestions.length }) : T(c)("flash.comp.added", { name: r.competitor.name });
    });
  });
  ui.post("/b/:id/scan", async (c) => {
    const bid = id(c);
    return tryUi(c, `/b/${bid}`, async () => {
      const results = await A.scanBusiness(app, P(c), bid);
      return T(c)("flash.scan.done", { n: results.length, summary: summarise(T(c), results.map((r) => r.outcome.status)) });
    });
  });
  ui.post("/b/:id/digest", async (c) => {
    const bid = id(c);
    return tryUi(c, `/b/${bid}`, async () => {
      const form = await bodyOf(c);
      A.updateBusiness(app, P(c), bid, { digest_enabled: form.enabled === "1" });
    });
  });
  ui.post("/b/:id/digest/send", async (c) => {
    const bid = id(c);
    return tryUi(c, `/b/${bid}`, async () => {
      const p = P(c);
      const r = await app.digests.sendFor(A.getBusiness(app, p, bid), p.actor, false, true);
      return r.sent ? T(c)("flash.digest.sent", { n: r.recipients, insights: r.insightCount }) : T(c)("flash.digest.failed");
    });
  });
  ui.post("/competitors/:id/pages", async (c) => {
    const competitor = A.getCompetitor(app, P(c), id(c));
    return tryUi(c, `/b/${competitor.business_id}`, async () => {
      A.addPage(app, P(c), competitor.id, A.PageInput.parse(await bodyOf(c)));
    });
  });
  ui.post("/competitors/:id/discover", async (c) => {
    const competitor = A.getCompetitor(app, P(c), id(c));
    return tryUi(c, `/b/${competitor.business_id}`, async () => {
      const s = await A.discoverForCompetitor(app, P(c), competitor.id);
      return s.length ? T(c)("flash.discover.found", { n: s.length }) : T(c)("flash.discover.none");
    });
  });
  ui.post("/competitors/:id/news", async (c) => {
    const competitor = A.getCompetitor(app, P(c), id(c));
    return tryUi(c, `/b/${competitor.business_id}`, async () => {
      const r = await A.refreshNews(app, P(c), competitor.id);
      return r.error ? T(c)("flash.news.failed", { error: r.error }) : T(c)("flash.news.done", { fetched: r.fetched, added: r.added, big: r.big.length });
    });
  });
  ui.post("/competitors/:id/profile", async (c) => {
    const competitor = A.getCompetitor(app, P(c), id(c));
    return tryUi(c, `/b/${competitor.business_id}`, async () => {
      await A.profileCompetitor(app, P(c), competitor.id);
    });
  });
  ui.post("/competitors/:id/delete", (c) => {
    const competitor = A.getCompetitor(app, P(c), id(c));
    A.removeCompetitor(app, P(c), competitor.id);
    return c.redirect(`/b/${competitor.business_id}`);
  });
  ui.post("/suggestions/:id/:verb", (c) => {
    const p = P(c);
    const s = repo.getSuggestion(p.accountId, id(c));
    if (!s) return c.notFound();
    const competitor = A.getCompetitor(app, p, s.competitor_id);
    return tryUi(c, `/b/${competitor.business_id}`, () => {
      A.resolveSuggestion(app, p, s.id, c.req.param("verb") === "accept");
    });
  });
  ui.post("/pages/:id/:verb", async (c) => {
    const p = P(c);
    const page = A.getPage(app, p, id(c));
    const competitor = A.getCompetitor(app, p, page.competitor_id);
    const verb = c.req.param("verb");
    return tryUi(c, `/b/${competitor.business_id}`, async () => {
      if (verb === "scan") {
        const o = await A.scanPage(app, p, page.id);
        return T(c)("flash.scan.page", { status: `${T(c)(`out.${o.status}` as MessageKey)}${"message" in o ? ` (${o.message})` : ""}${"confirmAfter" in o ? ` — ${o.confirmAfter.slice(0, 16)} UTC` : ""}` });
      }
      if (verb === "pause") A.setPagePaused(app, p, page.id, true);
      else if (verb === "resume") A.setPagePaused(app, p, page.id, false);
      else if (verb === "delete") A.removePage(app, p, page.id);
      else throw new A.ActionError(404, "unknown action");
    });
  });
  ui.get("/pages/:id", (c) => {
    const p = P(c);
    const page = A.getPage(app, p, id(c));
    const competitor = A.getCompetitor(app, p, page.competitor_id);
    const latest = repo.latestSnapshot(page.id);
    return c.html(<PageDetailPage t={T(c)} principal={p} page={page} competitor={competitor} snapshots={repo.listSnapshots(p.accountId, page.id)} changes={repo.listChanges(p.accountId, page.id)} latestText={latest?.text ?? null} />);
  });
  ui.get("/insights/:id", (c) => {
    const p = P(c);
    const insight = A.getInsight(app, p, id(c));
    const change = repo.getChange(p.accountId, insight.change_id);
    const page = change ? repo.getPage(p.accountId, change.page_id) : undefined;
    const competitor = page ? repo.getCompetitor(p.accountId, page.competitor_id) : undefined;
    const business = competitor ? repo.getBusiness(p.accountId, competitor.business_id) : undefined;
    if (!change || !page || !competitor || !business) return c.notFound();
    repo.markInsightRead(p.accountId, insight.id);
    return c.html(<InsightDetailPage t={T(c)} principal={p} insight={insight} change={change} page={page} competitor={competitor} business={business} feedback={repo.feedbackForInsights(p.accountId, [insight.id])[insight.id] ?? []} />);
  });
  ui.post("/insights/:id/feedback", async (c) => {
    const p = P(c);
    const insight = A.getInsight(app, p, id(c));
    return tryUi(c, `/b/${insight.business_id}`, async () => {
      A.giveFeedback(app, p, insight.id, A.FeedbackInput.parse(await bodyOf(c)));
      return "Thanks — feedback recorded.";
    });
  });
  ui.post("/insights/:id/reanalyze", async (c) => {
    const p = P(c);
    const insight = A.getInsight(app, p, id(c));
    const fresh = await A.reanalyze(app, p, insight.change_id);
    return c.redirect(fresh ? `/insights/${fresh.id}` : `/b/${insight.business_id}?flash=analysis+failed`);
  });

  ui.get("/settings", (c) => {
    const p = P(c);
    return c.html(<SettingsPage t={T(c)} principal={p} account={repo.getAccount(p.accountId)!} users={repo.listUsers(p.accountId)} keys={repo.listApiKeys(p.accountId)} flash={c.req.query("flash")} />);
  });
  ui.post("/settings/api-keys", async (c) => {
    const p = P(c);
    const form = await bodyOf(c);
    const name = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).parse(form.name);
    const { key } = auth.createApiKey(p, name);
    return c.html(<SettingsPage t={T(c)} principal={p} account={repo.getAccount(p.accountId)!} users={repo.listUsers(p.accountId)} keys={repo.listApiKeys(p.accountId)} newKey={key} />);
  });
  ui.post("/settings/api-keys/:id/revoke", (c) => {
    auth.revokeApiKey(P(c), id(c));
    return c.redirect("/settings");
  });
  ui.post("/settings/language", async (c) => {
    const form = await bodyOf(c);
    if (isLocale(form.lang)) {
      repo.setUserLocale(P(c).user.id, form.lang);
      setCookie(c, LANG_COOKIE, form.lang, { httpOnly: true, sameSite: "Lax", secure, path: "/", maxAge: 365 * 86_400 });
    }
    return c.redirect("/settings");
  });
  ui.post("/settings/password", async (c) =>
    tryUi(c, "/settings", async () => {
      const form = await bodyOf(c);
      await auth.setPassword(P(c), String(form.password ?? ""), getCookie(c, SESSION_COOKIE));
      return "Password saved. Other sessions have been signed out.";
    }),
  );
  ui.post("/settings/password/remove", (c) =>
    tryUi(c, "/settings", () => {
      auth.removePassword(P(c));
      return "Password removed. You can still sign in with an email link.";
    }),
  );
  ui.get("/settings/export", (c) => {
    const data = A.exportAccountData(app, P(c));
    c.header("content-disposition", `attachment; filename="rivalwatch-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json(data);
  });
  ui.post("/settings/delete", async (c) =>
    tryUi(c, "/settings", async () => {
      const form = await bodyOf(c);
      if (form.confirm !== "1") throw new A.ActionError(400, "Please tick the confirmation box.");
      const r = A.requestAccountDeletion(app, P(c));
      return `Deletion scheduled for ${r.delete_after.slice(0, 16).replace("T", " ")} UTC. You can cancel until then.`;
    }),
  );
  ui.post("/settings/delete/cancel", (c) =>
    tryUi(c, "/settings", () => {
      A.cancelAccountDeletion(app, P(c));
      return "Deletion cancelled. Remember to resume any paused pages.";
    }),
  );

  ui.get("/admin", requireAdmin, (c) => c.html(<AdminPage principal={P(c)} o={adminOverview(app)} flash={c.req.query("flash")} />));

  // Founder assistant
  const founderPage = (c: Ctx, convId: number | null) => {
    const p = P(c);
    const conversations = app.founder.listConversations(p.user.id);
    const current = convId ? (app.founder.getConversation(p.user.id, convId) ?? null) : (conversations[0] ?? null);
    return c.html(<FounderPage principal={p} conversations={conversations} current={current} messages={current ? app.founder.messages(current.id) : []} memory={app.memory.list({ limit: 25 })} available={app.founder.available} model={app.founder.model} flash={c.req.query("flash")} />);
  };
  ui.get("/admin/founder", requireAdmin, (c) => founderPage(c, null));
  ui.get("/admin/founder/:id", requireAdmin, (c) => founderPage(c, id(c)));
  ui.post("/admin/founder/new", requireAdmin, (c) => c.redirect(`/admin/founder/${app.founder.createConversation(P(c).user.id).id}`));
  ui.post("/admin/founder/:id/send", requireAdmin, async (c) => {
    const cid = id(c);
    const form = await bodyOf(c);
    const text = String(form.text ?? "").slice(0, 8000);
    const p = P(c);
    // Progressive enhancement: the page's JS asks for an event stream and renders it live; plain forms get a redirect.
    if (c.req.header("accept")?.includes("text/event-stream")) {
      return streamSSE(c, async (stream) => {
        let seq = 0;
        let chain = Promise.resolve();
        // Writes are serialised and awaited before the stream closes, so the final event is never dropped.
        const push = (ev: unknown) => (chain = chain.then(() => stream.writeSSE({ data: JSON.stringify(ev), id: String(++seq) })));
        try {
          await app.founder.send(p, cid, text, (ev) => {
            if (ev.type === "done") push({ type: "done", html: renderMarkdown(ev.message.content), cost: ev.message.estimated_cost_usd, tool_calls: ev.message.tool_calls });
            else push(ev);
          });
        } catch (err) {
          push({ type: "error", message: (err as Error).message });
        }
        await chain;
      });
    }
    try {
      await app.founder.send(p, cid, text);
      return c.redirect(`/admin/founder/${cid}`);
    } catch (err) {
      return c.redirect(`/admin/founder/${cid}?flash=${encodeURIComponent((err as Error).message)}`);
    }
  });
  ui.post("/admin/memory", requireAdmin, async (c) => {
    const form = await bodyOf(c);
    const parsed = z.object({ kind: z.enum(MEMORY_KINDS), title: z.string().min(1).max(200), body: z.string().min(1).max(20_000) }).safeParse(form);
    if (parsed.success) app.memory.add({ author: P(c).actor, ...parsed.data, source: "admin-ui" });
    return c.redirect("/admin/founder");
  });
  ui.post("/admin/memory/:id/status", requireAdmin, async (c) => {
    const form = await bodyOf(c);
    const status = z.enum(["open", "done", "superseded"]).safeParse(form.status);
    if (status.success) app.memory.setStatus(id(c), status.data, P(c).actor);
    return c.redirect("/admin/founder");
  });
  ui.post("/admin/accounts/:id/plan", requireAdmin, async (c) => {
    const aid = id(c);
    return tryUi(c, "/admin", async () => {
      const form = await bodyOf(c);
      const r = await A.setAccountPlan(app, P(c), aid, String(form.plan), form.reason ? String(form.reason) : undefined);
      return `Account #${r.account_id} is now on the ${PLANS[r.plan]!.name} plan (approval #${r.approval_id}).`;
    });
  });
  ui.post("/admin/agents/:name/:verb", requireAdmin, async (c) => {
    const name = String(c.req.param("name"));
    const verb = String(c.req.param("verb"));
    return tryUi(c, "/admin", async () => {
      if (verb === "run") {
        const r = await app.agents.runNow(name, "manual");
        return `${name} run #${r.id} ${r.status}: ${r.summary ?? r.error ?? ""} (cost $${r.estimated_cost_usd.toFixed(4)})`;
      }
      app.agents.setEnabled(name, verb === "enable", P(c).actor);
    });
  });
  ui.post("/admin/backups/run", requireAdmin, async (c) =>
    tryUi(c, "/admin", async () => {
      const r = await app.backups.run(P(c).actor);
      return r.ok ? `Backup written (${(r.bytes / 1024).toFixed(0)} KB)${r.uploaded ? " and uploaded off-site" : " locally only"}.` : `Backup failed: ${r.error}`;
    }),
  );
  ui.post("/admin/notes/:id/read", requireAdmin, (c) => {
    app.agents.markNoteRead(id(c));
    return c.redirect("/admin");
  });
  ui.post("/admin/approvals/:id/:verb", requireAdmin, async (c) => {
    const aid = id(c);
    const approve = c.req.param("verb") === "approve";
    return tryUi(c, "/admin", async () => {
      const form = await bodyOf(c);
      const a = await app.approvals.decide(P(c), aid, approve, form.note ? String(form.note) : undefined);
      return `Approval #${a.id} ${a.status}${a.status === "failed" ? `: ${a.result}` : ""}.`;
    });
  });

  web.route("/", ui);
  return web;
}

async function bodyOf(c: Ctx): Promise<Record<string, unknown>> {
  if (isJson(c)) return (await c.req.json()) as Record<string, unknown>;
  const body = await c.req.parseBody();
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== "" && v !== undefined));
}

function isJson(c: Ctx): boolean {
  return (c.req.header("content-type") ?? "").includes("application/json");
}

function messageOf(err: unknown): string {
  if (err instanceof z.ZodError) return err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  return err instanceof Error ? err.message : String(err);
}

/** RFC 5987: business names carry non-ASCII, so send an ASCII fallback plus the real name. */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** "2 no change, 1 could not be fetched" - never the raw pipeline enum. */
function summarise(t: Translate, statuses: string[]): string {
  const counts = new Map<string, number>();
  for (const s of statuses) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts].map(([k, v]) => `${v} ${t(`out.${k}` as MessageKey)}`).join(", ") || t("out.nothing");
}
