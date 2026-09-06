import { afterEach, describe, expect, it } from "vitest";
import type { MessagesClient } from "../src/agents/runner.js";
import { GitHub, excerptFailure, slugify } from "../src/github.js";
import { json, login, testApp } from "./helpers.js";

/** In-memory stand-in for the GitHub REST endpoints we use. */
function fakeGitHub(files: Record<string, string>) {
  const branches: Record<string, { sha: string; files: Record<string, string> }> = { main: { sha: "sha-main-0", files: { ...files } } };
  const prs: { number: number; head: string; base: string; title: string; body: string; state: "open" | "closed"; merged: boolean }[] = [];
  let ciByBranch: Record<string, { status: string; conclusion: string | null }> = {};
  let n = 0;
  const blobs: Record<string, string> = {};
  const trees: Record<string, { base: string; entries: { path: string; sha: string | null }[] }> = {};
  const commits: Record<string, { tree: string }> = { "sha-main-0": { tree: "tree-main-0" } };
  const state = { branches, prs, merged: [] as number[], setCi: (b: string, s: { status: string; conclusion: string | null }) => (ciByBranch[b] = s) };

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
    const m = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const p = u.pathname.replace("/repos/o/r", "");
    const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    let mm: RegExpMatchArray | null;
    if (p === "" && m === "GET") return ok({ default_branch: "main" });
    if ((mm = p.match(/^\/contents\/(.+)$/)) && m === "GET") {
      const ref = u.searchParams.get("ref") ?? "main";
      const f = branches[ref]?.files[decodeURIComponent(mm[1]!)];
      return f === undefined ? ok({ message: "Not Found" }, 404) : ok({ content: Buffer.from(f).toString("base64"), sha: "blob", size: f.length, encoding: "base64" });
    }
    if ((mm = p.match(/^\/git\/trees\/(.+)$/)) && m === "GET") {
      const b = branches[decodeURIComponent(mm[1]!)];
      return ok({ tree: Object.entries(b?.files ?? {}).map(([path, c]) => ({ path, type: "blob", size: c.length })), truncated: false });
    }
    if (p === "/search/code") return ok({ items: Object.entries(branches.main!.files).filter(([, c]) => c.includes((u.searchParams.get("q") ?? "").split(" repo:")[0]!)).map(([path]) => ({ path, text_matches: [{ fragment: "…" }] })) });
    if ((mm = p.match(/^\/git\/ref\/heads\/(.+)$/))) {
      const b = branches[decodeURIComponent(mm[1]!)];
      return b ? ok({ object: { sha: b.sha } }) : ok({ message: "Not Found" }, 404);
    }
    if (p === "/git/refs" && m === "POST") {
      const name = String(body.ref).replace("refs/heads/", "");
      const from = Object.values(branches).find((b) => b.sha === body.sha)!;
      branches[name] = { sha: body.sha, files: { ...from.files } };
      return ok({}, 201);
    }
    if ((mm = p.match(/^\/git\/commits\/(.+)$/)) && m === "GET") return ok({ tree: { sha: commits[mm[1]!]?.tree ?? "tree-x" } });
    if (p === "/git/blobs" && m === "POST") {
      const sha = `blob-${++n}`;
      blobs[sha] = Buffer.from(body.content, "base64").toString("utf8");
      return ok({ sha }, 201);
    }
    if (p === "/git/trees" && m === "POST") {
      const sha = `tree-${++n}`;
      trees[sha] = { base: body.base_tree, entries: body.tree };
      return ok({ sha }, 201);
    }
    if (p === "/git/commits" && m === "POST") {
      const sha = `commit-${++n}`;
      commits[sha] = { tree: body.tree };
      return ok({ sha }, 201);
    }
    if ((mm = p.match(/^\/git\/refs\/heads\/(.+)$/)) && m === "PATCH") {
      const b = branches[decodeURIComponent(mm[1]!)]!;
      const tree = trees[commits[body.sha]!.tree]!;
      for (const e of tree.entries) {
        if (e.sha === null) delete b.files[e.path];
        else b.files[e.path] = blobs[e.sha]!;
      }
      b.sha = body.sha;
      return ok({});
    }
    if (p === "/pulls" && m === "POST") {
      const pr = { number: prs.length + 1, head: body.head, base: body.base, title: body.title, body: body.body, state: "open" as const, merged: false };
      prs.push(pr);
      return ok(rawPr(pr), 201);
    }
    if (p === "/pulls" && m === "GET") return ok(prs.filter((x) => u.searchParams.get("state") === "all" || x.state === u.searchParams.get("state")).map(rawPr));
    if ((mm = p.match(/^\/pulls\/(\d+)$/)) && m === "GET") return ok(rawPr(prs[Number(mm[1]) - 1]!));
    if ((mm = p.match(/^\/pulls\/(\d+)\/merge$/)) && m === "PUT") {
      const pr = prs[Number(mm[1]) - 1]!;
      pr.state = "closed";
      pr.merged = true;
      branches.main!.files = { ...branches[pr.head]!.files };
      state.merged.push(pr.number);
      return ok({ sha: "merge-sha", merged: true });
    }
    if (p === "/actions/runs") {
      const c = ciByBranch[u.searchParams.get("branch")!];
      return ok({ workflow_runs: c ? [{ id: 7, name: "CI", status: c.status, conclusion: c.conclusion, html_url: "https://gh/run/7" }] : [] });
    }
    if (p === "/actions/runs/7/jobs") return ok({ jobs: [{ id: 9, name: "check", conclusion: "failure" }] });
    if (p === "/actions/jobs/9/logs") return new Response("2026-09-06T20:00:00.0000000Z npm run check\n2026-09-06T20:00:01.0000000Z src/web/views.tsx(12,3): error TS2304: Cannot find name 'oops'.\n2026-09-06T20:00:02.0000000Z ##[error]Process completed with exit code 2.", { status: 200 });
    return ok({ message: `unhandled ${m} ${p}` }, 500);
  }) as typeof fetch;

  const rawPr = (pr: (typeof prs)[number]) => ({ number: pr.number, html_url: `https://gh/pr/${pr.number}`, title: pr.title, state: pr.state, merged: pr.merged, head: { ref: pr.head }, base: { ref: "main" }, mergeable: true, additions: 1, deletions: 1, changed_files: 1 });
  return { client: new GitHub({ token: "t", repo: "o/r", fetchImpl }), state };
}

type Turn = { text?: string; tools?: { name: string; input: unknown }[] };
function scripted(turns: Turn[]): MessagesClient & { results: string[] } {
  let i = 0;
  const results: string[] = [];
  return {
    results,
    create: (async (params: { messages: { role: string; content: unknown }[] }) => {
      const last = params.messages.at(-1);
      if (last && Array.isArray(last.content)) for (const r of last.content as { content: string }[]) results.push(r.content);
      const t = turns[Math.min(i++, turns.length - 1)]!;
      const content: unknown[] = [];
      if (t.text) content.push({ type: "text", text: t.text });
      for (const [k, tool] of (t.tools ?? []).entries()) content.push({ type: "tool_use", id: `tu_${i}_${k}`, name: tool.name, input: tool.input });
      return { model: "claude-test", content, stop_reason: t.tools?.length ? "tool_use" : "end_turn", usage: { input_tokens: 1000, output_tokens: 100 } };
    }) as never,
  };
}
const on = { AI_PROVIDER: "anthropic" as const, ANTHROPIC_API_KEY: "sk-test" };

describe("GitHub client helpers", () => {
  it("slugify + failure excerpt", () => {
    expect(slugify("Warmer landing colours!")).toBe("warmer-landing-colours");
    const ex = excerptFailure("2026-09-06T20:00:00.0000000Z ok\n2026-09-06T20:00:01Z src/x.ts(1,1): error TS2304: nope\nmore");
    expect(ex).toContain("error TS2304");
    expect(ex).not.toContain("2026-09-06T");
  });
});

describe("founder assistant edits the repo through pull requests", () => {
  let t: ReturnType<typeof testApp>;
  afterEach(() => t?.app.close());

  it("read -> propose PR -> CI fails -> fix on same branch -> CI green -> human approves merge", async () => {
    const gh = fakeGitHub({ "src/web/theme.ts": "export const CSS = `--brand:#6ea8ff`;", "src/i18n/en.ts": "export const en = { 'hero.h1a': 'Know the moment your' } as const;" });
    const client = scripted([
      { tools: [{ name: "repo_search", input: { query: "--brand" } }, { name: "repo_read_file", input: { path: "src/web/theme.ts" } }] },
      { tools: [{ name: "propose_change", input: { title: "Warmer brand colour", description: "Fulfils request: warmer tones on the landing page.", files: [{ path: "src/web/theme.ts", content: "export const CSS = `--brand:#ff8a5b`; oops" }] } }] },
      { tools: [{ name: "pr_status", input: { pr_number: 1 } }] },
      { tools: [{ name: "propose_change", input: { title: "Warmer brand colour", description: "Fix typecheck error.", branch: "BRANCH", files: [{ path: "src/web/theme.ts", content: "export const CSS = `--brand:#ff8a5b`;" }] } }] },
      { tools: [{ name: "request_approval", input: { action: "repo.merge_pr", payload: { pr_number: 1, title: "Warmer brand colour" }, reason: "CI is green; owner asked for warmer colours." } }] },
      { text: "I've opened PR #1 with a warmer brand colour, fixed the CI failure, and requested approval to merge." },
    ]);
    t = testApp(on, { founderClient: client, github: gh.client, analyzer: { name: "fake", analyze: async () => { throw new Error("unused"); } } });
    const admin = await login(t.web, "admin@rivalwatch.test");
    const conv = (await json<{ id: number }>(t.web, "/api/admin/founder/conversations", { method: "POST", session: admin })).body;

    // Patch the scripted branch name once the first PR exists (the branch is generated with a suffix).
    const origCreate = client.create.bind(client) as (p: unknown) => Promise<unknown>;
    (client as { create: unknown }).create = async (p: unknown) => {
      const res = (await origCreate(p)) as { content: { type: string; name?: string; input?: { branch?: string } }[] };
      for (const c of res.content) if (c.type === "tool_use" && c.input?.branch === "BRANCH") c.input.branch = gh.state.prs[0]!.head;
      // Simulate CI: first commit fails, later commits pass.
      const branch = gh.state.prs[0]?.head;
      if (branch) gh.state.setCi(branch, gh.state.branches[branch]!.files["src/web/theme.ts"]!.includes("oops") ? { status: "completed", conclusion: "failure" } : { status: "completed", conclusion: "success" });
      return res;
    };

    const reply = await json<{ content: string; tool_calls: number }>(t.web, `/api/admin/founder/conversations/${conv.id}/messages`, { method: "POST", session: admin, body: JSON.stringify({ text: "Make the brand colour warmer please" }) });
    expect(reply.status).toBe(200);
    expect(reply.body.tool_calls).toBe(6);
    expect(reply.body.content).toContain("PR #1");

    // The PR exists on a founder/* branch with the fixed content; CI excerpt reached the model.
    expect(gh.state.prs).toHaveLength(1);
    expect(gh.state.prs[0]!.head).toMatch(/^founder\/warmer-brand-colour-/);
    expect(gh.state.branches[gh.state.prs[0]!.head]!.files["src/web/theme.ts"]).toBe("export const CSS = `--brand:#ff8a5b`;");
    expect(client.results.some((r) => r.includes("error TS2304"))).toBe(true);
    expect(t.app.events.list({ type: "repo.change_proposed" })).toHaveLength(2);
    expect(t.app.memory.list({ kind: "journal" })[0]!.title).toBe("Opened PR #1: Warmer brand colour");

    // Nothing merged yet: the approval is pending for a human.
    expect(gh.state.merged).toEqual([]);
    const pending = t.app.approvals.list({ status: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.action).toBe("repo.merge_pr");
    expect(pending[0]!.risk_level).toBe("high");

    // Human approves -> merged -> main updated.
    const decided = await json<{ status: string; result: string }>(t.web, `/api/approvals/${pending[0]!.id}/decide`, { method: "POST", session: admin, body: JSON.stringify({ approve: true, note: "looks good" }) });
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe("executed");
    expect(gh.state.merged).toEqual([1]);
    expect(gh.state.branches.main!.files["src/web/theme.ts"]).toContain("#ff8a5b");
  });

  it("refuses to touch protected paths and refuses to merge while CI is red or pending", async () => {
    const gh = fakeGitHub({ "src/auth.ts": "x", "src/web/theme.ts": "y" });
    const client = scripted([
      { tools: [{ name: "propose_change", input: { title: "Loosen password rules", description: "Make passwords optional everywhere.", files: [{ path: "src/auth.ts", content: "hacked" }] } }] },
      { tools: [{ name: "propose_change", input: { title: "Tweak theme colours", description: "Slightly different accent colour.", files: [{ path: "src/web/theme.ts", content: "z" }] } }] },
      { text: "done" },
    ]);
    t = testApp(on, { founderClient: client, github: gh.client, analyzer: { name: "fake", analyze: async () => { throw new Error("unused"); } } });
    const admin = await login(t.web, "admin@rivalwatch.test");
    const conv = (await json<{ id: number }>(t.web, "/api/admin/founder/conversations", { method: "POST", session: admin })).body;
    await json(t.web, `/api/admin/founder/conversations/${conv.id}/messages`, { method: "POST", session: admin, body: JSON.stringify({ text: "go" }) });
    expect(client.results[0]).toContain("reserved for the engineering agent");
    expect(gh.state.branches["main"]!.files["src/auth.ts"]).toBe("x");
    expect(gh.state.prs).toHaveLength(1);

    // Merge approval with CI pending / failing is rejected at execution time.
    const branch = gh.state.prs[0]!.head;
    gh.state.setCi(branch, { status: "in_progress", conclusion: null });
    const a = t.app.approvals.request({ actor: "user:1" }, { action: "repo.merge_pr", payload: { pr_number: 1, title: "Tweak theme" }, reason: "test" });
    const r1 = await json<{ status: string; result: string }>(t.web, `/api/approvals/${a.id}/decide`, { method: "POST", session: admin, body: JSON.stringify({ approve: true }) });
    expect(r1.body.status).toBe("failed");
    expect(r1.body.result).toContain("still running");
    gh.state.setCi(branch, { status: "completed", conclusion: "failure" });
    const b = t.app.approvals.request({ actor: "user:1" }, { action: "repo.merge_pr", payload: { pr_number: 1, title: "Tweak theme" }, reason: "test" });
    const r2 = await json<{ status: string; result: string }>(t.web, `/api/approvals/${b.id}/decide`, { method: "POST", session: admin, body: JSON.stringify({ approve: true }) });
    expect(r2.body.result).toContain("CI failed");
    expect(gh.state.merged).toEqual([]);
  });

  it("without GitHub configured the tools explain the limitation instead of failing silently", async () => {
    const client = scripted([{ tools: [{ name: "repo_list_files", input: {} }] }, { text: "I cannot edit code on this server; I've saved the request." }]);
    t = testApp(on, { founderClient: client, analyzer: { name: "fake", analyze: async () => { throw new Error("unused"); } } });
    const admin = await login(t.web, "admin@rivalwatch.test");
    const conv = (await json<{ id: number }>(t.web, "/api/admin/founder/conversations", { method: "POST", session: admin })).body;
    await json(t.web, `/api/admin/founder/conversations/${conv.id}/messages`, { method: "POST", session: admin, body: JSON.stringify({ text: "list files" }) });
    expect(client.results[0]).toContain("not configured");
  });
});
