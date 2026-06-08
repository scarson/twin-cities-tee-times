-- Records whether a poll changed the stored tee times (1) or was a no-op skip (0).
-- Lets us measure the real set-change rate that drives D1 rows-written cost.
ALTER TABLE poll_log ADD COLUMN content_changed INTEGER NOT NULL DEFAULT 0;
