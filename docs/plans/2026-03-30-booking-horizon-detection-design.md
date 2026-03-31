# Booking Horizon Detection

## Problem

Some courses publish tee times 7 days out, others up to 14 days. The app currently polls a fixed 7-day window for all courses, missing availability that courses publish further out. With the paid Cloudflare Workers plan, we have the subrequest budget to poll further.

## Solution

Auto-detect each course's booking horizon via a weekly probe, store it per-course, and use it to dynamically size the polling window.

## Schema Changes

Migration `0009`: two new columns on `courses`:

```sql
ALTER TABLE courses ADD COLUMN booking_horizon_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE courses ADD COLUMN last_horizon_probe TEXT;
```

- `booking_horizon_days` — how many days out this course publishes tee times. Default 7, ratchets up only (never lowered by auto-detection).
- `last_horizon_probe` — ISO 8601 timestamp of last probe. NULL = never probed.

## Polling Changes

### Per-course date range

`getPollingDates()` accepts the course's `booking_horizon_days` to generate a variable-length date array. The cron handler generates a max-length (14-day) array once, then skips dates beyond each course's horizon.

### Updated frequency tiers

| Date range | Frequency | Overnight (8pm–5am CT) |
|------------|-----------|------------------------|
| Today + tomorrow | Every cycle (5–15 min by time-of-day) | Hourly |
| 2–7 days out | Every 30 min | Hourly |
| 8+ days out | Every 60 min | Hourly |

Previous "days 4-6 hourly" tier is absorbed into the 30-min tier for days 2-7.

## Horizon Probe

### Trigger

Runs during batch 0 housekeeping, once per week per course. A course is eligible when `last_horizon_probe IS NULL` or older than 7 days.

### Logic

For each eligible active course:
1. Scan dates from `booking_horizon_days + 1` through `MAX_HORIZON` (14)
2. If tee times found on day N > current horizon → update `booking_horizon_days = N`
3. Update `last_horizon_probe` to now (whether horizon changed or not)

### Ratchet rule

`booking_horizon_days` only increases, never decreases. Temporary gaps (maintenance, weather, private events) should not shrink a course's known booking window.

### Subrequest cost

Worst case: ~80 courses × 7 dates × ~1.5 avg weight = ~840 subrequests. Well within the 10K paid-plan limit. The probe replaces that cycle's normal polling.

## Manual Trigger

For initial calibration (and rare ad-hoc runs):

```bash
npx wrangler d1 execute tee-times-db --command="UPDATE courses SET last_horizon_probe = NULL"
```

Next overnight batch 0 cycle picks up all courses for probing.

## Constants

```
MAX_HORIZON = 14        # ceiling for probe scanning (bump to 21 later)
PROBE_INTERVAL_DAYS = 7 # re-probe frequency per course
```

Both live in polling code. Changing `MAX_HORIZON` is the only code change needed to extend beyond 14 days.

## About Page

Update frequency table to reflect new tiers and mention that polling extends up to 14 days out for courses that publish availability that far.
