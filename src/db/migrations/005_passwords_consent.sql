-- Optional password login (scrypt) alongside magic links; consent/legal acceptance records; account deletion.

ALTER TABLE users ADD COLUMN password_hash TEXT;            -- scrypt$N$r$p$salt$hash (base64url), NULL = passwordless only
ALTER TABLE users ADD COLUMN password_set_at TEXT;
ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;

-- What each user agreed to and when (UK GDPR: demonstrable consent / contract basis).
CREATE TABLE consents (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document    TEXT NOT NULL,                 -- terms | privacy | marketing
  version     TEXT NOT NULL,                 -- e.g. 2026-09-06
  accepted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ip          TEXT,
  UNIQUE(user_id, document, version)
);

-- Soft-delete window before hard deletion (right to erasure, with a short grace period against mistakes).
ALTER TABLE accounts ADD COLUMN deletion_requested_at TEXT;
ALTER TABLE accounts ADD COLUMN delete_after TEXT;
