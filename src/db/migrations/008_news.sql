-- Competitor news: headlines from public news feeds, classified by relevance and magnitude.

CREATE TABLE news_items (
  id               INTEGER PRIMARY KEY,
  account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  competitor_id    INTEGER NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  url              TEXT NOT NULL,
  url_hash         TEXT NOT NULL,                   -- sha256(url) for dedup
  title            TEXT NOT NULL,
  source           TEXT,                            -- publisher name
  published_at     TEXT,
  snippet          TEXT,
  fetched_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- classification
  about_competitor INTEGER,                         -- NULL = unclassified, 1/0
  category         TEXT,                            -- funding | acquisition | launch | partnership | leadership | legal | layoffs | financial | other
  magnitude        INTEGER,                         -- 1..5; >= 4 is "big"
  summary          TEXT,
  why_it_matters   TEXT,
  provider         TEXT,
  classified_at    TEXT,
  alerted_at       TEXT,
  UNIQUE(competitor_id, url_hash)
);
CREATE INDEX idx_news_competitor ON news_items(competitor_id, published_at DESC);
CREATE INDEX idx_news_account_big ON news_items(account_id, magnitude DESC, published_at DESC);

ALTER TABLE competitors ADD COLUMN news_query TEXT;          -- override for the search query (defaults to the quoted name)
ALTER TABLE competitors ADD COLUMN news_checked_at TEXT;
ALTER TABLE competitors ADD COLUMN news_next_at TEXT;
