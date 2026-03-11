-- Re-activate all courses that were incorrectly deactivated.
-- Bug: auto-deactivation WHERE clause included "last_had_tee_times IS NULL",
-- which deactivated courses on their first cron cycle before they had a chance
-- to record any tee times. Combined with the datetime() format mismatch bug,
-- this deactivated every course in production.
UPDATE courses SET is_active = 1;
