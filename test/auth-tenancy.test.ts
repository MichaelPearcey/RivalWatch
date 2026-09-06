import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixture, html, json, login, testApp } from "./helpers.js";

describe("magic-link auth", () => {
  let t: ReturnType<typeof testApp>;
  beforeEach(() => (t = testApp()));
  afterEach(() => t.app.close());

  it("creates an account on first sign-in and records signup events", async () => {
    const s = await login(t.web, "New.User@Example.com");
    const me = await json<{ user: { email: string; is_admin: boolean }; account: { plan: string }; actor: string; via: string }>(t.web, "/api/me", { session: s });
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("new.user@example.com");
    expect(me.body.user.is_admin).toBe(false);
    expect(me.body.account.plan).toBe("free");
    expect(me.body.via).toBe("session");
    const types = t.app.events.list({ limit: 50 }).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["user.login_requested", "email.sent", "account.created", "user.signup", "user.login"]));
    expect(t.app.repo.listEmails()[0]!.kind).toBe("magic_link");
  });

  it("sign-in links are single use and expire", async () => {
    const req = await json<{ dev_link: string }>(t.web, "/auth/login", { method: "POST", body: JSON.stringify({ email: "a@b.co" }) });
    const first = await t.web.request(req.body.dev_link);
    expect(first.status).toBe(302);
    const second = await t.web.request(req.body.dev_link, { headers: { accept: "text/html" } });
    expect(second.status).toBe(401);
    expect(t.app.events.list({ type: "user.login_failed" })).toHaveLength(1);
  });

  it("shows email delivery failures to the user instead of pretending the link was sent", async () => {
    t.app.close();
    const failingResend = (async () => new Response(JSON.stringify({ name: "validation_error", message: "You can only send testing emails to your own email address" }), { status: 403 })) as unknown as typeof fetch;
    t = testApp({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test" }, { fetchImpl: failingResend });
    const res = await json<{ sent: boolean; error: string }>(t.web, "/auth/login", { method: "POST", body: JSON.stringify({ email: "x@y.co" }) });
    expect(res.status).toBe(502);
    expect(res.body.sent).toBe(false);
    expect(res.body.error).toContain("own email address");
    const page = await t.web.request(`${t.base}/auth/login`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "email=x%40y.co" });
    expect(page.status).toBe(502);
    expect(await page.text()).toContain("Email provider said");
    expect(t.app.events.list({ type: "email.failed" })).toHaveLength(2);
  });

  it("rate limits login requests per email", async () => {
    for (let i = 0; i < 5; i++) expect((await json(t.web, "/auth/login", { method: "POST", body: JSON.stringify({ email: "spam@b.co" }) })).status).toBe(200);
    const sixth = await json(t.web, "/auth/login", { method: "POST", body: JSON.stringify({ email: "spam@b.co" }) });
    expect(sixth.status).toBe(429);
  });

  it("unauthenticated requests are rejected (API 401, UI redirect); the root shows the public landing page", async () => {
    expect((await json(t.web, "/api/businesses")).status).toBe(401);
    const ui = await html(t.web, "/settings");
    expect(ui.status).toBe(302);
    expect(ui.location).toContain("/login?next=%2Fsettings");
    const landing = await html(t.web, "/");
    expect(landing.status).toBe(200);
    expect(landing.text).toContain("Know the moment your");
    expect(landing.text).toContain("rwToggleTheme");
    expect(landing.text).not.toMatch(/https?:\/\/(fonts|cdn|www\.googletagmanager)/); // no third-party assets
    // The stylesheet must reach the browser unescaped (JSX would otherwise turn quotes into &quot; inside <style>).
    expect(landing.text).toContain('@font-face{font-family:"Plus Jakarta Sans"');
    expect(landing.text).not.toContain("&quot;Plus Jakarta Sans&quot;");
    const font = await t.web.request(`${t.base}/static/fonts/plus-jakarta-sans-latin.woff2`);
    expect(font.status).toBe(200);
    expect(font.headers.get("content-type")).toBe("font/woff2");
    expect(font.headers.get("cache-control")).toContain("immutable");
    expect((await t.web.request(`${t.base}/static/fonts/..%2F..%2Fpackage.json`)).status).toBe(404);
    expect((await t.web.request(`${t.base}/static/fonts/nope.woff2`)).status).toBe(404);
    for (const path of ["/pricing", "/privacy", "/terms", "/bot"]) expect((await html(t.web, path)).status, path).toBe(200);
    expect((await html(t.web, "/privacy")).text).toContain("Privacy Policy");
  });

  it("admins are recognised from ADMIN_EMAILS; others cannot reach admin endpoints", async () => {
    const admin = await login(t.web, "admin@rivalwatch.test");
    const user = await login(t.web, "user@rivalwatch.test");
    expect((await json(t.web, "/api/admin/overview", { session: admin })).status).toBe(200);
    expect((await json(t.web, "/api/admin/overview", { session: user })).status).toBe(403);
    expect((await html(t.web, "/admin", user)).status).toBe(403);
    expect((await html(t.web, "/admin", admin)).status).toBe(200);
  });

  it("bootstrap sign-in works once for an admin email when BOOTSTRAP_ADMIN_TOKEN is set", async () => {
    t.app.close();
    t = testApp({ BOOTSTRAP_ADMIN_TOKEN: "correct-horse-battery-staple" });
    const url = (token: string, email: string) => `${t.base}/auth/bootstrap?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    // wrong token / non-admin email are rejected
    expect((await t.web.request(url("wrong-token-wrong-token", "admin@rivalwatch.test"))).status).toBe(403);
    expect((await t.web.request(url("correct-horse-battery-staple", "someone@else.test"))).status).toBe(403);
    // correct -> session cookie, admin
    const ok = await t.web.request(url("correct-horse-battery-staple", "admin@rivalwatch.test"));
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("/admin");
    const cookie = (ok.headers.get("set-cookie") ?? "").split(";")[0]!;
    const me = await json<{ user: { is_admin: boolean } }>(t.web, "/api/me", { session: { cookie, email: "admin@rivalwatch.test" } });
    expect(me.body.user.is_admin).toBe(true);
    // the same token value cannot be used twice...
    const reused = await t.web.request(url("correct-horse-battery-staple", "admin@rivalwatch.test"), { headers: { accept: "text/html" } });
    expect(reused.status).toBe(403);
    expect(await reused.text()).toContain("set a new BOOTSTRAP_ADMIN_TOKEN");
    const audit = t.app.events.list({ type: "agent.action" })[0]!;
    expect(audit).toMatchObject({ risk_level: "high", requested_by: "operator", approved_by: "env:BOOTSTRAP_ADMIN_TOKEN" });
    // ...but the operator can set a new value and sign in again (e.g. lost session, email down).
    t.app.cfg.BOOTSTRAP_ADMIN_TOKEN = "a-brand-new-token-value";
    expect((await t.web.request(url("a-brand-new-token-value", "admin@rivalwatch.test"))).status).toBe(302);
    expect((await t.web.request(url("a-brand-new-token-value", "admin@rivalwatch.test"))).status).toBe(403);
  });

  it("bootstrap is unavailable when the variable is not set", async () => {
    expect((await t.web.request(`${t.base}/auth/bootstrap?token=x&email=admin@rivalwatch.test`)).status).toBe(403);
  });

  it("logout invalidates the session", async () => {
    const s = await login(t.web, "x@y.co");
    await t.web.request(`${t.base}/auth/logout`, { method: "POST", headers: { cookie: s.cookie } });
    expect((await json(t.web, "/api/me", { session: s })).status).toBe(401);
  });

  it("API keys authenticate as agents and are attributed in the audit log", async () => {
    const s = await login(t.web, "owner@y.co");
    const created = await json<{ key: string; prefix: string }>(t.web, "/api/api-keys", { method: "POST", session: s, body: JSON.stringify({ name: "support-agent" }) });
    expect(created.status).toBe(201);
    expect(created.body.key.startsWith("rw_")).toBe(true);
    const me = await json<{ actor: string; via: string }>(t.web, "/api/me", { bearer: created.body.key });
    expect(me.body).toMatchObject({ actor: "agent:support-agent", via: "api_key" });
    const b = await json<{ id: number }>(t.web, "/api/businesses", { method: "POST", bearer: created.body.key, body: JSON.stringify({ name: "Via agent" }) });
    expect(b.status).toBe(201);
    expect(t.app.events.list({ type: "business.created" })[0]!.actor).toBe("agent:support-agent");
    // Agents may not mint further keys.
    expect((await json(t.web, "/api/api-keys", { method: "POST", bearer: created.body.key, body: JSON.stringify({ name: "escalate" }) })).status).toBe(403);
    const keys = await json<{ id: number }[]>(t.web, "/api/api-keys", { session: s });
    await json(t.web, `/api/api-keys/${keys.body[0]!.id}`, { method: "DELETE", session: s });
    expect((await json(t.web, "/api/me", { bearer: created.body.key })).status).toBe(401);
  });
});

describe("tenant isolation", () => {
  let t: ReturnType<typeof testApp>;
  beforeEach(() => (t = testApp()));
  afterEach(() => t.app.close());

  it("one account cannot see or touch another account's data", async () => {
    const a = await fixture(t, "alice@a.co");
    await a.scan();
    await a.setDemo({ proPrice: 61 });
    await a.scan();
    await a.scan();
    const aliceInsight = (await a.insights()).body[0]!;
    const bob = await login(t.web, "bob@b.co");

    expect((await json(t.web, "/api/businesses", { session: bob })).body).toEqual([]);
    expect((await json(t.web, `/api/businesses/${a.business.id}`, { session: bob })).status).toBe(404);
    expect((await json(t.web, `/api/businesses/${a.business.id}/insights`, { session: bob })).status).toBe(404);
    expect((await json(t.web, `/api/insights/${aliceInsight.id}`, { session: bob })).status).toBe(404);
    expect((await json(t.web, `/api/pages/${a.pages[0]!.id}`, { session: bob })).status).toBe(404);
    expect((await json(t.web, `/api/pages/${a.pages[0]!.id}/scan`, { method: "POST", session: bob })).status).toBe(404);
    expect((await json(t.web, `/api/competitors/${a.competitor.id}`, { method: "DELETE", session: bob })).status).toBe(404);
    expect((await json(t.web, `/api/competitors/${a.competitor.id}/pages`, { method: "POST", session: bob, body: JSON.stringify({ url: "https://x.example/" }) })).status).toBe(404);
    expect((await json(t.web, `/api/insights/${aliceInsight.id}/feedback`, { method: "POST", session: bob, body: JSON.stringify({ verdict: "useful" }) })).status).toBe(404);
    expect((await json(t.web, `/api/changes/${aliceInsight.change_id}/reanalyze`, { method: "POST", session: bob })).status).toBe(404);
    expect((await html(t.web, `/b/${a.business.id}`, bob)).status).toBe(404);
    expect((await html(t.web, `/insights/${aliceInsight.id}`, bob)).status).toBe(404);

    // Bob's event feed contains only his own events.
    const bobEvents = (await json<{ account_id: number }[]>(t.web, "/api/events?limit=500", { session: bob })).body;
    const bobAccount = t.app.repo.getUserByEmail("bob@b.co")!.account_id;
    expect(bobEvents.length).toBeGreaterThan(0);
    expect(bobEvents.every((e) => e.account_id === bobAccount)).toBe(true);

    // Every stored row carries the owning account id.
    const acct = t.app.repo.getUserByEmail("alice@a.co")!.account_id;
    for (const table of ["businesses", "competitors", "monitored_pages", "snapshots", "changes", "insights"]) {
      const bad = t.app.repo.count(`SELECT COUNT(*) c FROM ${table} WHERE account_id IS NULL OR account_id != ?`, acct);
      expect(bad, `${table} has rows outside alice's account`).toBe(0);
    }
  });

  it("admins can change an account's plan; it is audited as a high-risk approved action", async () => {
    const admin = await login(t.web, "admin@rivalwatch.test");
    const user = await login(t.web, "cust@a.co");
    const acct = t.app.repo.getUserByEmail("cust@a.co")!.account_id;
    expect((await json(t.web, `/api/admin/accounts/${acct}/plan`, { method: "POST", session: user, body: JSON.stringify({ plan: "plus" }) })).status).toBe(403);
    expect((await json(t.web, `/api/admin/accounts/${acct}/plan`, { method: "POST", session: admin, body: JSON.stringify({ plan: "gold" }) })).status).toBe(400);
    const ok = await json<{ plan: string }>(t.web, `/api/admin/accounts/${acct}/plan`, { method: "POST", session: admin, body: JSON.stringify({ plan: "plus", reason: "beta tester" }) });
    expect(ok.status).toBe(200);
    expect(t.app.repo.getAccount(acct)!.plan).toBe("plus");
    const ev = t.app.events.list({ type: "account.plan_changed" })[0]!;
    expect(ev).toMatchObject({ risk_level: "high", result: "ok", account_id: acct });
    expect(ev.approved_by).toMatch(/^user:\d+$/);
    expect(JSON.parse(ev.payload)).toMatchObject({ from: "free", to: "plus", reason: "beta tester" });
    expect((await json<{ account: { plan: string } }>(t.web, "/api/me", { session: user })).body.account.plan).toBe("plus");
  });

  it("plan limits are enforced per account from plan data", async () => {
    const s = await login(t.web, "free@a.co");
    const b = (await json<{ id: number }>(t.web, "/api/businesses", { method: "POST", session: s, body: JSON.stringify({ name: "Tiny" }) })).body;
    const add = (n: number) => json<{ error?: string }>(t.web, `/api/businesses/${b.id}/competitors`, { method: "POST", session: s, body: JSON.stringify({ name: `C${n}`, website: `${t.base}/demo/`, discover: false, pages: [{ url: `${t.base}/demo/?c=${n}`, kind: "home" }] }) });
    expect((await add(1)).status).toBe(201);
    expect((await add(2)).status).toBe(201);
    const third = await add(3);
    expect(third.status).toBe(402);
    expect(third.body.error).toMatch(/allows 2 competitors/);
  });
});
