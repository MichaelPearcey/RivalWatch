-- Per-user language preference (BCP-47 primary tag). Used for UI, emails and AI insight language.
ALTER TABLE users ADD COLUMN locale TEXT;
