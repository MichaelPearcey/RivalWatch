import { describe, expect, it } from "vitest";
import { PoliteFetcher } from "../src/sources/website/fetcher.js";

function fakeFetch(routes: Record<string, { status?: number; body?: string; delay?: number }>): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const r = routes[url] ?? { status: 404, body: "" };
    if (r.delay) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, r.delay);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    }
    return new Response(r.body ?? "", { status: r.status ?? 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch & { calls: string[] };
  f.calls = calls;
  return f;
}

const opts = { userAgent: "RivalWatchBot/test", timeoutMs: 200, minHostDelayMs: 0 };

describe("PoliteFetcher", () => {
  it("fetches robots.txt once per origin and allows permitted URLs", async () => {
    const f = fakeFetch({ "https://a.example/robots.txt": { body: "User-agent: *\nDisallow: /private/" }, "https://a.example/pricing": { body: "<p>hi</p>" } });
    const fetcher = new PoliteFetcher({ ...opts, fetchImpl: f });
    const r1 = await fetcher.get("https://a.example/pricing");
    const r2 = await fetcher.get("https://a.example/pricing");
    expect(r1.kind).toBe("ok");
    expect(r2.kind).toBe("ok");
    expect(f.calls.filter((u) => u.endsWith("robots.txt"))).toHaveLength(1);
  });

  it("refuses URLs disallowed by robots.txt without fetching them", async () => {
    const f = fakeFetch({ "https://a.example/robots.txt": { body: "User-agent: *\nDisallow: /private/" } });
    const fetcher = new PoliteFetcher({ ...opts, fetchImpl: f });
    const r = await fetcher.get("https://a.example/private/x");
    expect(r).toEqual({ kind: "blocked", reason: "disallowed by robots.txt" });
    expect(f.calls).not.toContain("https://a.example/private/x");
  });

  it("treats a missing robots.txt as allow-all", async () => {
    const f = fakeFetch({ "https://b.example/": { body: "<p>ok</p>" } });
    const r = await new PoliteFetcher({ ...opts, fetchImpl: f }).get("https://b.example/");
    expect(r.kind).toBe("ok");
  });

  it("sends an identifying user-agent", async () => {
    let ua: string | undefined;
    const f = (async (_u: unknown, init?: RequestInit) => {
      ua = (init?.headers as Record<string, string>)["user-agent"];
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    await new PoliteFetcher({ ...opts, fetchImpl: f }).get("https://c.example/");
    expect(ua).toBe("RivalWatchBot/test");
  });

  it("times out slow responses", async () => {
    const f = fakeFetch({ "https://d.example/slow": { body: "x", delay: 1000 } });
    await expect(new PoliteFetcher({ ...opts, fetchImpl: f }).get("https://d.example/slow")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("waits between requests to the same host", async () => {
    const sleeps: number[] = [];
    let now = 1_000_000;
    const f = fakeFetch({ "https://e.example/": { body: "x" } });
    const fetcher = new PoliteFetcher({
      ...opts,
      minHostDelayMs: 500,
      fetchImpl: f,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });
    await fetcher.get("https://e.example/");
    await fetcher.get("https://e.example/");
    // robots.txt + page, then page again: the two later requests each wait.
    expect(sleeps.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(500);
  });
});
