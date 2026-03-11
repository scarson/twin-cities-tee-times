-- Drop unused last_active_check column (superseded by last_had_tee_times in 0003).
ALTER TABLE courses DROP COLUMN last_active_check;
