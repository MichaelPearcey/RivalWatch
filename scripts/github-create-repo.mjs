// Creates a private GitHub repository using GITHUB_TOKEN from the environment or .env.
// Prints only names/status. Never prints the token.
import { readFileSync, existsSync } from "node:fs";

const name = process.argv[2] ?? "rivalwatch";
if (!process.env.GITHUB_TOKEN && existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*GITHUB_TOKEN\s*=\s*(.+?)\s*$/);
    if (m) process.env.GITHUB_TOKEN = m[1].replace(/^["']|["']$/g, "");
  }
}
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN not found in environment or .env");
  process.exit(2);
}
const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "rivalwatch-setup", "content-type": "application/json" };

const me = await fetch("https://api.github.com/user", { headers });
if (!me.ok) {
  console.error(`token rejected: HTTP ${me.status}`);
  process.exit(1);
}
const { login } = await me.json();

const existing = await fetch(`https://api.github.com/repos/${login}/${name}`, { headers });
if (existing.ok) {
  const r = await existing.json();
  console.log(JSON.stringify({ status: "exists", full_name: r.full_name, private: r.private, ssh_url: r.ssh_url }));
  process.exit(0);
}

const res = await fetch("https://api.github.com/user/repos", {
  method: "POST",
  headers,
  body: JSON.stringify({ name, private: true, description: "RivalWatch - AI-filtered competitor monitoring", has_wiki: false, has_projects: false, auto_init: false }),
});
const body = await res.json();
if (!res.ok) {
  console.error(`create failed: HTTP ${res.status} ${body.message ?? ""}`);
  process.exit(1);
}
console.log(JSON.stringify({ status: "created", full_name: body.full_name, private: body.private, ssh_url: body.ssh_url }));
