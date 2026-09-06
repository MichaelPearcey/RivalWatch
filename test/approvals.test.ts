import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Approval } from "../src/approvals.js";
import { fixture, html, json, login, testApp } from "./helpers.js";

type ApprovalView = Approval & { summary: string };

describe("approvals: request -> decide -> execute", () => {
  let t: ReturnType<typeof testApp>;
  beforeEach(() => (t = testApp()));
  afterEach(() => t.app.close());

  async function agentKey(email: string, name: string) {
    const s = await login(t.web, email);
    const k = await json<{ key: string }>(t.web, "/api/api-keys", { method: "POST", session: s, body: JSON.stringify({ name }) });
    return { session: s, bearer: k.body.key };
  }

  it("an agent can request a plan change but not perform it; a human admin approves and the system executes", async () => {
    const admin = await login(t.web, "admin@rivalwatch.test");
    const { session: owner, bearer } = await agentKey("owner@a.co", "support-agent");
    const acct = t.app.repo.getUserByEmail("owner@a.co")!.account_id;

    // Agent cannot change the plan directly.
    expect((await json(t.web, `/api/admin/accounts/${acct}/plan`, { method: "POST", bearer, body: JSON.stringify({ plan: "pro" }) })).status).toBe(403);

    // Agent requests.
    const req = await json<ApprovalView>(t.web, "/api/approvals", { method: "POST", bearer, body: JSON.stringify({ action: "account.set_plan", payload: { account_id: acct, plan: "pro" }, reason: "customer asked to upgrade" }) });
    expect(req.status).toBe(202);
    expect(req.body).toMatchObject({ status: "pending", risk_level: "high", requested_by: "agent:support-agent", account_id: acct });
    expect(req.body.summary).toBe(`Set account #${acct} to the Pro plan`);
    expect(t.app.repo.getAccount(acct)!.plan).toBe("free");

    // Non-admins cannot decide; the requester cannot decide.
    expect((await json(t.web, `/api/approvals/${req.body.id}/decide`, { method: "POST", session: owner, body: JSON.stringify({ approve: true }) })).status).toBe(403);
    expect((await json(t.web, `/api/approvals/${req.body.id}/decide`, { method: "POST", bearer, body: JSON.stringify({ approve: true }) })).status).toBe(403);

    // The owner sees their account's request; admin sees it in the inbox.
    expect((await json<ApprovalView[]>(t.web, "/api/approvals", { session: owner })).body.map((a) => a.id)).toEqual([req.body.id]);
    const inbox = await html(t.web, "/admin", admin);
    expect(inbox.text).toContain("Needs your attention (1)");
    expect(inbox.text).toContain("customer asked to upgrade");

    // Admin approves -> executed.
    const decided = await json<Approval>(t.web, `/api/approvals/${req.body.id}/decide`, { method: "POST", session: admin, body: JSON.stringify({ approve: true, note: "ok" }) });
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe("executed");
    expect(JSON.parse(decided.body.result!)).toEqual({ from: "free", to: "pro" });
    expect(t.app.repo.getAccount(acct)!.plan).toBe("pro");

    const types = t.app.events.list({ limit: 50 }).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["approval.requested", "approval.granted", "account.plan_changed"]));
    const changed = t.app.events.list({ type: "account.plan_changed" })[0]!;
    expect(changed.requested_by).toBe("agent:support-agent");
    expect(changed.approved_by).toMatch(/^user:\d+$/);
    expect(changed.actor).toBe("system");

    // Cannot decide twice.
    expect((await json(t.web, `/api/approvals/${req.body.id}/decide`, { method: "POST", session: admin, body: JSON.stringify({ approve: false }) })).status).toBe(409);
  });

  it("denied requests execute nothing and are audited", async () => {
    const admin = await login(t.web, "admin@rivalwatch.test");
    const { bearer } = await agentKey("o2@a.co", "growth");
    const acct = t.app.repo.getUserByEmail("o2@a.co")!.account_id;
    const req = await json<Approval>(t.web, "/api/approvals", { method: "POST", bearer, body: JSON.stringify({ action: "account.set_plan", payload: { account_id: acct, plan: "plus" } }) });
    const denied = await json<Approval>(t.web, `/api/approvals/${req.body.id}/decide`, { method: "POST", session: admin, body: JSON.stringify({ approve: false, note: "no" }) });
    expect(denied.body.status).toBe("denied");
    expect(t.app.repo.getAccount(acct)!.plan).toBe("free");
    expect(t.app.events.list({ type: "approval.denied" })[0]!.result).toBe("denied");
  });

  it("rejects unknown actions and invalid payloads at request time", async () => {
    const s = await login(t.web, "x@a.co");
    expect((await json(t.web, "/api/approvals", { method: "POST", session: s, body: JSON.stringify({ action: "nuke.everything", payload: {} }) })).status).toBe(400);
    const bad = await json<{ error: string }>(t.web, "/api/approvals", { method: "POST", session: s, body: JSON.stringify({ action: "account.set_plan", payload: { account_id: 1, plan: "gold" } }) });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain("unknown plan");
    expect(t.app.approvals.pendingCount()).toBe(0);
  });

  it("medium-risk actions may be approved by the Manager agent; high-risk may not", async () => {
    const f = await fixture(t);
    const acct = t.app.repo.getUserByEmail(f.session.email)!.account_id;
    const manager = { actor: "agent:manager", isAdmin: false, isManagerAgent: true };
    const medium = t.app.approvals.request({ actor: "agent:support" }, { action: "page.set_paused", payload: { page_id: f.pages[0]!.id, paused: true }, accountId: acct });
    const high = t.app.approvals.request({ actor: "agent:support" }, { action: "account.set_plan", payload: { account_id: acct, plan: "plus" }, accountId: acct });
    const done = await t.app.approvals.decide(manager, medium.id, true);
    expect(done.status).toBe("executed");
    expect(t.app.repo.getPageAny(f.pages[0]!.id)!.status).toBe("PAUSED");
    await expect(t.app.approvals.decide(manager, high.id, true)).rejects.toThrow(/human admin/);
    expect(t.app.repo.getAccount(acct)!.plan).toBe("pro");
  });

  it("email.send executes through the mailer and records the email", async () => {
    const admin = await login(t.web, "admin@rivalwatch.test");
    const req = t.app.approvals.request({ actor: "agent:support" }, { action: "email.send", payload: { account_id: null, to: "cust@a.co", subject: "Re: your question", text: "Hello", kind: "support_reply" } });
    const done = await t.app.approvals.decide(t.app.auth.principalFromSession(admin.cookie.split("=")[1])!, req.id, true);
    expect(done.status).toBe("executed");
    const email = t.app.repo.listEmails()[0]!;
    expect(email).toMatchObject({ to_address: "cust@a.co", kind: "support_reply", status: "logged" });
  });

  it("stale pending requests expire via the scheduler job", async () => {
    const acct = (await login(t.web, "e@a.co")) && t.app.repo.getUserByEmail("e@a.co")!.account_id;
    const req = t.app.approvals.request({ actor: "agent:x" }, { action: "account.set_plan", payload: { account_id: acct, plan: "pro" }, ttlHours: 0 });
    await new Promise((r) => setTimeout(r, 5));
    expect(t.app.approvals.expireStale()).toBe(1);
    expect(t.app.approvals.get(req.id)!.status).toBe("expired");
    expect(t.app.events.list({ type: "approval.expired" })).toHaveLength(1);
  });

  it("admin direct plan change is recorded as request + approval by the same admin", async () => {
    const admin = await login(t.web, "admin@rivalwatch.test");
    await login(t.web, "cust@a.co");
    const acct = t.app.repo.getUserByEmail("cust@a.co")!.account_id;
    const r = await json<{ approval_id: number; plan: string }>(t.web, `/api/admin/accounts/${acct}/plan`, { method: "POST", session: admin, body: JSON.stringify({ plan: "plus" }) });
    expect(r.status).toBe(200);
    const a = t.app.approvals.get(r.body.approval_id)!;
    expect(a.status).toBe("executed");
    expect(a.requested_by).toBe(a.decided_by);
    expect(t.app.repo.getAccount(acct)!.plan).toBe("plus");
  });
});
