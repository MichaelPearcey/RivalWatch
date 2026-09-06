-- Approvals: the human-in-the-loop primitive. Agents (and admins) request consequential actions;
-- a human (tier 3) or the Manager agent (tier 2) decides; the system executes approved requests.

CREATE TABLE approvals (
  id            INTEGER PRIMARY KEY,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  action        TEXT NOT NULL,                -- e.g. account.set_plan, email.send_bulk, prompt.update
  account_id    INTEGER REFERENCES accounts(id) ON DELETE CASCADE,   -- tenant affected, if any
  target_type   TEXT,                         -- account | business | competitor | page | insight | system
  target_id     INTEGER,
  risk_level    TEXT NOT NULL,                -- medium (Manager AI may approve) | high (human only)
  requested_by  TEXT NOT NULL,                -- actor string: user:<id> | agent:<name> | system
  reason        TEXT,                         -- why the requester wants this
  payload       TEXT NOT NULL DEFAULT '{}',   -- action parameters (JSON), validated at execution
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | denied | expired | executed | failed
  decided_by    TEXT,
  decided_at    TEXT,
  decision_note TEXT,
  executed_at   TEXT,
  result        TEXT,                         -- JSON result or error text after execution
  expires_at    TEXT NOT NULL
);
CREATE INDEX idx_approvals_status ON approvals(status, created_at DESC);
CREATE INDEX idx_approvals_account ON approvals(account_id, created_at DESC);
