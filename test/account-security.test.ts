import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkPasswordPolicy, hashPassword, needsRehash, verifyPassword } from "../src/password.js";
import { renderMarkdown } from "../src/web/md.js";
import { fixture, html, json, login, testApp } from "./helpers.js";

describe("password hashing", () => {
  it("hashes with scrypt, verifies, rejects wrong passwords, and is self-describing", async () => {
    const h = await hashPassword("correct horse battery staple");
    expect(h.startsWith("scrypt$32768$8$3$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", h)).toBe(true);
    expect(await verifyPassword("Correct horse battery staple", h)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
    expect(needsRehash(h)).toBe(false);
    expect(needsRehash("scrypt$16384$8$1$AAAA$BBBB")).toBe(true);
  });

  it("policy: length-based, no composition rules, blocks trivial and email-derived passwords", () => {
    expect(checkPasswordPolicy("short").ok).toBe(false);
    expect(checkPasswordPolicy("aaaaaaaaaaaaaa").ok).toBe(false);
    expect(checkPasswordPolicy("password1234").ok).toBe(false);
    expect(checkPasswordPolicy("michael-is-great-2026", "michael@x.com").ok).toBe(false);
    expect(checkPasswordPolicy("my dog eats socks on tuesdays").ok).toBe(true);
  });
});

describe("password sign-in", () => {
  let t: ReturnType<typeof testApp>;
  beforeEach(() => (t = testApp()));
  afterEach(() => t.app.close());

  it("set a password in settings, sign in with it, lock out after repeated failures, remove it", async () => {
    const s = await login(t.web, "pw@a.co");
    const weak = await json<{ error: string }>(t.web, "/api/me/password", { method: "POST", session: s, body: JSON.stringify({ password: "short" }) });
    expect(weak.status).toBe(400);
    expect(weak.body.error).toContain("12 characters");
    expect((await json(t.web, "/api/me/password", { method: "POST", session: s, body: JSON.stringify({ password: "a long and boring passphrase" }) })).status).toBe(204);
    expect(t.app.events.list({ type: "user.password_set" })).toHaveLength(1);

    // Sign in with the password from a fresh client (form post).
    const ok = await t.web.request(`${t.base}/auth/password`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "email=pw%40a.co&password=a+long+and+boring+passphrase&next=%2Fsettings" });
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("/settings");
    const cookie = (ok.headers.get("set-cookie") ?? "").split(";")[0]!;
    expect((await json<{ user: { has_password: boolean } }>(t.web, "/api/me", { session: { cookie, email: "pw@a.co" } })).body.user.has_password).toBe(true);

    // Wrong password: generic message, same for unknown users.
    const bad = await json<{ error: string }>(t.web, "/auth/password", { method: "POST", body: JSON.stringify({ email: "pw@a.co", password: "nope nope nope nope" }) });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe("Incorrect email or password.");
    const ghost = await json<{ error: string }>(t.web, "/auth/password", { method: "POST", body: JSON.stringify({ email: "ghost@a.co", password: "nope nope nope nope" }) });
    expect(ghost.status).toBe(401);
    expect(ghost.body.error).toBe(bad.body.error);

    // Lockout after 10 failures, even with the right password.
    for (let i = 0; i < 9; i++) await json(t.web, "/auth/password", { method: "POST", body: JSON.stringify({ email: "pw@a.co", password: "wrong wrong wrong wrong" }) });
    const locked = await json<{ error: string }>(t.web, "/auth/password", { method: "POST", body: JSON.stringify({ email: "pw@a.co", password: "a long and boring passphrase" }) });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toContain("15 minutes");
    // A magic-link login clears the lock (it proves control of the mailbox).
    const s2 = await login(t.web, "pw@a.co");
    expect(t.app.repo.getUserByEmail("pw@a.co")!.failed_logins).toBe(0);

    // Remove the password.
    const rm = await t.web.request(`${t.base}/settings/password/remove`, { method: "POST", headers: { cookie: s2.cookie } });
    expect(rm.status).toBe(302);
    expect(t.app.repo.getUserByEmail("pw@a.co")!.password_hash).toBeNull();
    expect((await json(t.web, "/auth/password", { method: "POST", body: JSON.stringify({ email: "pw@a.co", password: "a long and boring passphrase" }) })).status).toBe(401);
  }, 30_000);

  it("changing the password signs out other sessions but keeps the current one", async () => {
    const a = await login(t.web, "multi@a.co");
    const b = await login(t.web, "multi@a.co");
    expect((await json(t.web, "/api/me/password", { method: "POST", session: a, body: JSON.stringify({ password: "a completely new passphrase" }) })).status).toBe(204);
    expect((await json(t.web, "/api/me", { session: a })).status).toBe(200);
    expect((await json(t.web, "/api/me", { session: b })).status).toBe(401);
  });
});

describe("consent gate", () => {
  let t: ReturnType<typeof testApp>;
  beforeEach(() => (t = testApp()));
  afterEach(() => t.app.close());

  it("new users must accept the current terms before using the app; acceptance is recorded with version", async () => {
    const s = await login(t.web, "fresh@a.co", false);
    const gated = await html(t.web, "/settings", s);
    expect(gated.status).toBe(302);
    expect(gated.location).toBe("/legal/accept?next=%2Fsettings");
    const page = await html(t.web, "/legal/accept?next=%2Fsettings", s);
    expect(page.status).toBe(200);
    expect(page.text).toContain("One last thing");
    // API still works (API keys inherit the owner's acceptance), the UI does not.
    expect((await json(t.web, "/api/me", { session: s })).status).toBe(200);
    // Both boxes required.
    const partial = await t.web.request(`${t.base}/legal/accept`, { method: "POST", headers: { cookie: s.cookie, "content-type": "application/x-www-form-urlencoded" }, body: "terms=1&next=%2Fsettings" });
    expect(partial.status).toBe(400);
    const ok = await t.web.request(`${t.base}/legal/accept`, { method: "POST", headers: { cookie: s.cookie, "content-type": "application/x-www-form-urlencoded" }, body: "terms=1&privacy=1&next=%2Fsettings" });
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("/settings");
    expect((await html(t.web, "/settings", s)).status).toBe(200);
    const consents = t.app.repo.listConsents(t.app.repo.getUserByEmail("fresh@a.co")!.id);
    expect(consents.map((c) => c.document).sort()).toEqual(["privacy", "terms"]);
    expect(t.app.events.list({ type: "user.consent_recorded" })).toHaveLength(1);
  });

  it("rejects open redirects in next", async () => {
    const s = await login(t.web, "redir@a.co", false);
    const r = await t.web.request(`${t.base}/legal/accept`, { method: "POST", headers: { cookie: s.cookie, "content-type": "application/x-www-form-urlencoded" }, body: "terms=1&privacy=1&next=https%3A%2F%2Fevil.example" });
    expect(r.headers.get("location")).toBe("/");
  });
});

describe("data rights: export and deletion", () => {
  let t: ReturnType<typeof testApp>;
  beforeEach(() => (t = testApp()));
  afterEach(() => t.app.close());

  it("exports everything for the account as JSON and nothing from other accounts", async () => {
    const f = await fixture(t, "me@a.co");
    await f.scan();
    await fixture(t, "other@b.co");
    const ex = await json<Record<string, unknown[]>>(t.web, "/api/me/export", { session: f.session });
    expect(ex.status).toBe(200);
    expect(ex.body.businesses).toHaveLength(1);
    expect(ex.body.monitored_pages).toHaveLength(3);
    expect(ex.body.snapshots).toHaveLength(3);
    expect((ex.body.users as { email: string; password_hash?: string }[])[0]!.email).toBe("me@a.co");
    expect((ex.body.users as { password_hash?: string }[])[0]!.password_hash).toBeUndefined();
    expect((ex.body.events as { account_id?: number }[]).length).toBeGreaterThan(5);
    expect(t.app.events.list({ type: "account.data_exported" })).toHaveLength(1);
    const dl = await t.web.request(`${t.base}/settings/export`, { headers: { cookie: f.session.cookie } });
    expect(dl.headers.get("content-disposition")).toContain("attachment");
  });

  it("deletion: grace period, pauses monitoring, cancellable, then hard-deletes everything and redacts emails", async () => {
    const f = await fixture(t, "bye@a.co");
    await f.scan();
    const acct = t.app.repo.getUserByEmail("bye@a.co")!.account_id;
    const req = await json<{ delete_after: string }>(t.web, "/api/account/delete", { method: "POST", session: f.session });
    expect(req.status).toBe(202);
    expect(t.app.repo.listPagesAny().filter((p) => p.account_id === acct).every((p) => p.status === "PAUSED")).toBe(true);
    expect(t.app.events.list({ type: "account.deletion_requested" })[0]!.risk_level).toBe("high");

    // Cancel, then request again.
    expect((await json(t.web, "/api/account/delete/cancel", { method: "POST", session: f.session })).status).toBe(204);
    expect(t.app.repo.getAccount(acct)!.delete_after).toBeNull();
    await json(t.web, "/api/account/delete", { method: "POST", session: f.session });

    // Not yet due -> nothing happens.
    const { purgeDeletedAccounts } = await import("../src/web/actions.js");
    expect(purgeDeletedAccounts(t.app)).toBe(0);
    // Force due.
    t.app.repo.setAccountDeletion(acct, "2000-01-01T00:00:00Z");
    expect(purgeDeletedAccounts(t.app)).toBe(1);
    expect(t.app.repo.getAccount(acct)).toBeUndefined();
    expect(t.app.repo.getUserByEmail("bye@a.co")).toBeUndefined();
    for (const table of ["businesses", "competitors", "monitored_pages", "snapshots", "changes", "insights", "sessions", "api_keys"]) {
      expect(t.app.repo.count(`SELECT COUNT(*) c FROM ${table}${table === "sessions" || table === "api_keys" ? "" : " WHERE account_id = ?"}`, ...(table === "sessions" || table === "api_keys" ? [] : [acct])), table).toBe(0);
    }
    expect(t.app.repo.listEmails().every((e) => e.to_address === "[deleted]" || !e.to_address.includes("bye@"))).toBe(true);
    // Audit trail survives without the account reference.
    const deleted = t.app.events.list({ type: "account.deleted" })[0]!;
    expect(deleted.account_id).toBeNull();
    expect(JSON.parse(deleted.payload)).toMatchObject({ users: 1, businesses: 1 });
    expect((await json(t.web, "/api/me", { session: f.session })).status).toBe(401);
  });
});

describe("markdown renderer", () => {
  it("renders headings, tables, lists, emphasis and escapes HTML", () => {
    const html = renderMarkdown("# Title\n\nSome **bold** and `code` <script>x</script>.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- one\n- two\n");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<table><thead><tr><th>A</th><th>B</th>");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
  });
});
