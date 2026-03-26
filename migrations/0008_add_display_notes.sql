-- User-facing notes displayed on the course detail page.
-- Set via seed data or automated processes (e.g., seasonal closure detection).
ALTER TABLE courses ADD COLUMN display_notes TEXT;
