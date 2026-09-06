-- Founder bot: shared memory between humans, the in-app founder assistant and the engineering agent (Devin),
-- plus persisted chat conversations.

CREATE TABLE memory_notes (
  id          INTEGER PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  author      TEXT NOT NULL,                -- user:<id> | agent:founder | agent:devin | system
  kind        TEXT NOT NULL,                -- fact | decision | request | journal | preference
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  tags        TEXT NOT NULL DEFAULT '',     -- comma-separated, lowercase
  status      TEXT NOT NULL DEFAULT 'open', -- open | done | superseded
  source      TEXT                          -- conversation id, session id, url...
);
CREATE INDEX idx_memory_created ON memory_notes(created_at DESC);
CREATE INDEX idx_memory_kind_status ON memory_notes(kind, status);

CREATE TABLE founder_conversations (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  title       TEXT,
  model       TEXT,
  turns       INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0
);

CREATE TABLE founder_messages (
  id              INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES founder_conversations(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  role            TEXT NOT NULL,            -- user | assistant | tool
  content         TEXT NOT NULL,            -- text for user/assistant; JSON for tool activity log
  tool_calls      INTEGER NOT NULL DEFAULT 0,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_founder_messages_conv ON founder_messages(conversation_id, id);
