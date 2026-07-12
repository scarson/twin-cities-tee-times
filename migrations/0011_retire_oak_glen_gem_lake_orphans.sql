-- Retire pre-split combined rows orphaned by the Oak Glen / Gem Lake facility
-- split (commit 6ae31fe). They are absent from courses.json so the seed UPSERT
-- never deactivates them; without this they keep polling dead CPS endpoints as
-- silent no_data. disabled=1 (not DELETE) preserves any user_favorites /
-- booking_clicks FKs — see implementation-pitfalls DB-2 and COURSE-4.
UPDATE courses SET disabled = 1 WHERE id IN ('oak-glen', 'gem-lake-hills');
