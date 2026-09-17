import { describe, expect, it } from "vitest";
import type { MonitoredPage } from "../src/db/repo.js";
import { PoliteFetcher } from "../src/sources/website/fetcher.js";
import { WebsiteSource } from "../src/sources/website/index.js";
import type { PageRenderer, RenderedPage } from "../src/sources/website/render.js";

const SHELL = `<!doctype html><html><head><title>VITER DANCE STUDIO</title><script>${"x".repeat(30_000)}</script></head><body><div id="root">You need to enable JavaScript to run this app.</div></body></html>`;
const RENDERED = `<!doctype html><html><head><title>VITER DANCE STUDIO</title></head><body><main><h1>VITER DANCE STUDIO</h1><p>Абонемент на 8 занять - 1900 грн</p><p>Разове заняття - 400 грн, пробне - 300 грн на місяць</p></main></body></html>`;
const STATIC = "<html><head><title>Acme</title></head><body><main><p>Plans start at £29 per month for small teams and agencies of any size.</p></main></body></html>";

function fakeFetch(routes: Record<string, { status?: number; body?: string }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const r = routes[url] ?? { status: 404, body: "" };
    return new Response(r.body ?? "", { status: r.status ?? 200, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
}

function renderer(html: string | null): PageRenderer & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async render(url: string): Promise<RenderedPage | null> {
      calls.push(url);
      return html === null ? null : { html, finalUrl: url };
    },
    async close() {},
  };
}

function source(routes: Record<string, { status?: number; body?: string }>, r?: PageRenderer): WebsiteSource {
  const fetcher = new PoliteFetcher({ userAgent: "RivalWatchBot/test", timeoutMs: 500, minHostDelayMs: 0, fetchImpl: fakeFetch(routes) });
  return new WebsiteSource(fetcher, r);
}

const page = (url: string) => ({ url, source_type: "website" }) as MonitoredPage;

describe("JavaScript-rendered pages", () => {
  it("renders a page whose HTML is an empty shell, and reads its prices", async () => {
    const r = renderer(RENDERED);
    const out = await source({ "https://a.example/robots.txt": { body: "User-agent: *\nAllow: /" }, "https://a.example/club": { body: SHELL } }, r).fetch(page("https://a.example/club"));
    expect(r.calls).toEqual(["https://a.example/club"]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain("1900 грн");
    expect(out.meta.prices).toContain("1900грн");
    expect(out.meta.rendered).toBe(true);
  });

  it("does not start a browser for a page that already has text", async () => {
    const r = renderer(RENDERED);
    const out = await source({ "https://a.example/robots.txt": { body: "User-agent: *\nAllow: /" }, "https://a.example/pricing": { body: STATIC } }, r).fetch(page("https://a.example/pricing"));
    expect(r.calls).toEqual([]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.meta.rendered).toBe(false);
  });

  it("never opens a browser for a URL robots.txt disallows", async () => {
    const r = renderer(RENDERED);
    const out = await source({ "https://a.example/robots.txt": { body: "User-agent: *\nDisallow: /" } }, r).fetch(page("https://a.example/club"));
    expect(r.calls).toEqual([]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("robots_blocked");
  });

  it("stays unreadable, rather than failing, when the browser cannot render", async () => {
    const r = renderer(null);
    const out = await source({ "https://a.example/robots.txt": { body: "User-agent: *\nAllow: /" }, "https://a.example/club": { body: SHELL } }, r).fetch(page("https://a.example/club"));
    expect(r.calls).toHaveLength(1);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("content_unreadable");
  });

  it("keeps the empty-shell verdict when rendering adds nothing", async () => {
    const out = await source({ "https://a.example/robots.txt": { body: "User-agent: *\nAllow: /" }, "https://a.example/club": { body: SHELL } }, renderer(SHELL)).fetch(page("https://a.example/club"));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("content_unreadable");
  });

  it("is simply off when no browser is configured", async () => {
    const out = await source({ "https://a.example/robots.txt": { body: "User-agent: *\nAllow: /" }, "https://a.example/club": { body: SHELL } }).fetch(page("https://a.example/club"));
    expect(out.ok).toBe(false);
  });
});
