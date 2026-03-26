-- Manual override to permanently hide a course from polling and UI.
-- Unlike is_active (managed automatically by cron), disabled is set explicitly.
ALTER TABLE courses ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
