import type { MonitoredPage } from "../../db/repo.js";
import { moneyPattern } from "../../money.js";
import type { FetchOutcome, Source } from "../types.js";

export interface InstagramConfig {
  token?: string | undefined;
  /** Our own Instagram professional account; Business Discovery runs as this account. */
  userId?: string | undefined;
  graphVersion: string;
  fetchImpl?: typeof fetch;
  timeoutMs: number;
}

/** Paths on instagram.com that are not a profile handle. */
const NOT_A_HANDLE = new Set(["p", "reel", "reels", "tv", "stories", "explore", "accounts", "direct", "about", "developer", "legal"]);

export function isInstagramUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "instagram.com" || host.endsWith(".instagram.com");
  } catch {
    return false;
  }
}

/** `https://www.instagram.com/olika.dance.studio/?hl=uk` -> `olika.dance.studio`; null for post/reel links. */
export function instagramHandle(url: string): string | null {
  if (!isInstagramUrl(url)) return null;
  const first = new URL(url).pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  if (!first || NOT_A_HANDLE.has(first) || !/^[a-z0-9._]{1,30}$/.test(first)) return null;
  return first;
}

interface GraphMedia {
  caption?: string;
  timestamp?: string;
  permalink?: string;
  like_count?: number;
  comments_count?: number;
}

interface GraphDiscovery {
  username?: string;
  name?: string;
  biography?: string;
  website?: string;
  followers_count?: number;
  media_count?: number;
  media?: { data?: GraphMedia[] };
}

interface GraphError {
  message?: string;
  code?: number;
  error_subcode?: number;
}

const MEDIA_LIMIT = 25;

/**
 * Public data of another Instagram Business/Creator account via Meta's Business
 * Discovery API, read as our own professional account. Never touches instagram.com.
 */
export class InstagramSource implements Source {
  readonly type = "instagram";
  constructor(private readonly cfg: InstagramConfig) {}

  get configured(): boolean {
    return Boolean(this.cfg.token && this.cfg.userId);
  }

  async fetch(page: MonitoredPage): Promise<FetchOutcome> {
    const handle = instagramHandle(page.url);
    if (!handle) return { ok: false, reason: "content_unreadable", status: null, message: "not an Instagram profile link; add the profile address, e.g. instagram.com/studio_name" };
    if (!this.configured) return { ok: false, reason: "auth_required", status: null, message: "Instagram is not connected yet (META_IG_TOKEN / META_IG_USER_ID)" };

    const fields = `business_discovery.username(${handle}){username,name,biography,website,followers_count,media_count,media.limit(${MEDIA_LIMIT}){caption,timestamp,permalink,like_count,comments_count}}`;
    const url = new URL(`https://graph.facebook.com/${this.cfg.graphVersion}/${this.cfg.userId}`);
    url.searchParams.set("fields", fields);
    const doFetch = this.cfg.fetchImpl ?? fetch;

    let status: number;
    let body: { business_discovery?: GraphDiscovery; error?: GraphError };
    try {
      const res = await doFetch(url, { headers: { authorization: `Bearer ${this.cfg.token}` }, signal: AbortSignal.timeout(this.cfg.timeoutMs) });
      status = res.status;
      body = (await res.json()) as typeof body;
    } catch (err) {
      const e = err as Error;
      return { ok: false, reason: "fetch_error", status: null, message: e.name === "TimeoutError" || e.name === "AbortError" ? "timeout" : e.message };
    }

    if (body.error) return failure(status, body.error);
    const d = body.business_discovery;
    if (!d) return { ok: false, reason: "fetch_error", status, message: "Instagram returned no profile data" };

    const posts = d.media?.data ?? [];
    const text = [
      d.biography?.trim(),
      ...posts.filter((m) => m.caption?.trim()).map((m) => `${m.timestamp?.slice(0, 10) ?? ""}\n${m.caption!.trim()}`),
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!text) return { ok: false, reason: "content_unreadable", status, message: "the profile has no bio or captions to read (prices may be in images)" };

    const prices = [...new Set((text.match(moneyPattern()) ?? []).map((p) => p.replace(/\s+/g, "")))];
    return {
      ok: true,
      status,
      contentType: "application/json",
      title: d.name ? `${d.name} (@${d.username ?? handle})` : `@${d.username ?? handle}`,
      text,
      raw: JSON.stringify(d),
      meta: {
        wordCount: text.split(/\s+/).filter(Boolean).length,
        prices,
        username: d.username ?? handle,
        followers: d.followers_count ?? null,
        mediaCount: d.media_count ?? null,
        website: d.website ?? null,
        posts: posts.map((m) => ({ permalink: m.permalink ?? null, timestamp: m.timestamp ?? null, likes: m.like_count ?? null, comments: m.comments_count ?? null })),
      },
    };
  }
}

/** Graph error codes: https://developers.facebook.com/docs/graph-api/guides/error-handling */
function failure(status: number, e: GraphError): FetchOutcome {
  const code = e.code ?? 0;
  const message = e.message ?? `Graph API error ${code}`;
  if ([4, 17, 32, 613].includes(code)) return { ok: false, reason: "rate_limited", status, message };
  if (code === 190) return { ok: false, reason: "auth_required", status, message: "the Instagram connection expired; the account owner must renew the Meta token" };
  if (code === 10 || code === 200) return { ok: false, reason: "auth_required", status, message: "the Meta app is missing a permission (instagram_manage_insights)" };
  // Meta answers a personal, missing or age-gated account the same way ("Invalid user id").
  if (code === 110 || code === 100) return { ok: false, reason: "auth_required", status, message: "this Instagram account is personal, private or does not exist; Instagram only shares Business and Creator accounts" };
  return { ok: false, reason: "fetch_error", status, message };
}
