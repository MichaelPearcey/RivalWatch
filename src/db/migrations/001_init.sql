-- RivalWatch initial schema. Plain SQLite. Timestamps are ISO-8601 UTC strings.

CREATE TABLE businesses (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  website       TEXT,
  description   TEXT,            -- what the business does, in the owner's words
  pricing_notes TEXT,            -- the business's own pricing, free text, fed to the analyser
  plan          TEXT NOT NULL DEFAULT 'free',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE competitors (
  id          INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  website     TEXT NOT NULL,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_competitors_business ON competitors(business_id);

CREATE TABLE monitored_pages (
  id                     INTEGER PRIMARY KEY,
  competitor_id          INTEGER NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  source_type            TEXT NOT NULL DEFAULT 'website',   -- website | rss | youtube | instagram ... (adapter key)
  url                    TEXT NOT NULL,
  kind                   TEXT NOT NULL DEFAULT 'other',     -- home | pricing | products | blog | other
  enabled                INTEGER NOT NULL DEFAULT 1,
  check_interval_minutes INTEGER NOT NULL DEFAULT 1440,
  next_check_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_checked_at        TEXT,
  last_status            TEXT,                              -- ok | error | blocked | unchanged
  consecutive_failures   INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(competitor_id, url)
);
CREATE INDEX idx_pages_due ON monitored_pages(enabled, next_check_at);

CREATE TABLE snapshots (
  id            INTEGER PRIMARY KEY,
  page_id       INTEGER NOT NULL REFERENCES monitored_pages(id) ON DELETE CASCADE,
  fetched_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  http_status   INTEGER,
  content_type  TEXT,
  content_hash  TEXT NOT NULL,     -- sha256 of normalised text
  title         TEXT,
  text          TEXT NOT NULL,     -- extracted, normalised main text
  raw_gzip      BLOB,              -- gzipped original body (optional)
  meta_json     TEXT               -- extractor metadata (prices found, word count, ...)
);
CREATE INDEX idx_snapshots_page ON snapshots(page_id, fetched_at DESC);

CREATE TABLE changes (
  id               INTEGER PRIMARY KEY,
  page_id          INTEGER NOT NULL REFERENCES monitored_pages(id) ON DELETE CASCADE,
  from_snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
  to_snapshot_id   INTEGER NOT NULL REFERENCES snapshots(id),
  detected_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  significance     REAL NOT NULL,           -- 0..1 heuristic score from detector
  change_ratio     REAL NOT NULL,           -- fraction of characters changed
  added_json       TEXT NOT NULL,           -- JSON array of added lines
  removed_json     TEXT NOT NULL,           -- JSON array of removed lines
  signals_json     TEXT NOT NULL,           -- JSON array of detector signals (e.g. "price", "promo")
  analysis_status  TEXT NOT NULL DEFAULT 'pending'   -- pending | done | failed | skipped
);
CREATE INDEX idx_changes_page ON changes(page_id, detected_at DESC);

CREATE TABLE insights (
  id             INTEGER PRIMARY KEY,
  business_id    INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  competitor_id  INTEGER NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  change_id      INTEGER NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  matters        INTEGER NOT NULL,          -- 0/1: does this deserve the user's attention
  category       TEXT NOT NULL,             -- pricing | product | promotion | positioning | content | announcement | landing_page | noise | other
  importance     INTEGER NOT NULL,          -- 1..5
  headline       TEXT NOT NULL,
  summary        TEXT NOT NULL,
  why_it_matters TEXT NOT NULL,
  provider       TEXT NOT NULL,             -- heuristic | anthropic
  model          TEXT,
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  read_at        TEXT
);
CREATE INDEX idx_insights_business ON insights(business_id, created_at DESC);
CREATE INDEX idx_insights_change ON insights(change_id);

-- Append-only structured event log: the audit trail and metrics source for humans and agents.
CREATE TABLE events (
  id          INTEGER PRIMARY KEY,
  ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  type        TEXT NOT NULL,                -- dotted, e.g. page.fetched, change.detected, insight.generated, ai.call
  actor       TEXT NOT NULL DEFAULT 'system', -- system | user:<id> | agent:<name>
  entity_type TEXT,                         -- business | competitor | page | snapshot | change | insight
  entity_id   INTEGER,
  payload     TEXT NOT NULL DEFAULT '{}'    -- JSON
);
CREATE INDEX idx_events_ts ON events(ts DESC);
CREATE INDEX idx_events_type ON events(type, ts DESC);
CREATE INDEX idx_events_entity ON events(entity_type, entity_id);
