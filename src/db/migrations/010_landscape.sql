-- AI-generated "competitor landscape" document: one per business, regenerated on request.
CREATE TABLE landscapes (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'none',        -- none | pending | ready | failed
  doc_json TEXT,                               -- LandscapeDoc as JSON
  provider TEXT,
  competitor_count INTEGER NOT NULL DEFAULT 0,
  generated_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_landscapes_account ON landscapes(account_id);
