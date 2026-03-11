# Auto-Active Course Polling Design

**Goal:** Eliminate manual `is_active` management by having the cron handler automatically detect when courses open and close for the season.

**Architecture:** Two-tier polling within the existing 5-minute cron schedule. Active courses get the full dynamic-frequency treatment. Inactive courses get a lightweight hourly probe of today + tomorrow. Promotion and demotion happen automatically based on tee time results.

---

## Schema

### Migration 0003

Add `last_had_tee_times TEXT` to `courses`. This timestamp records the most recent time any poll for this course returned tee times (any date). Used for the 30-day deactivation check.

Set all existing courses to `is_active = 1` as a fresh start.

Leave the existing unused `last_active_check` column alone — not worth a destructive schema change.

---

## Cron Handler — Two-Tier Polling

The cron handler fetches ALL courses (not just `is_active = 1`), plus their last poll times from `poll_log`. It then splits into two paths:

### Active courses (`is_active = 1`)

Same as today: 7-date polling at dynamic frequency (5min peak → 60min overnight). No changes.

### Inactive courses (`is_active = 0`)

- Check `poll_log` for last poll time. If >= 1 hour since last poll, probe today + tomorrow only.
- Use the same `pollCourse()` function — no new polling logic needed.
- If either date returns tee times (pollCourse returns `"success"`):
  - `UPDATE courses SET is_active = 1, last_had_tee_times = <now> WHERE id = <id>`
  - Takes effect next cron cycle (5 minutes later). No full 7-date poll in the same run.

### `last_had_tee_times` updates

After each `pollCourse()` call (for active OR inactive courses), if the return value is `"success"` (meaning tee_time_count > 0), the cron handler runs:

```sql
UPDATE courses SET last_had_tee_times = <now> WHERE id = <id>
```

This happens per-course, during the polling loop, before the deactivation check.

### Deactivation check (runs AFTER all polling)

A single UPDATE query at the end of the cron run:

```sql
UPDATE courses SET is_active = 0
WHERE is_active = 1
  AND (last_had_tee_times IS NULL OR last_had_tee_times < datetime('now', '-30 days'))
```

Because `last_had_tee_times` is updated during polling (before this check runs), a course that just returned tee times won't be falsely deactivated.

### Return value

Add `inactiveProbeCount` to the cron handler's return for observability:

```typescript
{ pollCount: number; courseCount: number; inactiveProbeCount: number; skipped: boolean }
```

---

## Seed Script — Idempotent Upsert

### Problem

The current seed script does `DELETE FROM tee_times; DELETE FROM poll_log; DELETE FROM courses;` then re-inserts. Running this on every deploy would:

1. Reset `is_active` and `last_had_tee_times` (defeating auto-management)
2. Wipe all cached tee times and poll history

### Fix

Change to UPSERT. The generated SQL for each course:

```sql
INSERT INTO courses (id, name, city, platform, platform_config, booking_url)
VALUES ('theodore-wirth-18', 'Theodore Wirth', 'Minneapolis', 'cps_golf', '{"subdomain":"..."}', 'https://...')
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  city = excluded.city,
  platform = excluded.platform,
  platform_config = excluded.platform_config,
  booking_url = excluded.booking_url;
```

Key details:
- `is_active` is NOT in the INSERT column list or UPDATE clause. New courses get `is_active = 1` from the column default. Existing courses keep their current value.
- `last_had_tee_times` is NOT touched. New courses get NULL (column default). Existing courses keep their current value.
- `tee_times` and `poll_log` tables are NOT wiped.
- Courses removed from `courses.json` remain as orphan rows in D1. Per CLAUDE.md, we never hard-delete courses (CASCADE destroys user_favorites/booking_clicks). Orphans are harmless: they deactivate after 30 days, then probe hourly forever returning nothing.

---

## `courses.json` Changes

Remove all `is_active` fields from every course entry. `is_active` is now a runtime-only D1 field managed by the cron handler, not a catalog property.

---

## `/courses` Page Changes

- Remove `is_active` from the `CatalogCourse` interface
- Remove the `(inactive)` label rendering logic

Since `is_active` is now a polling implementation detail (not a user-facing concept), the courses page shows all courses identically. Courses with no availability simply show no tee times on their detail page.

---

## Deploy Pipeline

Add two steps to `.github/workflows/deploy.yml` after "Apply D1 migrations" and before "Deploy Worker":

```yaml
- name: Seed course catalog
  run: npx tsx scripts/seed.ts && npx wrangler d1 execute tee-times-db --remote --file=scripts/seed.sql
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

This ensures D1 reflects `courses.json` on every deploy without disrupting runtime state.

---

## Not in Scope

- Orphan course cleanup (rare, handle with one-off migration if needed)
- UI indication of polling status (revisit when useful)
- Admin override to force-deactivate a course (add if needed, one UPDATE query)
- Dropping the unused `last_active_check` column
