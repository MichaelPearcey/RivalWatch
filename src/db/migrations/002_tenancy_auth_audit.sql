-- Phase 1: multi-tenancy, auth, monitoring status, confirmation, feedback, discovery, email, audit.

-- ---------- Tenancy ----------
CREATE TABLE accounts (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  plan           TEXT NOT NULL DEFAULT 'free',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE users (
  id             INTEGER PRIMARY KEY,
  account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role           TEXT NOT NULL DEFAULT 'owner',      -- owner | member
  is_admin       INTEGER NOT NULL DEFAULT 0,         -- platform operator (owner dashboard)
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at  TEXT
);
CREATE INDEX idx_users_account ON users(account_id);

-- Legacy account for any rows created before tenancy existed (dev/demo databases).
INSERT INTO accounts (id, name, plan) VALUES (1, 'Legacy', 'pro');

ALTER TABLE businesses      ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE competitors     ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE monitored_pages ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE snapshots       ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE changes         ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE insights        ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE events          ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;

UPDATE businesses SET account_id = 1 WHERE account_id IS NULL;
UPDATE competitors SET account_id = 1 WHERE account_id IS NULL;
UPDATE monitored_pages SET account_id = 1 WHERE account_id IS NULL;
UPDATE snapshots SET account_id = 1 WHERE account_id IS NULL;
UPDATE changes SET account_id = 1 WHERE account_id IS NULL;
UPDATE insights SET account_id = 1 WHERE account_id IS NULL;

CREATE INDEX idx_businesses_account ON businesses(account_id);
CREATE INDEX idx_competitors_account ON competitors(account_id);
CREATE INDEX idx_pages_account ON monitored_pages(account_id);
CREATE INDEX idx_snapshots_account ON snapshots(account_id);
CREATE INDEX idx_changes_account ON changes(account_id);
CREATE INDEX idx_insights_account ON insights(account_id, created_at DESC);
CREATE INDEX idx_events_account ON events(account_id, ts DESC);

-- Plan now lives on the account; keep businesses.plan for backwards compatibility but unused.

-- ---------- Auth ----------
CREATE TABLE login_tokens (
  id          INTEGER PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL COLLATE NOCASE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  request_ip  TEXT
);
CREATE INDEX idx_login_tokens_email ON login_tokens(email, created_at DESC);

CREATE TABLE sessions (
  id          INTEGER PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE api_keys (
  id           INTEGER PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,                        -- e.g. "support-agent"; becomes actor "agent:<name>"
  key_hash     TEXT NOT NULL UNIQUE,
  key_prefix   TEXT NOT NULL,                        -- first 8 chars for display
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT,
  revoked_at   TEXT
);
CREATE INDEX idx_api_keys_account ON api_keys(account_id);

-- ---------- Monitoring status ----------
-- ACTIVE | ROBOTS_BLOCKED | AUTH_REQUIRED | RATE_LIMITED | FETCH_ERROR | CONTENT_UNREADABLE | PAUSED
ALTER TABLE monitored_pages ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE monitored_pages ADD COLUMN status_message TEXT;
ALTER TABLE monitored_pages ADD COLUMN status_since TEXT;
UPDATE monitored_pages SET status = 'PAUSED' WHERE enabled = 0;

-- ---------- Confirm on next fetch ----------
-- analysis_status gains: pending_confirmation | discarded_unconfirmed
ALTER TABLE changes ADD COLUMN confirm_after TEXT;      -- earliest time a confirming fetch is meaningful
ALTER TABLE changes ADD COLUMN confirmed_at TEXT;

-- ---------- Insight cost + feedback ----------
ALTER TABLE insights ADD COLUMN estimated_cost_usd REAL;

CREATE TABLE insight_feedback (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  insight_id  INTEGER NOT NULL REFERENCES insights(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verdict     TEXT NOT NULL,                          -- useful | not_useful | incorrect | too_noisy
  comment     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(insight_id, user_id)
);
CREATE INDEX idx_feedback_insight ON insight_feedback(insight_id);

-- ---------- Page discovery ----------
CREATE TABLE page_suggestions (
  id            INTEGER PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  competitor_id INTEGER NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  kind          TEXT NOT NULL,
  reason        TEXT,
  score         REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'suggested',   -- suggested | accepted | dismissed
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(competitor_id, url)
);
CREATE INDEX idx_suggestions_competitor ON page_suggestions(competitor_id, status);

-- ---------- Email ----------
CREATE TABLE emails (
  id           INTEGER PRIMARY KEY,
  account_id   INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  to_address   TEXT NOT NULL,
  kind         TEXT NOT NULL,                        -- magic_link | weekly_digest | test
  subject      TEXT NOT NULL,
  provider     TEXT NOT NULL,                        -- log | resend
  provider_id  TEXT,
  status       TEXT NOT NULL,                        -- sent | failed | logged
  error        TEXT,
  body_text    TEXT,                                 -- stored for the log provider / debugging
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_emails_account ON emails(account_id, created_at DESC);

ALTER TABLE businesses ADD COLUMN digest_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE businesses ADD COLUMN next_digest_at TEXT;
ALTER TABLE businesses ADD COLUMN last_digest_at TEXT;

-- ---------- Structured audit fields on events ----------
-- type = action. entity_type/entity_id = target. payload = metadata. ts = timestamp.
ALTER TABLE events ADD COLUMN risk_level         TEXT NOT NULL DEFAULT 'low';   -- low | medium | high
ALTER TABLE events ADD COLUMN requested_by       TEXT;                          -- actor who asked, if different from actor
ALTER TABLE events ADD COLUMN approved_by        TEXT;                          -- for approval-gated actions
ALTER TABLE events ADD COLUMN result             TEXT NOT NULL DEFAULT 'ok';    -- ok | failed | pending | denied | skipped
ALTER TABLE events ADD COLUMN estimated_cost_usd REAL;
CREATE INDEX idx_events_result ON events(result, ts DESC);
