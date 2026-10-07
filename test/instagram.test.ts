import { afterEach, describe, expect, it } from "vitest";
import type { MonitoredPage } from "../src/db/repo.js";
import { InstagramSource, instagramHandle } from "../src/sources/instagram/index.js";
import { externalHosts, json, login, testApp } from "./helpers.js";

const DISCOVERY = {
  business_discovery: {
    username: "olika.dance.studio",
    name: "OLIKA dance studio",
    biography: "Танцювальна студія в Одесі",
    followers_count: 3641,
    media_count: 244,
    media: {
      data: [
        { caption: "Jazz Funk — абонемент на 8 занять: 1700 грн", timestamp: "2026-10-01T10:00:00+0000", permalink: "https://www.instagram.com/p/A/", like_count: 40, comments_count: 3 },
        { timestamp: "2026-09-20T10:00:00+0000", permalink: "https://www.instagram.com/p/B/" },
        { caption: "Пробне тренування 200 грн", timestamp: "2026-09-10T10:00:00+0000", permalink: "https://www.instagram.com/p/C/" },
      ],
    },
    id: "17841401441775531",
  },
  id: "17841400000000000",
};

function graph(reply: unknown, status = 200): { fetchImpl: typeof fetch; calls: { url: URL; auth: string | null }[] } {
  const calls: { url: URL; auth: string | null }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(input instanceof Request ? input.url : input.toString()), auth: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify(reply), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const source = (fetchImpl: typeof fetch, connected = true) =>
  new InstagramSource({ token: connected ? "test-token" : undefined, userId: "17841400000000000", graphVersion: "v25.0", timeoutMs: 1000, fetchImpl });
const page = (url: string) => ({ url, source_type: "instagram" }) as MonitoredPage;

describe("Instagram profile links", () => {
  it("reads the handle from profile links and refuses post links", () => {
    expect(instagramHandle("https://www.instagram.com/olika.dance.studio/?hl=uk")).toBe("olika.dance.studio");
    expect(instagramHandle("https://instagram.com/Viter_Dance")).toBe("viter_dance");
    expect(instagramHandle("https://www.instagram.com/p/DTsRF5tiB9B/")).toBeNull();
    expect(instagramHandle("https://example.com/olika")).toBeNull();
  });
});

describe("InstagramSource (Meta Business Discovery)", () => {
  it("asks Meta as our own account, with the token in a header, and reads captions newest first", async () => {
    const g = graph(DISCOVERY);
    const out = await source(g.fetchImpl).fetch(page("https://www.instagram.com/olika.dance.studio/"));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(g.calls[0]!.url.hostname).toBe("graph.facebook.com");
    expect(g.calls[0]!.url.pathname).toBe("/v25.0/17841400000000000");
    expect(g.calls[0]!.url.searchParams.get("fields")).toContain("business_discovery.username(olika.dance.studio)");
    expect(g.calls[0]!.url.search).not.toContain("test-token");
    expect(g.calls[0]!.auth).toBe("Bearer test-token");
    expect(out.title).toBe("OLIKA dance studio (@olika.dance.studio)");
    expect(out.text.indexOf("1700 грн")).toBeLessThan(out.text.indexOf("200 грн"));
    expect(out.text).not.toContain("3641");
    expect(out.meta).toMatchObject({ followers: 3641, mediaCount: 244, prices: ["1700грн", "200грн"] });
  });

  it("says plainly when an account is personal or missing", async () => {
    const out = await source(graph({ error: { message: "Invalid user id", code: 110 } }, 400).fetchImpl).fetch(page("https://www.instagram.com/someone/"));
    expect(out).toMatchObject({ ok: false, reason: "auth_required" });
    if (!out.ok) expect(out.message).toMatch(/Business and Creator/);
  });

  it("maps an expired token and Meta rate limits", async () => {
    const expired = await source(graph({ error: { message: "Session has expired", code: 190 } }, 400).fetchImpl).fetch(page("https://instagram.com/a"));
    expect(expired).toMatchObject({ ok: false, reason: "auth_required" });
    const limited = await source(graph({ error: { message: "Application request limit reached", code: 4 } }, 400).fetchImpl).fetch(page("https://instagram.com/a"));
    expect(limited).toMatchObject({ ok: false, reason: "rate_limited" });
  });

  it("does not call Meta without a token, or for a post link", async () => {
    const g = graph(DISCOVERY);
    expect(await source(g.fetchImpl, false).fetch(page("https://instagram.com/a"))).toMatchObject({ ok: false, reason: "auth_required" });
    expect(await source(g.fetchImpl).fetch(page("https://www.instagram.com/p/DTsRF5tiB9B/"))).toMatchObject({ ok: false, reason: "content_unreadable" });
    expect(g.calls).toHaveLength(0);
  });
});

describe("Instagram competitors in the app", () => {
  let t: ReturnType<typeof testApp>;
  afterEach(() => {
    delete externalHosts["graph.facebook.com"];
    t?.app.close();
  });

  it("routes an Instagram link to the Meta source and snapshots its captions", async () => {
    externalHosts["graph.facebook.com"] = () => new Response(JSON.stringify(DISCOVERY), { status: 200 });
    t = testApp({ META_IG_TOKEN: "test-token", META_IG_USER_ID: "17841400000000000" });
    const session = await login(t.web, "owner@rivalwatch.test");
    const business = (await json<{ id: number }>(t.web, "/api/businesses", { method: "POST", session, body: JSON.stringify({ name: "Viter" }) })).body;
    const created = await json<{ pages: { id: number; source_type: string }[] }>(t.web, `/api/businesses/${business.id}/competitors`, {
      method: "POST",
      session,
      body: JSON.stringify({ name: "OLIKA", website: "https://www.instagram.com/olika.dance.studio/", discover: false }),
    });
    expect(created.body.pages.map((p) => p.source_type)).toEqual(["instagram"]);

    const scan = await json<{ status: string }[]>(t.web, `/api/businesses/${business.id}/scan`, { method: "POST", session });
    expect(scan.body.map((r) => r.status)).toEqual(["first_snapshot"]);
    expect(t.app.repo.latestSnapshot(created.body.pages[0]!.id)?.text).toContain("1700 грн");
  });
});
