-- Per-course booking horizon: how many days out this course publishes tee times.
-- Ratchet-up only: auto-detection increases this value but never decreases it.
ALTER TABLE courses ADD COLUMN booking_horizon_days INTEGER NOT NULL DEFAULT 7;

-- Timestamp of last horizon probe for this course. NULL = never probed.
ALTER TABLE courses ADD COLUMN last_horizon_probe TEXT;
