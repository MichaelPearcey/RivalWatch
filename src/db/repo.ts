import type { Db } from "./index.js";

// ---------- Row types ----------

export type PageKind = "home" | "pricing" | "products" | "blog" | "other";
export const PAGE_KINDS: PageKind[] = ["home", "pricing", "products", "blog", "other"];

export interface Business {
  id: number;
  name: string;
  website: string | null;
  description: string | null;
  pricing_notes: string | null;
  plan: string;
  created_at: string;
  updated_at: string;
}

export interface Competitor {
  id: number;
  business_id: number;
  name: string;
  website: string;
  notes: string | null;
  created_at: string;
}

export interface MonitoredPage {
  id: number;
  competitor_id: number;
  source_type: string;
  url: string;
  kind: PageKind;
  enabled: number;
  check_interval_minutes: number;
  next_check_at: string;
  last_checked_at: string | null;
  last_status: string | null;
  consecutive_failures: number;
  created_at: string;
}

export interface Snapshot {
  id: number;
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

export interface Change {
  id: number;
  page_id: number;
  from_snapshot_id: number;
  to_snapshot_id: number;
  detected_at: string;
  significance: number;
  change_ratio: number;
  added_json: string;
  removed_json: string;
  signals_json: string;
  analysis_status: "pending" | "done" | "failed" | "skipped";
}

export type InsightCategory =
  | "pricing"
  | "product"
  | "promotion"
  | "positioning"
  | "content"
  | "announcement"
  | "landing_page"
  | "noise"
  | "other";

export interface Insight {
  id: number;
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
  read_at: string | null;
}

// ---------- Repository ----------

export class Repo {
  constructor(readonly db: Db) {}

  // Businesses
  createBusiness(input: { name: string; website?: string; description?: string; pricing_notes?: string; plan?: string }): Business {
    const r = this.db
      .prepare(
        `INSERT INTO businesses (name, website, description, pricing_notes, plan) VALUES (?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(input.name, input.website ?? null, input.description ?? null, input.pricing_notes ?? null, input.plan ?? "free");
    return r as unknown as Business;
  }
  getBusiness(id: number): Business | undefined {
    return this.db.prepare("SELECT * FROM businesses WHERE id = ?").get(id) as Business | undefined;
  }
  listBusinesses(): Business[] {
    return this.db.prepare("SELECT * FROM businesses ORDER BY id").all() as unknown as Business[];
  }
  updateBusiness(id: number, patch: Partial<Pick<Business, "name" | "website" | "description" | "pricing_notes" | "plan">>): Business | undefined {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (keys.length === 0) return this.getBusiness(id);
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    return this.db
      .prepare(`UPDATE businesses SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? RETURNING *`)
      .get(...keys.map((k) => patch[k] ?? null), id) as Business | undefined;
  }

  // Competitors
  createCompetitor(input: { business_id: number; name: string; website: string; notes?: string }): Competitor {
    return this.db
      .prepare(`INSERT INTO competitors (business_id, name, website, notes) VALUES (?, ?, ?, ?) RETURNING *`)
      .get(input.business_id, input.name, input.website, input.notes ?? null) as unknown as Competitor;
  }
  getCompetitor(id: number): Competitor | undefined {
    return this.db.prepare("SELECT * FROM competitors WHERE id = ?").get(id) as Competitor | undefined;
  }
  listCompetitors(businessId: number): Competitor[] {
    return this.db.prepare("SELECT * FROM competitors WHERE business_id = ? ORDER BY id").all(businessId) as unknown as Competitor[];
  }
  countCompetitors(businessId: number): number {
    return (this.db.prepare("SELECT COUNT(*) c FROM competitors WHERE business_id = ?").get(businessId) as { c: number }).c;
  }
  deleteCompetitor(id: number): boolean {
    return this.db.prepare("DELETE FROM competitors WHERE id = ?").run(id).changes > 0;
  }

  // Pages
  createPage(input: {
    competitor_id: number;
    url: string;
    kind?: PageKind;
    source_type?: string;
    check_interval_minutes?: number;
  }): MonitoredPage {
    return this.db
      .prepare(
        `INSERT INTO monitored_pages (competitor_id, url, kind, source_type, check_interval_minutes)
         VALUES (?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        input.competitor_id,
        input.url,
        input.kind ?? "other",
        input.source_type ?? "website",
        input.check_interval_minutes ?? 1440,
      ) as unknown as MonitoredPage;
  }
  getPage(id: number): MonitoredPage | undefined {
    return this.db.prepare("SELECT * FROM monitored_pages WHERE id = ?").get(id) as MonitoredPage | undefined;
  }
  listPages(competitorId: number): MonitoredPage[] {
    return this.db.prepare("SELECT * FROM monitored_pages WHERE competitor_id = ? ORDER BY id").all(competitorId) as unknown as MonitoredPage[];
  }
  listAllPages(): MonitoredPage[] {
    return this.db.prepare("SELECT * FROM monitored_pages ORDER BY id").all() as unknown as MonitoredPage[];
  }
  duePages(now: string, limit: number): MonitoredPage[] {
    return this.db
      .prepare("SELECT * FROM monitored_pages WHERE enabled = 1 AND next_check_at <= ? ORDER BY next_check_at LIMIT ?")
      .all(now, limit) as unknown as MonitoredPage[];
  }
  markPageChecked(id: number, status: string, nextCheckAt: string, failed: boolean): void {
    this.db
      .prepare(
        `UPDATE monitored_pages SET last_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), last_status = ?,
         next_check_at = ?, consecutive_failures = CASE WHEN ? THEN consecutive_failures + 1 ELSE 0 END WHERE id = ?`,
      )
      .run(status, nextCheckAt, failed ? 1 : 0, id);
  }
  setPageEnabled(id: number, enabled: boolean): void {
    this.db.prepare("UPDATE monitored_pages SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  }
  deletePage(id: number): boolean {
    return this.db.prepare("DELETE FROM monitored_pages WHERE id = ?").run(id).changes > 0;
  }

  // Snapshots
  latestSnapshot(pageId: number): Snapshot | undefined {
    return this.db
      .prepare("SELECT * FROM snapshots WHERE page_id = ? ORDER BY fetched_at DESC, id DESC LIMIT 1")
      .get(pageId) as Snapshot | undefined;
  }
  getSnapshot(id: number): Snapshot | undefined {
    return this.db.prepare("SELECT * FROM snapshots WHERE id = ?").get(id) as Snapshot | undefined;
  }
  listSnapshots(pageId: number, limit = 50): Omit<Snapshot, "raw_gzip" | "text">[] {
    return this.db
      .prepare(
        `SELECT id, page_id, fetched_at, last_seen_at, http_status, content_type, content_hash, title, meta_json
         FROM snapshots WHERE page_id = ? ORDER BY fetched_at DESC LIMIT ?`,
      )
      .all(pageId, limit) as unknown as Omit<Snapshot, "raw_gzip" | "text">[];
  }
  createSnapshot(input: {
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
        `INSERT INTO snapshots (page_id, http_status, content_type, content_hash, title, text, raw_gzip, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        input.page_id,
        input.http_status,
        input.content_type,
        input.content_hash,
        input.title,
        input.text,
        input.raw_gzip,
        JSON.stringify(input.meta),
      ) as unknown as Snapshot;
  }
  touchSnapshot(id: number): void {
    this.db.prepare("UPDATE snapshots SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(id);
  }

  // Changes
  createChange(input: {
    page_id: number;
    from_snapshot_id: number;
    to_snapshot_id: number;
    significance: number;
    change_ratio: number;
    added: string[];
    removed: string[];
    signals: string[];
  }): Change {
    return this.db
      .prepare(
        `INSERT INTO changes (page_id, from_snapshot_id, to_snapshot_id, significance, change_ratio, added_json, removed_json, signals_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        input.page_id,
        input.from_snapshot_id,
        input.to_snapshot_id,
        input.significance,
        input.change_ratio,
        JSON.stringify(input.added),
        JSON.stringify(input.removed),
        JSON.stringify(input.signals),
      ) as unknown as Change;
  }
  getChange(id: number): Change | undefined {
    return this.db.prepare("SELECT * FROM changes WHERE id = ?").get(id) as Change | undefined;
  }
  listChanges(pageId: number, limit = 50): Change[] {
    return this.db.prepare("SELECT * FROM changes WHERE page_id = ? ORDER BY detected_at DESC LIMIT ?").all(pageId, limit) as unknown as Change[];
  }
  setChangeStatus(id: number, status: Change["analysis_status"]): void {
    this.db.prepare("UPDATE changes SET analysis_status = ? WHERE id = ?").run(status, id);
  }

  // Insights
  createInsight(input: Omit<Insight, "id" | "created_at" | "read_at">): Insight {
    return this.db
      .prepare(
        `INSERT INTO insights (business_id, competitor_id, change_id, matters, category, importance, headline, summary, why_it_matters, provider, model, input_tokens, output_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
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
      ) as unknown as Insight;
  }
  getInsight(id: number): Insight | undefined {
    return this.db.prepare("SELECT * FROM insights WHERE id = ?").get(id) as Insight | undefined;
  }
  listInsights(businessId: number, opts: { includeNoise?: boolean; limit?: number } = {}): Insight[] {
    const where = opts.includeNoise ? "" : "AND matters = 1";
    return this.db
      .prepare(`SELECT * FROM insights WHERE business_id = ? ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(businessId, opts.limit ?? 100) as unknown as Insight[];
  }
  markInsightRead(id: number): void {
    this.db.prepare("UPDATE insights SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND read_at IS NULL").run(id);
  }
  deleteInsightsForChange(changeId: number): void {
    this.db.prepare("DELETE FROM insights WHERE change_id = ?").run(changeId);
  }

  /** Joins needed by the pipeline: page -> competitor -> business. */
  pageContext(pageId: number): { page: MonitoredPage; competitor: Competitor; business: Business } | undefined {
    const page = this.getPage(pageId);
    if (!page) return undefined;
    const competitor = this.getCompetitor(page.competitor_id);
    if (!competitor) return undefined;
    const business = this.getBusiness(competitor.business_id);
    if (!business) return undefined;
    return { page, competitor, business };
  }
}
