// Exercises the founder's repo tools against the REAL GitHub repo with the bot token from Documents.
// Reads, then proposes a tiny docs-only change as a PR. Does not merge.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GitHub } from "../src/github.js";

const token = readFileSync(join(homedir(), "Documents", "github_bot_token.txt"), "utf8").trim();
const gh = new GitHub({ token, repo: "MichaelPearcey/RivalWatch" });

console.log("default branch:", await gh.defaultBranch());
const files = await gh.listFiles("main", "docs/");
console.log("docs files:", files.map((f) => f.path));
const readme = await gh.readFile("README.md");
console.log("README bytes:", readme.size);
const hits = await gh.search("Our crawler");
console.log("search 'Our crawler':", hits.map((h) => h.path));

const head = await gh.branchSha("main");
const branch = `founder/live-check-${Date.now().toString(36).slice(-4)}`;
await gh.createBranch(branch, head!);
const roadmap = await gh.readFile("docs/06-roadmap.md");
const updated = roadmap.content.replace("- [ ] Founder assistant can propose code changes as GitHub pull requests; merge is an approval", "- [x] Founder assistant can propose code changes as GitHub pull requests; merge is an approval");
if (updated === roadmap.content) throw new Error("roadmap line not found");
const commit = await gh.commitFiles(branch, "docs: mark founder PR capability as done\n\nOpened by the live repo check.", [{ path: "docs/06-roadmap.md", content: updated }]);
const pr = await gh.openPullRequest({ head: branch, base: "main", title: "docs: founder assistant can now open pull requests", body: "Live check of the founder assistant's repository access. Docs-only change.\n\n---\n_Proposed by the RivalWatch founder assistant. Merging requires an approval in /admin; CI must be green._" });
console.log("PR:", pr.number, pr.html_url, "commit", commit.sha.slice(0, 7));
await new Promise((r) => setTimeout(r, 15_000));
console.log("CI after 15s:", JSON.stringify(await gh.ciStatus(branch)));
