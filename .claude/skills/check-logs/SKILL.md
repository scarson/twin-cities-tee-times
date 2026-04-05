---
name: check-logs
description: Use when checking production polling health, adapter errors, or course failures. Use when asked to "check logs", "check for errors", "production health", "polling status", or "are there any errors".
---

# Check Production Logs

Query the D1 `poll_log` table via wrangler to check production polling health. **Do NOT use `wrangler tail`** -- it only streams real-time events and requires waiting for cron cycles.

## Before You Start

**Always use `--remote`** -- without it, wrangler queries the local (empty) D1 database.

**Auth errors:** If any wrangler command returns an authentication or authorization error, ask the user to run `npx wrangler login` in their terminal and tell you when login is complete. Then retry the command.

## Queries

Run these in order. Each builds on findings from the previous.

### 1. Recent errors

```bash
npx wrangler d1 execute tee-times-db --remote --command="SELECT course_id, date, status, tee_time_count, error_message, polled_at FROM poll_log WHERE status = 'error' ORDER BY polled_at DESC LIMIT 30"
```

### 2. Error aggregates (scope and duration)

```bash
npx wrangler d1 execute tee-times-db --remote --command="SELECT course_id, error_message, COUNT(*) as error_count, MIN(polled_at) as first_seen, MAX(polled_at) as last_seen FROM poll_log WHERE status = 'error' GROUP BY course_id, error_message ORDER BY error_count DESC"
```

### 3. Success/error ratio for failing courses

Skip if step 2 found no errors. Otherwise, substitute the course IDs with high error counts:

```bash
npx wrangler d1 execute tee-times-db --remote --command="SELECT course_id, COUNT(*) as total_polls, SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) as errors, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as successes, SUM(CASE WHEN status='no_data' THEN 1 ELSE 0 END) as no_data FROM poll_log WHERE course_id IN ('REPLACE-WITH-IDS') GROUP BY course_id"
```

### 4. Recent polls (overall system health)

```bash
npx wrangler d1 execute tee-times-db --remote --command="SELECT course_id, date, status, tee_time_count, polled_at FROM poll_log ORDER BY polled_at DESC LIMIT 40"
```

## Interpreting Results

Use `last_seen` from step 2 to distinguish active vs resolved issues. Errors whose `last_seen` is days ago have self-resolved and are typically transient. `poll_log` is periodically cleaned up, so all data shown is relatively recent.

| Severity | Pattern | Action |
|----------|---------|--------|
| **Critical** | Same course failing every cycle for days, 0 successes | Investigate adapter/API root cause. Burning poll budget for nothing. |
| **Moderate** | Mix of successes and errors, or intermittent 429/timeout | Monitor. Investigate if error rate climbs. |
| **Transient** | 1-3 occurrences, stopped recurring | Ignore unless pattern emerges. Normal operational noise. |

## Known Error Patterns

| Error message | Platform | Meaning |
|---|---|---|
| transaction registration failed | CPS Golf | Auth/session setup failing for this facility |
| token request failed: HTTP 4xx | CPS Golf | Facility token endpoint broken or misconfigured |
| API returned HTTP 403 | Any | Access blocked -- IP ban, auth change, or API change |
| API returned HTTP 429 | Any | Rate limited -- often self-resolves |
| Proxy HTTP 403 / Host not allowed | Lambda proxy | Domain missing from proxy allowlist |
| operation was aborted due to timeout | Any | Upstream API too slow |
| is not iterable | Teesnap | API response format changed |

## Reporting

Present findings as a table organized by severity (critical, moderate, transient):
- Course name, error message, error count, date range (first_seen to last_seen)
- Success/error ratio for any course with high error counts
- Recommended next step per category
