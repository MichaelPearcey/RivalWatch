import { describe, expect, it } from "vitest";
import { extractFromHtml, normaliseVolatile } from "../src/sources/website/extract.js";

const page = (body: string) => `<!doctype html><html><head><title>Acme - Pricing</title>
<script>var x = ${"1".repeat(30000)};</script><style>.a{}</style></head>
<body><nav><a href="/">Home</a><a href="/pricing">Pricing</a></nav>
<div class="cookie-banner">We use cookies</div>
<main>${body}</main>
<footer>© 2026 Acme. Last updated 2026-09-05T10:00:00Z</footer></body></html>`;

describe("extractFromHtml", () => {
  it("keeps main content and drops nav, footer, scripts and cookie banners", () => {
    const out = extractFromHtml(page("<h1>Pricing</h1><p>Pro plan £49/month</p>"));
    expect(out.title).toBe("Acme - Pricing");
    expect(out.text).toContain("Pricing");
    expect(out.text).toContain("Pro plan £49/month");
    expect(out.text).not.toContain("cookies");
    expect(out.text).not.toContain("Home");
    expect(out.text).not.toContain("var x");
    expect(out.text).not.toContain("2026-09-05");
  });

  it("emits one line per block element", () => {
    const out = extractFromHtml(page("<section><h2>Starter</h2><p>£19/month</p></section><section><h2>Pro</h2><p>£49/month</p></section>"));
    expect(out.text.split("\n")).toEqual(["Starter", "£19/month", "Pro", "£49/month"]);
  });

  it("finds price mentions", () => {
    const out = extractFromHtml(page("<p>From £19/month or $199/year. Enterprise 1,299 GBP.</p>"));
    expect(out.meta.prices).toEqual(expect.arrayContaining(["£19/month", "$199/year", "1,299GBP"]));
  });

  it("finds hryvnia prices written after the amount", () => {
    const out = extractFromHtml(page("<p>Базовий 800 грн/міс., Преміум 1 500 ₴/міс.</p>"));
    expect(out.meta.prices).toEqual(expect.arrayContaining(["800грн/міс.", "1500₴/міс."]));
  });

  it("flags thin JS-rendered pages", () => {
    const out = extractFromHtml(page("<div id='app'></div>"));
    expect(out.meta.thin).toBe(true);
    expect(extractFromHtml(page("<p>" + "word ".repeat(100) + "</p>")).meta.thin).toBe(false);
  });
});

describe("normaliseVolatile", () => {
  it("replaces dates, times, relative times and counters", () => {
    const s = normaliseVolatile("Posted 5 September 2026 at 10:30 am, 3 hours ago. 1,204 views. Sep 5, 2026. 05/09/2026. © 2026 Acme");
    expect(s).not.toMatch(/2026|10:30|hours ago|1,204/);
    expect(s).toContain("<date>");
    expect(s).toContain("<counter>");
  });

  it("leaves prices alone", () => {
    expect(normaliseVolatile("Pro £49/month, Team £129/month")).toBe("Pro £49/month, Team £129/month");
  });

  it("replaces nonces and long tokens", () => {
    expect(normaliseVolatile("id=3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c")).toBe("id=<hex>");
  });
});
