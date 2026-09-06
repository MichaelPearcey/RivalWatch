-- Email verification for password sign-ups; AI-generated competitor profiles.
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
-- Everyone who exists already signed in via a magic link, which proves mailbox control.
UPDATE users SET email_verified_at = COALESCE(last_login_at, created_at);

ALTER TABLE competitors ADD COLUMN profile_json TEXT;          -- CompetitorProfile as JSON
ALTER TABLE competitors ADD COLUMN profile_status TEXT NOT NULL DEFAULT 'none'; -- none | pending | ready | failed
ALTER TABLE competitors ADD COLUMN profile_generated_at TEXT;
ALTER TABLE competitors ADD COLUMN profile_error TEXT;
