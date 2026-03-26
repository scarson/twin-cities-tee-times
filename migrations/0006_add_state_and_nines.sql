-- ABOUTME: Adds state column to courses and nines column to tee_times.
-- ABOUTME: Supports geographic sorting and multi-nine courses (e.g., Bunker Hills).

-- Add state column to courses for geographic sorting
ALTER TABLE courses ADD COLUMN state TEXT NOT NULL DEFAULT 'MN';

-- Add nines column to tee_times for multi-nine courses (e.g., Bunker Hills)
ALTER TABLE tee_times ADD COLUMN nines TEXT;
