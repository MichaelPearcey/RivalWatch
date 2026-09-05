import type { Db } from "./index.js";

// ---------- Row types ----------

export type PageKind = "home" | "pricing" | "products" | "blog" | "other";
export const PAGE_KINDS: PageKind[] = ["home", "pricing", "products", "blog", "other"];

/** Monitoring health of a page. Never treat a non-ACTIVE page as healthy. */
export type PageStatus = "ACTIVE" | "ROBOTS_BLOCKED" | "AUTH_REQUIRED" | "RATE_LIMITED" | "FETCH_ERROR" | "CONTENT_UNREADABLE" | "PAUSED";
export const PAGE_STATUSES: PageStatus[] = ["ACTIVE", "ROBOTS_BLOCKED", "AUTH_REQUIRED", "RATE_LIMITED", "FETCH_ERROR", "CONTENT_UNREADABLE", "PAUSED"];

export interface Account {
  id: number;
  name: string;
  plan: string;
  created_at: string;
}

export interface User {
  id: number;
  account_id: number;
  email: string;
  role: "owner" | "member";
  is_admin: number;
  created_at: string;
  last_login_at: string | null;
}

export interface Business {
  id: number;
  account_id: number;
  name: string;
  website: string | null;
  description: string | null;
  pricing_notes: string | null;
  plan: string;
  digest_enabled: number;
  next_digest_at: string | null;
  last_digest_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Competitor {
  id: number;
  account_id: number;
  business_id: number;
  name: string;
  website: string;
  notes: string | null;
  created_at: string;
}

export interface MonitoredPage {
  id: number;
  account_id: number;
  competitor_id: number;
  source_type: string;
  url: string;
  kind: PageKind;
  enabled: number;
  status: PageStatus;
  status_message: string | null;
  status_since: string | null;
  check_interval_minutes: number;
  next_check_at: string;
  last_checked_at: string | null;
  last_status: string | null;
  consecutive_failures: number;
  created_at: string;
}

export interface Snapshot {
  id: number;
  account_id: number;
  page_id: number;
  fetched_at: string;
  last_seen_at: string;
  http_status: number | null;
  content_type: string | null;
  content_hash: string;
  title: string | null;
  text: string;
  raw_gzip: Uint8Array | null;
  meta_json: string | null;
}

export type ChangeStatus = "pending" | "pending_confirmation" | "discarded_unconfirmed" | "done" | "failed" | "skipped";

export interface Change {
  id: number;
  account_id: number;
  page_id: number;
  from_snapshot_id: number;
  to_snapshot_id: number;
  detected_at: string;
  significance: number;
  change_ratio: number;
  added_json: string;
  removed_json: string;
  signals_json: string;
  analysis_status: ChangeStatus;
  confirm_after: string | null;
  confirmed_at: string | null;
}

export type InsightCategory = "pricing" | "product" | "promotion" | "positioning" | "content" | "announcement" | "landing_page" | "noise" | "other";

export interface Insight {
  id: number;
  account_id: number;
  business_id: number;
  competitor_id: number;
  change_id: number;
  created_at: string;
  matters: number;
  category: InsightCategory;
  importance: number;
  headline: string;
  summary: string;
  why_it_matters: string;
  provider: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  read_at: string | null;
}

export type FeedbackVerdict = "useful" | "not_useful" | "incorrect" | "too_noisy";
export const FEEDBACK_VERDICTS: FeedbackVerdict[] = ["useful", "not_useful", "incorrect", "too_noisy"];

export interface InsightFeedback {
  id: number;
  account_id: number;
  insight_id: number;
  user_id: number | null;
  verdict: FeedbackVerdict;
  comment: string | null;
  created_at: string;
}

export interface PageSuggestion {
  id: number;
  account_id: number;
  competitor_id: number;
  url: string;
  kind: PageKind;
  reason: string | null;
  score: number;
  status: "suggested" | "accepted" | "dismissed";
  created_at: string;
}

export interface ApiKey {
  id: number;
  account_id: number;
  user_id: number;
  name: string;
  key_hash: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface EmailRow {
  id: number;
  account_id: number | null;
  to_address: string;
  kind: string;
  subject: string;
  provider: string;
  provider_id: string | null;
  status: string;
  error: string | null;
  body_text: string | null;
  created_at: string;
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

// ---------- Repository ----------
//
// Convention: every read of a tenant-owned entity takes an accountId and the
// SQL filters on it. Cross-tenant reads are impossible by construction unless a
// method is explicitly named *Any (used only by the scheduler and admin views).

export class Repo {
  constructor(readonly db: Db) {}

  // Accounts & users
  createAccount(input: { name: string; plan?: string }): Account {
    return this.db.prepare(`INSERT INTO accounts (name, plan) VALUES (?, ?) RETURNING *`).get(input.name, input.plan ?? "free") as unknown as Account;
  }
  getAccount(id: number): Account | undefined {
    return this.db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as Account | undefined;
  }
  listAccounts(): Account[] {
    return this.db.prepare("SELECT * FROM accounts ORDER BY id").all() as unknown as Account[];
  }
  updateAccountPlan(id: number, plan: string): void {
    this.db.prepare("UPDATE accounts SET plan = ? WHERE id = ?").run(plan, id);
  }
  createUser(input: { account_id: number; email: string; role?: User["role"]; is_admin?: boolean }): User {
    return this.db
      .prepare(`INSERT INTO users (account_id, email, role, is_admin) VALUES (?, ?, ?, ?) RETURNING *`)
      .get(input.account_id, input.email.toLowerCase(), input.role ?? "owner", input.is_admin ? 1 : 0) as unknown as User;
  }
  getUser(id: number): User | undefined {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
  }
  getUserByEmail(email: string): User | undefined {
    return this.db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase()) as User | undefined;
  }
  listUsers(accountId?: number): User[] {
    return accountId === undefined
      ? (this.db.prepare("SELECT * FROM users ORDER BY id").all() as unknown as User[])
      : (this.db.prepare("SELECT * FROM users WHERE account_id = ? ORDER BY id").all(accountId) as unknown as User[]);
  }
  /** Admin is granted (never silently revoked) here; revocation is an explicit operator action. */
  touchUserLogin(id: number, grantAdmin: boolean): void {
    this.db.prepare(`UPDATE users SET last_login_at = ${NOW}, is_admin = CASE WHEN ? THEN 1 ELSE is_admin END WHERE id = ?`).run(grantAdmin ? 1 : 0, id);
  }

  // Businesses
  createBusiness(input: { account_id: number; name: string; website?: string; description?: string; pricing_notes?: string }): Business {
    return this.db
      .prepare(`INSERT INTO businesses (account_id, name, website, description, pricing_notes, plan) VALUES (?, ?, ?, ?, ?, 'n/a') RETURNING *`)
      .get(input.account_id, input.name, input.website ?? null, input.description ?? null, input.pricing_notes ?? null) as unknown as Business;
  }
  getBusiness(accountId: number, id: number): Business | undefined {
    return this.db.prepare("SELECT * FROM businesses WHERE id = ? AND account_id = ?").get(id, accountId) as Business | undefined;
  }
  getBusinessAny(id: number): Business | undefined {
    return this.db.prepare("SELECT * FROM businesses WHERE id = ?").get(id) as Business | undefined;
  }
  listBusinesses(accountId: number): Business[] {
    return this.db.prepare("SELECT * FROM businesses WHERE account_id = ? ORDER BY id").all(accountId) as unknown as Business[];
  }
  listBusinessesAny(): Business[] {
    return this.db.prepare("SELECT * FROM businesses ORDER BY id").all() as unknown as Business[];
  }
  updateBusiness(accountId: number, id: number, patch: Partial<Pick<Business, "name" | "website" | "description" | "pricing_notes" | "digest_enabled">>): Business | undefined {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (keys.length === 0) return this.getBusiness(accountId, id);
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    return this.db
      .prepare(`UPDATE businesses SET ${sets}, updated_at = ${NOW} WHERE id = ? AND account_id = ? RETURNING *`)
      .get(...keys.map((k) => patch[k] ?? null), id, accountId) as Business | undefined;
  }
  deleteBusiness(accountId: number, id: number): boolean {
    return this.db.prepare("DELETE FROM businesses WHERE id = ? AND account_id = ?").run(id, accountId).changes > 0;
  }
  businessesDueForDigest(now: string): Business[] {
    return this.db
      .prepare("SELECT * FROM businesses WHERE digest_enabled = 1 AND next_digest_at IS NOT NULL AND next_digest_at <= ? ORDER BY next_digest_at LIMIT 50")
      .all(now) as unknown as Business[];
  }
  setDigestSchedule(id: number, next: string, sentNow: boolean): void {
    this.db.prepare(`UPDATE businesses SET next_digest_at = ?, last_digest_at = CASE WHEN ? THEN ${NOW} ELSE last_digest_at END WHERE id = ?`).run(next, sentNow ? 1 : 0, id);
  }

  // Competitors
  createCompetitor(input: { account_id: number; business_id: number; name: string; website: string; notes?: string }): Competitor {
    return this.db
      .prepare(`INSERT INTO competitors (account_id, business_id, name, website, notes) VALUES (?, ?, ?, ?, ?) RETURNING *`)
      .get(input.account_id, input.business_id, input.name, input.website, input.notes ?? null) as unknown as Competitor;
  }
  getCompetitor(accountId: number, id: number): Competitor | undefined {
    return this.db.prepare("SELECT * FROM competitors WHERE id = ? AND account_id = ?").get(id, accountId) as Competitor | undefined;
  }
  listCompetitors(accountId: number, businessId: number): Competitor[] {
    return this.db.prepare("SELECT * FROM competitors WHERE business_id = ? AND account_id = ? ORDER BY id").all(businessId, accountId) as unknown as Competitor[];
  }
  countCompetitors(accountId: number): number {
    return (this.db.prepare("SELECT COUNT(*) c FROM competitors WHERE account_id = ?").get(accountId) as { c: number }).c;
  }
  deleteCompetitor(accountId: number, id: number): boolean {
    return this.db.prepare("DELETE FROM competitors WHERE id = ? AND account_id = ?").run(id, accountId).changes > 0;
  }

  // Pages
  createPage(input: { account_id: number; competitor_id: number; url: string; kind?: PageKind; source_type?: string; check_interval_minutes?: number }): MonitoredPage {
    return this.db
      .prepare(
        `INSERT INTO monitored_pages (account_id, competitor_id, url, kind, source_type, check_interval_minutes, status_since)
         VALUES (?, ?, ?, ?, ?, ?, ${NOW}) RETURNING *`,
      )
      .get(input.account_id, input.competitor_id, input.url, input.kind ?? "other", input.source_type ?? "website", input.check_interval_minutes ?? 1440) as unknown as MonitoredPage;
  }
  getPage(accountId: number, id: number): MonitoredPage | undefined {
    return this.db.prepare("SELECT * FROM monitored_pages WHERE id = ? AND account_id = ?").get(id, accountId) as MonitoredPage | undefined;
  }
  getPageAny(id: number): MonitoredPage | undefined {
    return this.db.prepare("SELECT * FROM monitored_pages WHERE id = ?").get(id) as MonitoredPage | undefined;
  }
  listPages(accountId: number, competitorId: number): MonitoredPage[] {
    return this.db.prepare("SELECT * FROM monitored_pages WHERE competitor_id = ? AND account_id = ? ORDER BY id").all(competitorId, accountId) as unknown as MonitoredPage[];
  }
  listPagesAny(opts: { status?: PageStatus; limit?: number } = {}): MonitoredPage[] {
    const where = opts.status ? "WHERE status = ?" : "";
    const params: (string | number)[] = opts.status ? [opts.status, opts.limit ?? 500] : [opts.limit ?? 500];
    return this.db.prepare(`SELECT * FROM monitored_pages ${where} ORDER BY status_since DESC LIMIT ?`).all(...params) as unknown as MonitoredPage[];
  }
  countPagesByStatus(): Record<string, number> {
    const rows = this.db.prepare("SELECT status, COUNT(*) c FROM monitored_pages GROUP BY status").all() as unknown as { status: string; c: number }[];
    return Object.fromEntries(rows.map((r) => [r.status, r.c]));
  }
  duePages(now: string, limit: number): MonitoredPage[] {
    return this.db
      .prepare("SELECT * FROM monitored_pages WHERE enabled = 1 AND next_check_at <= ? ORDER BY next_check_at LIMIT ?")
      .all(now, limit) as unknown as MonitoredPage[];
  }
  markPageChecked(id: number, input: { lastStatus: string; nextCheckAt: string; failed: boolean; status: PageStatus; statusMessage: string | null }): void {
    this.db
      .prepare(
        `UPDATE monitored_pages SET
           last_checked_at = ${NOW}, last_status = ?, next_check_at = ?,
           consecutive_failures = CASE WHEN ? THEN consecutive_failures + 1 ELSE 0 END,
           status_since = CASE WHEN status = ? THEN status_since ELSE ${NOW} END,
           status = ?, status_message = ?
         WHERE id = ?`,
      )
      .run(input.lastStatus, input.nextCheckAt, input.failed ? 1 : 0, input.status, input.status, input.statusMessage, id);
  }
  setPageEnabled(accountId: number, id: number, enabled: boolean): void {
    this.db
      .prepare(
        `UPDATE monitored_pages SET enabled = ?, status = ?, status_since = ${NOW}, status_message = NULL,
         next_check_at = CASE WHEN ? THEN ${NOW} ELSE next_check_at END WHERE id = ? AND account_id = ?`,
      )
      .run(enabled ? 1 : 0, enabled ? "ACTIVE" : "PAUSED", enabled ? 1 : 0, id, accountId);
  }
  schedulePageCheck(id: number, at: string): void {
    this.db.prepare("UPDATE monitored_pages SET next_check_at = MIN(next_check_at, ?) WHERE id = ?").run(at, id);
  }
  deletePage(accountId: number, id: number): boolean {
    return this.db.prepare("DELETE FROM monitored_pages WHERE id = ? AND account_id = ?").run(id, accountId).changes > 0;
  }

  // Snapshots
  latestSnapshot(pageId: number): Snapshot | undefined {
    return this.db.prepare("SELECT * FROM snapshots WHERE page_id = ? ORDER BY fetched_at DESC, id DESC LIMIT 1").get(pageId) as Snapshot | undefined;
  }
  getSnapshot(accountId: number, id: number): Snapshot | undefined {
    return this.db.prepare("SELECT * FROM snapshots WHERE id = ? AND account_id = ?").get(id, accountId) as Snapshot | undefined;
  }
  listSnapshots(accountId: number, pageId: number, limit = 50): Omit<Snapshot, "raw_gzip" | "text">[] {
    return this.db
      .prepare(
        `SELECT id, account_id, page_id, fetched_at, last_seen_at, http_status, content_type, content_hash, title, meta_json
         FROM snapshots WHERE page_id = ? AND account_id = ? ORDER BY fetched_at DESC LIMIT ?`,
      )
      .all(pageId, accountId, limit) as unknown as Omit<Snapshot, "raw_gzip" | "text">[];
  }
  createSnapshot(input: {
    account_id: number;
    page_id: number;
    http_status: number | null;
    content_type: string | null;
    content_hash: string;
    title: string | null;
    text: string;
    raw_gzip: Uint8Array | null;
    meta: Record<string, unknown>;
  }): Snapshot {
    return this.db
      .prepare(
        `INSERT INTO snapshots (account_id, page_id, http_status, content_type, content_hash, title, text, raw_gzip, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(input.account_id, input.page_id, input.http_status, input.content_type, input.content_hash, input.title, input.text, input.raw_gzip, JSON.stringify(input.meta)) as unknown as Snapshot;
  }
  touchSnapshot(id: number): void {
    this.db.prepare(`UPDATE snapshots SET last_seen_at = ${NOW} WHERE id = ?`).run(id);
  }

  // Changes
  createChange(input: {
    account_id: number;
    page_id: number;
    from_snapshot_id: number;
    to_snapshot_id: number;
    significance: number;
    change_ratio: number;
    added: string[];
    removed: string[];
    signals: string[];
    analysis_status: ChangeStatus;
    confirm_after: string | null;
  }): Change {
    return this.db
      .prepare(
        `INSERT INTO changes (account_id, page_id, from_snapshot_id, to_snapshot_id, significance, change_ratio, added_json, removed_json, signals_json, analysis_status, confirm_after)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        input.account_id,
        input.page_id,
        input.from_snapshot_id,
        input.to_snapshot_id,
        input.significance,
        input.change_ratio,
        JSON.stringify(input.added),
        JSON.stringify(input.removed),
        JSON.stringify(input.signals),
        input.analysis_status,
        input.confirm_after,
      ) as unknown as Change;
  }
  getChange(accountId: number, id: number): Change | undefined {
    return this.db.prepare("SELECT * FROM changes WHERE id = ? AND account_id = ?").get(id, accountId) as Change | undefined;
  }
  getChangeAny(id: number): Change | undefined {
    return this.db.prepare("SELECT * FROM changes WHERE id = ?").get(id) as Change | undefined;
  }
  listChanges(accountId: number, pageId: number, limit = 50): Change[] {
    return this.db.prepare("SELECT * FROM changes WHERE page_id = ? AND account_id = ? ORDER BY detected_at DESC LIMIT ?").all(pageId, accountId, limit) as unknown as Change[];
  }
  pendingConfirmation(pageId: number): Change | undefined {
    return this.db
      .prepare("SELECT * FROM changes WHERE page_id = ? AND analysis_status = 'pending_confirmation' ORDER BY detected_at DESC LIMIT 1")
      .get(pageId) as Change | undefined;
  }
  setChangeStatus(id: number, status: ChangeStatus, confirmed = false): void {
    this.db.prepare(`UPDATE changes SET analysis_status = ?, confirmed_at = CASE WHEN ? THEN ${NOW} ELSE confirmed_at END WHERE id = ?`).run(status, confirmed ? 1 : 0, id);
  }

  // Insights
  createInsight(input: Omit<Insight, "id" | "created_at" | "read_at">): Insight {
    return this.db
      .prepare(
        `INSERT INTO insights (account_id, business_id, competitor_id, change_id, matters, category, importance, headline, summary, why_it_matters, provider, model, input_tokens, output_tokens, estimated_cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        input.account_id,
        input.business_id,
        input.competitor_id,
        input.change_id,
        input.matters,
        input.category,
        input.importance,
        input.headline,
        input.summary,
        input.why_it_matters,
        input.provider,
        input.model,
        input.input_tokens,
        input.output_tokens,
        input.estimated_cost_usd,
      ) as unknown as Insight;
  }
  getInsight(accountId: number, id: number): Insight | undefined {
    return this.db.prepare("SELECT * FROM insights WHERE id = ? AND account_id = ?").get(id, accountId) as Insight | undefined;
  }
  listInsights(accountId: number, businessId: number, opts: { includeNoise?: boolean; limit?: number; since?: string } = {}): Insight[] {
    const clauses = ["business_id = ?", "account_id = ?"];
    const params: (string | number)[] = [businessId, accountId];
    if (!opts.includeNoise) clauses.push("matters = 1");
    if (opts.since) {
      clauses.push("created_at >= ?");
      params.push(opts.since);
    }
    params.push(opts.limit ?? 100);
    return this.db.prepare(`SELECT * FROM insights WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...params) as unknown as Insight[];
  }
  markInsightRead(accountId: number, id: number): void {
    this.db.prepare(`UPDATE insights SET read_at = ${NOW} WHERE id = ? AND account_id = ? AND read_at IS NULL`).run(id, accountId);
  }
  deleteInsightsForChange(changeId: number): void {
    this.db.prepare("DELETE FROM insights WHERE change_id = ?").run(changeId);
  }

  // Feedback
  upsertFeedback(input: { account_id: number; insight_id: number; user_id: number | null; verdict: FeedbackVerdict; comment?: string }): InsightFeedback {
    return this.db
      .prepare(
        `INSERT INTO insight_feedback (account_id, insight_id, user_id, verdict, comment) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(insight_id, user_id) DO UPDATE SET verdict = excluded.verdict, comment = excluded.comment, created_at = ${NOW}
         RETURNING *`,
      )
      .get(input.account_id, input.insight_id, input.user_id, input.verdict, input.comment ?? null) as unknown as InsightFeedback;
  }
  feedbackForInsights(accountId: number, insightIds: number[]): Record<number, InsightFeedback[]> {
    if (insightIds.length === 0) return {};
    const rows = this.db
      .prepare(`SELECT * FROM insight_feedback WHERE account_id = ? AND insight_id IN (${insightIds.map(() => "?").join(",")})`)
      .all(accountId, ...insightIds) as unknown as InsightFeedback[];
    const out: Record<number, InsightFeedback[]> = {};
    for (const r of rows) (out[r.insight_id] ??= []).push(r);
    return out;
  }
  feedbackCounts(since?: string): Record<string, number> {
    const rows = (since
      ? this.db.prepare("SELECT verdict, COUNT(*) c FROM insight_feedback WHERE created_at >= ? GROUP BY verdict").all(since)
      : this.db.prepare("SELECT verdict, COUNT(*) c FROM insight_feedback GROUP BY verdict").all()) as unknown as { verdict: string; c: number }[];
    return Object.fromEntries(rows.map((r) => [r.verdict, r.c]));
  }

  // Page suggestions
  upsertSuggestion(input: { account_id: number; competitor_id: number; url: string; kind: PageKind; reason: string; score: number }): PageSuggestion | undefined {
    return this.db
      .prepare(
        `INSERT INTO page_suggestions (account_id, competitor_id, url, kind, reason, score) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(competitor_id, url) DO NOTHING RETURNING *`,
      )
      .get(input.account_id, input.competitor_id, input.url, input.kind, input.reason, input.score) as PageSuggestion | undefined;
  }
  listSuggestions(accountId: number, competitorId: number, status: PageSuggestion["status"] = "suggested"): PageSuggestion[] {
    return this.db
      .prepare("SELECT * FROM page_suggestions WHERE competitor_id = ? AND account_id = ? AND status = ? ORDER BY score DESC, id")
      .all(competitorId, accountId, status) as unknown as PageSuggestion[];
  }
  getSuggestion(accountId: number, id: number): PageSuggestion | undefined {
    return this.db.prepare("SELECT * FROM page_suggestions WHERE id = ? AND account_id = ?").get(id, accountId) as PageSuggestion | undefined;
  }
  setSuggestionStatus(id: number, status: PageSuggestion["status"]): void {
    this.db.prepare("UPDATE page_suggestions SET status = ? WHERE id = ?").run(status, id);
  }

  // Auth
  createLoginToken(tokenHash: string, email: string, expiresAt: string, ip: string | null): void {
    this.db.prepare("INSERT INTO login_tokens (token_hash, email, expires_at, request_ip) VALUES (?, ?, ?, ?)").run(tokenHash, email.toLowerCase(), expiresAt, ip);
  }
  countRecentLoginTokens(email: string, since: string): number {
    return (this.db.prepare("SELECT COUNT(*) c FROM login_tokens WHERE email = ? AND created_at >= ?").get(email.toLowerCase(), since) as { c: number }).c;
  }
  consumeLoginToken(tokenHash: string, now: string): { email: string } | undefined {
    return this.db
      .prepare(`UPDATE login_tokens SET used_at = ${NOW} WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email`)
      .get(tokenHash, now) as { email: string } | undefined;
  }
  createSession(tokenHash: string, userId: number, expiresAt: string): void {
    this.db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(tokenHash, userId, expiresAt);
  }
  sessionUser(tokenHash: string, now: string): User | undefined {
    const row = this.db
      .prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`)
      .get(tokenHash, now) as User | undefined;
    if (row) this.db.prepare(`UPDATE sessions SET last_seen_at = ${NOW} WHERE token_hash = ?`).run(tokenHash);
    return row;
  }
  deleteSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }
  purgeExpiredAuth(now: string): void {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    this.db.prepare("DELETE FROM login_tokens WHERE expires_at <= ?").run(now);
  }
  createApiKey(input: { account_id: number; user_id: number; name: string; key_hash: string; key_prefix: string }): ApiKey {
    return this.db
      .prepare("INSERT INTO api_keys (account_id, user_id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?, ?) RETURNING *")
      .get(input.account_id, input.user_id, input.name, input.key_hash, input.key_prefix) as unknown as ApiKey;
  }
  apiKeyByHash(keyHash: string): (ApiKey & { user: User }) | undefined {
    const key = this.db.prepare("SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL").get(keyHash) as ApiKey | undefined;
    if (!key) return undefined;
    const user = this.getUser(key.user_id);
    if (!user) return undefined;
    this.db.prepare(`UPDATE api_keys SET last_used_at = ${NOW} WHERE id = ?`).run(key.id);
    return { ...key, user };
  }
  listApiKeys(accountId: number): ApiKey[] {
    return this.db.prepare("SELECT * FROM api_keys WHERE account_id = ? ORDER BY id").all(accountId) as unknown as ApiKey[];
  }
  revokeApiKey(accountId: number, id: number): boolean {
    return this.db.prepare(`UPDATE api_keys SET revoked_at = ${NOW} WHERE id = ? AND account_id = ? AND revoked_at IS NULL`).run(id, accountId).changes > 0;
  }

  // Emails
  recordEmail(input: Omit<EmailRow, "id" | "created_at">): EmailRow {
    return this.db
      .prepare(
        `INSERT INTO emails (account_id, to_address, kind, subject, provider, provider_id, status, error, body_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(input.account_id, input.to_address, input.kind, input.subject, input.provider, input.provider_id, input.status, input.error, input.body_text) as unknown as EmailRow;
  }
  listEmails(opts: { accountId?: number; limit?: number } = {}): EmailRow[] {
    return opts.accountId === undefined
      ? (this.db.prepare("SELECT * FROM emails ORDER BY id DESC LIMIT ?").all(opts.limit ?? 100) as unknown as EmailRow[])
      : (this.db.prepare("SELECT * FROM emails WHERE account_id = ? ORDER BY id DESC LIMIT ?").all(opts.accountId, opts.limit ?? 100) as unknown as EmailRow[]);
  }

  /** Joins needed by the pipeline: page -> competitor -> business -> account. Not tenant-checked (scheduler use). */
  pageContext(pageId: number): { page: MonitoredPage; competitor: Competitor; business: Business; account: Account } | undefined {
    const page = this.getPageAny(pageId);
    if (!page) return undefined;
    const competitor = this.getCompetitor(page.account_id, page.competitor_id);
    if (!competitor) return undefined;
    const business = this.getBusiness(page.account_id, competitor.business_id);
    if (!business) return undefined;
    const account = this.getAccount(page.account_id);
    if (!account) return undefined;
    return { page, competitor, business, account };
  }

  count(sql: string, ...params: (string | number)[]): number {
    return (this.db.prepare(sql).get(...params) as { c: number }).c;
  }
}
