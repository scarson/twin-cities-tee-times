# Data Freshness & Polling Overhaul Design

**Date:** 2026-03-13
**Status:** Approved

## Problem

Users see misleading freshness information and encounter empty states that look like "no tee times available" when the real issue is "never checked this date." Specific problems:

1. **Course-level "Last updated X ago" is misleading.** The timestamp reflects the most recent poll for any date, but dates further out may have never been polled. A user seeing "Last updated just now" with "No tee times found" for next Tuesday has no reason to suspect the data is simply missing.

2. **Only 7 days of data.** Users who pick dates beyond the 7-day polling window see "No tee times found" with no way to get data short of manually refreshing each date.

3. **Refresh button is ambiguous.** "Refresh" suggests refreshing the whole course, but it only polls the currently selected dates. The rate limiter (30s per-course cooldown) means only the first date actually polls when multiple are selected.

4. **Manual refresh is too central to the workflow.** Users shouldn't need to think about data freshness for dates within the next month. The system should proactively have data ready.

## Design

Four changes address these problems:

### 1. Tiered Polling — Extend to 30 Days

Replace the current 7-date polling window with a 30-day window using frequency tiers:

| Day offset | Frequency (peak 5-10am CT) | Frequency (off-peak) | Rationale |
|-----------|---------------------------|---------------------|-----------|
| 0–2 | Every 5 min (every cron cycle) | Same as cron cycle | Today/tomorrow change rapidly |
| 3–7 | Every 15 min | Every 30 min | Near-term, moderate churn |
| 8–14 | Every 2 hours | Every 4 hours | Stable, low churn |
| 15–30 | Twice daily (~12hr) | Twice daily | Very stable, just need baseline |

**Changes required:**
- `getPollingDates()`: generate 30 dates instead of 7
- `shouldPollDate()`: replace current 3-tier logic with 4-tier logic above
- No schema changes needed

**Execution budget at peak:** ~5.1 dates/course/cycle × 16 active courses ≈ 82 API calls per 5-min cron cycle. At 250ms sleep + ~500ms fetch = ~60s wall clock. Well within the Worker cron 15-minute limit. Upstream APIs see ~1.3 req/sec (CPS Golf's 5 req/sec limit is the tightest).

### 2. Auto-Fetch on View (Course Detail Page Only)

When the tee-times API returns no cached data for a specific course+date, transparently poll the upstream API before responding.

**Scope:** Course detail page only. The time-first view (all courses × one date) must NOT auto-fetch — 16 sequential API calls would take 12+ seconds. On the time-first view, rely on cron data; if a course has no data for a date, omit it silently.

**Dedup logic:** Check `poll_log` for the specific course+date (not the per-course cooldown used by manual refresh):
- If `poll_log` has a recent entry for this course+date → return cached result (even if empty, it's genuinely empty)
- If `poll_log` has no entry → auto-fetch, upsert results, return fresh data
- "Recent" threshold: match the tier frequency for the date offset (e.g., 15 min for days 3-7, 2hr for days 8-14)

**Rate limiting:** Auto-fetch respects the global rate limit (20 polls/min) but uses per-date dedup instead of per-course cooldown. This allows fetching multiple dates for the same course in quick succession.

**Dates beyond 30 days:** Auto-fetch is the only source of data for days 31-60. Cap the date picker at 60 days maximum. Most courses don't post availability beyond 14-30 days, so this gracefully degrades to "no tee times found" for distant dates.

**Response time:** Auto-fetch adds 1-3 seconds to the first request for an uncached date. The UI already shows a loading spinner while fetching. This only happens once per course+date until the next poll cycle.

### 3. Freshness Display Overhaul

**Remove:** The persistent "Last updated X ago" timestamp from the course header. It's course-level and misleading for date-scoped data.

**Keep:** The >1hr stale warning at the tee-time-list level. Individual tee times already have a `fetched_at` timestamp. When `fetched_at` is older than 1 hour, show a subtle warning (e.g., amber indicator or "Data may be stale" note) next to the affected tee times.

**Add:** Toast confirmation when manual refresh completes. Brief, non-blocking, confirms the action ran. Example: "Refreshed tee times for Mar 15" or "Refreshed tee times for Mar 15–17."

**"No data" vs "never checked" distinction:** When a date has been polled (poll_log entry exists) but returned no results, show "No tee times available for this date." When a date has never been polled and auto-fetch is not applicable (time-first view), show "Data not yet available for this date" or omit the course from results.

### 4. Refresh Button Changes

**Label:** Change "Refresh" to "Refresh selected dates" to set correct expectations.

**Behavior:** Unchanged — fires parallel POSTs for each selected date, subject to the existing per-course 30s cooldown and global 20/min limit. The first date polls; subsequent dates within the cooldown get 429 (treated as success since data is fresh).

**Cooldown UI:** Unchanged — 30s client-side cooldown hides the button after a refresh.

### 5. Date Picker Cap

Cap the date picker at 60 days from today. Cron covers days 0-30; auto-fetch covers days 31-60. Beyond 60 days, courses rarely have availability posted and the data would be unreliable.

## What Doesn't Change

- **Per-course 30s cooldown** for manual refresh (unchanged)
- **Global 20 polls/min** rate limit (unchanged)
- **Database schema** — no new tables or columns needed
- **Cron schedule** — still fires every 5 minutes, `shouldRunThisCycle` unchanged
- **250ms sleep between API calls** in cron (unchanged)
- **poll_log 7-day purge** — sufficient since frequency decisions only need recent data

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Auto-fetch adds latency to first view of uncached dates | Only 1-3s, happens once per course+date, loading spinner already exists |
| Write side effects in GET tee-times endpoint | Pragmatic for app's scale; well-documented; only fires when poll_log has no entry |
| 30-day polling increases cron execution time | Budget analysis shows ~60s at peak, well within 15-min Worker limit |
| Upstream API tolerance with more polling | ~1.3 req/sec at peak, well under CPS Golf's 5 req/sec limit |
| Auto-fetch race condition (two users request same uncached date simultaneously) | poll_log dedup prevents double-fetch; worst case is one redundant poll |
