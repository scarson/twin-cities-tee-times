-- Add timestamp for tracking when a course last returned tee times.
-- Used by the cron handler to auto-deactivate courses after 30 days of no results.
ALTER TABLE courses ADD COLUMN last_had_tee_times TEXT;

-- Fresh start: activate all courses so the auto-management system can take over.
UPDATE courses SET is_active = 1;
