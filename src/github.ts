/**
 * Minimal GitHub REST client for the founder assistant's repo tools.
 * Scope: read files/tree/search, create branches + commits, open/inspect/merge pull requests,
 * read Actions results. Uses a fine-grained token limited to one repository.
 */
export interface GitHubOptions {
  token: string;
  repo: string; // owner/name
  fetchImpl?: typeof fetch;
  apiBase?: string;
}

export interface PullRequestInfo {
  number: number;
  html_url: string;
  title: string;
  state: "open" | "closed";
  merged: boolean;
  head: string;
  base: string;
  mergeable: boolean | null;
  additions: number;
  deletions: number;
  changed_files: number;
}

export interface CiStatus {
  state: "pending" | "success" | "failure" | "none";
  runs: { name: string; status: string; conclusion: string | null; url: string }[];
  failure_excerpt?: string;
}

export class GitHubError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class GitHub {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: GitHubOptions) {
    this.base = `${opts.apiBase ?? "https://api.github.com"}/repos/${opts.repo}`;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async req<T>(method: string, path: string, body?: unknown, accept = "application/vnd.github+json"): Promise<T> {
    const init: RequestInit = {
      method,
      headers: { authorization: `Bearer ${this.opts.token}`, accept, "user-agent": "RivalWatch-founder", "x-github-api-version": "2022-11-28", ...(body ? { "content-type": "application/json" } : {}) },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await this.fetchImpl(path.startsWith("http") ? path : `${this.base}${path}`, init);
    if (!res.ok) {
      const text = await res.text();
      throw new GitHubError(res.status, `GitHub ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    }
    if (res.status === 204) return undefined as T;
    return (accept.includes("json") ? await res.json() : await res.text()) as T;
  }

  // ---------- read ----------

  async defaultBranch(): Promise<string> {
    return ((await this.req<{ default_branch: string }>("GET", "")) as { default_branch: string }).default_branch;
  }

  async readFile(path: string, ref = "main"): Promise<{ content: string; sha: string; size: number }> {
    const r = await this.req<{ content: string; sha: string; size: number; encoding: string }>("GET", `/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
    return { content: Buffer.from(r.content, "base64").toString("utf8"), sha: r.sha, size: r.size };
  }

  /** Recursive tree of the branch, filtered to blobs; paths only. */
  async listFiles(ref = "main", prefix = ""): Promise<{ path: string; size: number }[]> {
    const r = await this.req<{ tree: { path: string; type: string; size?: number }[]; truncated: boolean }>("GET", `/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    return r.tree.filter((t) => t.type === "blob" && t.path.startsWith(prefix)).map((t) => ({ path: t.path, size: t.size ?? 0 }));
  }

  /** Code search within the repo (GitHub's search index; default branch only). */
  async search(query: string, limit = 20): Promise<{ path: string; fragments: string[] }[]> {
    const r = await this.req<{ items: { path: string; text_matches?: { fragment: string }[] }[] }>("GET", `${this.opts.apiBase ?? "https://api.github.com"}/search/code?q=${encodeURIComponent(`${query} repo:${this.opts.repo}`)}&per_page=${limit}`, undefined, "application/vnd.github.text-match+json");
    return r.items.map((i) => ({ path: i.path, fragments: (i.text_matches ?? []).map((m) => m.fragment).slice(0, 3) }));
  }

  // ---------- write ----------

  async branchSha(branch: string): Promise<string | null> {
    try {
      const r = await this.req<{ object: { sha: string } }>("GET", `/git/ref/heads/${encodeURIComponent(branch)}`);
      return r.object.sha;
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return null;
      throw err;
    }
  }

  async createBranch(name: string, fromSha: string): Promise<void> {
    await this.req("POST", "/git/refs", { ref: `refs/heads/${name}`, sha: fromSha });
  }

  /** Commit a set of file changes (create/update/delete) to a branch in one commit. */
  async commitFiles(branch: string, message: string, files: { path: string; content: string | null }[], author = { name: "RivalWatch Founder", email: "founder@rivalwatch.local" }): Promise<{ sha: string }> {
    const headSha = await this.branchSha(branch);
    if (!headSha) throw new GitHubError(404, `branch ${branch} not found`);
    const head = await this.req<{ tree: { sha: string } }>("GET", `/git/commits/${headSha}`);
    const tree = await Promise.all(
      files.map(async (f) => {
        if (f.content === null) return { path: f.path, mode: "100644", type: "blob", sha: null };
        const blob = await this.req<{ sha: string }>("POST", "/git/blobs", { content: Buffer.from(f.content, "utf8").toString("base64"), encoding: "base64" });
        return { path: f.path, mode: "100644", type: "blob", sha: blob.sha };
      }),
    );
    const newTree = await this.req<{ sha: string }>("POST", "/git/trees", { base_tree: head.tree.sha, tree });
    const commit = await this.req<{ sha: string }>("POST", "/git/commits", { message, tree: newTree.sha, parents: [headSha], author: { ...author, date: new Date().toISOString() } });
    await this.req("PATCH", `/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha, force: false });
    return { sha: commit.sha };
  }

  async openPullRequest(input: { head: string; base: string; title: string; body: string }): Promise<PullRequestInfo> {
    return toPr(await this.req<RawPr>("POST", "/pulls", input));
  }

  async pullRequest(number: number): Promise<PullRequestInfo> {
    return toPr(await this.req<RawPr>("GET", `/pulls/${number}`));
  }

  async listPullRequests(state: "open" | "closed" | "all" = "open"): Promise<PullRequestInfo[]> {
    return (await this.req<RawPr[]>("GET", `/pulls?state=${state}&per_page=20`)).map(toPr);
  }

  async mergePullRequest(number: number, commitTitle: string): Promise<{ sha: string; merged: boolean }> {
    return this.req("PUT", `/pulls/${number}/merge`, { merge_method: "squash", commit_title: commitTitle });
  }

  async closePullRequest(number: number): Promise<void> {
    await this.req("PATCH", `/pulls/${number}`, { state: "closed" });
  }

  // ---------- CI ----------

  async ciStatus(branch: string): Promise<CiStatus> {
    const r = await this.req<{ workflow_runs: { name: string; status: string; conclusion: string | null; html_url: string; id: number }[] }>("GET", `/actions/runs?branch=${encodeURIComponent(branch)}&per_page=5`);
    const runs = r.workflow_runs.map((w) => ({ name: w.name, status: w.status, conclusion: w.conclusion, url: w.html_url, id: w.id }));
    if (runs.length === 0) return { state: "none", runs: [] };
    const latest = runs[0]!;
    let state: CiStatus["state"] = latest.status !== "completed" ? "pending" : latest.conclusion === "success" ? "success" : "failure";
    const out: CiStatus = { state, runs: runs.map(({ id: _id, ...rest }) => rest) };
    if (state === "failure") {
      try {
        const jobs = await this.req<{ jobs: { id: number; name: string; conclusion: string | null }[] }>("GET", `/actions/runs/${latest.id}/jobs`);
        const failed = jobs.jobs.find((j) => j.conclusion === "failure");
        if (failed) {
          const log = await this.req<string>("GET", `/actions/jobs/${failed.id}/logs`, undefined, "text/plain");
          out.failure_excerpt = excerptFailure(log);
        }
      } catch {
        /* logs may not be available yet */
      }
    }
    return out;
  }
}

interface RawPr {
  number: number;
  html_url: string;
  title: string;
  state: "open" | "closed";
  merged: boolean;
  head: { ref: string };
  base: { ref: string };
  mergeable: boolean | null;
  additions?: number;
  deletions?: number;
  changed_files?: number;
}
const toPr = (r: RawPr): PullRequestInfo => ({ number: r.number, html_url: r.html_url, title: r.title, state: r.state, merged: r.merged, head: r.head.ref, base: r.base.ref, mergeable: r.mergeable, additions: r.additions ?? 0, deletions: r.deletions ?? 0, changed_files: r.changed_files ?? 0 });

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

/** Pull the most useful ~60 lines out of an Actions job log: error lines and what follows them. */
export function excerptFailure(log: string, maxLines = 60): string {
  const lines = log.split("\n").map((l) => l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, ""));
  const idx = lines.findIndex((l) => /error TS\d+|FAIL |✗|AssertionError|Error:|npm ERR!|##\[error\]/.test(l));
  const start = Math.max(0, idx === -1 ? lines.length - maxLines : idx - 5);
  return lines.slice(start, start + maxLines).join("\n").slice(0, 6000);
}

/** Branch-safe slug from a title. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "change";
}
