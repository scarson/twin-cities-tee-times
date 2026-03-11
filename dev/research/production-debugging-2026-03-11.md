# Production Debugging: CPS Golf 525 + Staleness Investigation (2026-03-11)

## Trigger

After deploying the datetime fix (sqliteIsoNow) and course reactivation migration (0005), CPS Golf courses showed "No tee times found" despite the CPS Golf website having availability. Oceanside Muni (ForeUp) showed "Last updated 1h ago" but tee times marked "stale (9h old)".

## Investigation Method

1. **Live API testing from local machine** — ran CPS debug script (`scripts/debug-cps.ts`) and curl against ForeUp API
2. **Production database queries** — `wrangler d1 execute --remote` to inspect poll_log and courses tables
3. **Browser Network tab** — user verified refresh endpoint response (500 Internal Server Error)
4. **SSL/DNS analysis** — openssl s_client + nslookup to inspect CPS Golf infrastructure

## Findings

### Finding 1: CPS Golf Has NEVER Worked in Production

All three CPS SD test courses have a 100% error rate since deployment:

| Course | Errors | Successes | No Data |
|--------|--------|-----------|---------|
| sd-encinitas-ranch | 153 | 0 | 0 |
| sd-rancho-bernardo-inn | 152 | 0 | 0 |
| sd-twin-oaks | 150 | 0 | 0 |

**Error message:** `CPS Golf token request failed: HTTP 525`

HTTP 525 = SSL Handshake Failed. The CPS Golf token endpoint rejects TLS connections from Cloudflare Worker egress IPs.

### Finding 2: CPS Golf Infrastructure

- **DNS:** `jcgsc5.cps.golf` → `34.168.248.63` (GCP us-west1)
- **Load balancer:** F5 BIG-IP (detected via `V4COOKIE` in response headers)
- **SSL cert:** Let's Encrypt wildcard `*.cps.golf`, TLS 1.3, valid (verified locally)
- **Local adapter test:** Works perfectly — token, transaction registration, tee time fetch all succeed

The F5 BIG-IP load balancer is rejecting TLS connections from Cloudflare Workers' shared egress IP ranges. This is a common enterprise WAF/LB behavior to block requests from known CDN/cloud platforms.

### Finding 3: ForeUp and TeeItUp Work Fine

| Course | Platform | Successes | No Data | Errors |
|--------|----------|-----------|---------|--------|
| sd-balboa-park | ForeUp | 580 | 123 | 57 |
| sd-goat-hill | ForeUp | 614 | 70 | 80 |
| sd-oceanside | ForeUp | 569 | 120 | 75 |
| sd-lomas-santa-fe | TeeItUp | 79 | 2 | 60 |
| sd-coronado | TeeItUp | 3 | 73 | 64 |

### Finding 4: Oceanside Staleness Explained (Not a Bug)

The "stale (9h old)" display was expected behavior:
- ForeUp returns empty (`[]`) for Oceanside at end of day (all times past/booked)
- The 9h-old `fetched_at` was from the last poll that found actual tee times
- "Last updated 1h ago" came from a successful poll for a different date (the courses API shows the most recent success across all dates)
- Once the cron polls today with empty results, `upsertTeeTimes` deletes the stale rows → "No tee times found"

### Finding 5: Datetime Fix Working Correctly

Production database confirmed:
- All courses have `is_active = 1` (migration 0005 applied)
- CPS courses have `last_had_tee_times = null` (never succeeded) and are NOT being deactivated (IS NOT NULL guard works)
- ForeUp/TeeItUp courses have fresh `last_had_tee_times` timestamps
- Rate limiting works correctly (no more permanent 429 from format mismatch)

## UX Issues Identified (Separate from CPS 525)

### "Last updated" only counts successful polls

The courses API queries `poll_log WHERE status = 'success'`. When a course has no tee times (`no_data` polls), "Last updated" shows nothing. This creates confusing UX:
1. User clicks Refresh → poll runs → returns `no_data` → UI shows "Last updated just now" (client state)
2. User reloads page → server has no `success` poll → shows "Refresh now" instead

**Proposed fix:** Include `no_data` polls in the "Last updated" query. Users should know when we last checked, regardless of whether data was found.

### Rate limiter blocks multi-date refresh

The per-course cooldown (30 seconds) checks ANY date for that course. When the UI fires 7 parallel refresh requests (one per selected date), only the first succeeds — the rest get 429'd.

**Proposed fix:** Either make the refresh endpoint accept multiple dates in one request, or change the rate limiter to per-course-per-date.

## Impact: CPS Golf Is Our Largest Platform

**13 of 22 Twin Cities courses use CPS Golf** — the majority of the catalog. None will work from Cloudflare Workers until the 525 issue is resolved.

Affected TC courses: Theodore Wirth, Gross National, Meadowbrook, Columbia, Hiawatha, Phalen, Chaska Town Course, Edinburgh USA, Oak Glen, Highland National, Como Park, Victory Links, Gem Lake Hills.

6 of the 11 courses on the father-in-law's favorites list are CPS Golf (Theodore Wirth, Gross National, Meadowbrook, Columbia, Phalen, Chaska Town Course).

## CPS Golf 525: Resolution Options

1. **Proxy CPS requests** through a non-Cloudflare service (AWS Lambda, VPS, etc.)
2. **Cloudflare Workers fetch options** — investigate if custom TLS settings or `cf` fetch properties can help
3. **Alternative CPS Golf access** — check if CPS has a different API endpoint or if their v4 API (older) works from Workers
4. **Accept the limitation** and focus on ForeUp/TeeItUp platforms first

## Key Diagnostic Queries

```sql
-- Check poll error messages for a course
SELECT course_id, date, polled_at, status, error_message
FROM poll_log WHERE course_id = 'sd-encinitas-ranch'
ORDER BY polled_at DESC LIMIT 5;

-- Poll stats by course and status
SELECT course_id, status, COUNT(*) as cnt
FROM poll_log WHERE course_id LIKE 'sd-%'
GROUP BY course_id, status ORDER BY course_id, status;

-- Course activation status
SELECT id, is_active, last_had_tee_times
FROM courses WHERE id LIKE 'sd-%' ORDER BY id;
```
