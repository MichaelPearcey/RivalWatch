-- Agent framework: scheduled, permission-bounded LLM agents.

CREATE TABLE agent_state (
  name          TEXT PRIMARY KEY,             -- support-ops | manager | growth
  enabled       INTEGER NOT NULL DEFAULT 1,
  next_run_at   TEXT,
  last_run_at   TEXT,
  last_status   TEXT,                         -- ok | failed | skipped
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE agent_runs (
  id            INTEGER PRIMARY KEY,
  agent         TEXT NOT NULL,
  started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at   TEXT,
  status        TEXT NOT NULL DEFAULT 'running',   -- running | ok | failed | capped
  trigger       TEXT NOT NULL,                     -- schedule | manual
  model         TEXT,
  turns         INTEGER NOT NULL DEFAULT 0,
  tool_calls    INTEGER NOT NULL DEFAULT 0,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  summary       TEXT,                              -- the agent's final message
  error         TEXT
);
CREATE INDEX idx_agent_runs_agent ON agent_runs(agent, started_at DESC);

-- Agent output that a human reads: ops reports, weekly summaries, content drafts.
CREATE TABLE agent_notes (
  id          INTEGER PRIMARY KEY,
  agent       TEXT NOT NULL,
  run_id      INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  kind        TEXT NOT NULL,                       -- report | draft | recommendation
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  read_at     TEXT
);
CREATE INDEX idx_agent_notes_created ON agent_notes(created_at DESC);
