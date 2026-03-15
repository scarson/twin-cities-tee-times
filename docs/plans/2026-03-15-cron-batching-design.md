# Batched Cron Polling Design

**Goal:** Split cron polling across multiple invocations to stay within Cloudflare Workers free plan's 50 external subrequest limit per invocation.

**Context:** CPS Golf courses require 3 external fetches per date (token + register + tee times). With 24 courses today and ~80 planned, a single invocation exceeds 50 subrequests during peak polling.

**Design doc:** `docs/plans/2026-03-15-cron-batching-design.md`

---

## Architecture

5 staggered cron triggers, each processing a dynamically-assigned subset of courses. Each invocation gets a fresh 50 external subrequest budget (D1 reads have a separate 1,000 limit).

### Cron triggers

```jsonc
"crons": [
  "*/5 * * * *",      // batch 0
  "1-56/5 * * * *",   // batch 1
  "2-57/5 * * * *",   // batch 2
  "3-58/5 * * * *",   // batch 3
  "4-59/5 * * * *"    // batch 4
]
```

`scheduled()` passes `event.cron` to `runCronPoll`, which maps it to a batch index via a static lookup.

### shouldRunThisCycle compatibility

The existing time-of-day frequency gating works correctly with staggered triggers. Each batch gets the same polling frequency, offset by 1 minute:

- **Peak (5-10am):** All 5 batches fire every 5 minutes
- **10am-2pm:** Each batch fires every 10 minutes
- **2pm-8pm:** Each batch fires every 15 minutes
- **Overnight:** All 5 batches fire once per hour (minutes :00-:04)

## Batch assignment

Each invocation computes batch assignments dynamically:

1. Query all courses from D1
2. Assign weight per platform: CPS Golf = 3, all others = 1
3. Sort courses by ID (deterministic, stable)
4. Greedy bin-packing into 5 bins: assign each course to the bin with lowest total weight, ties broken by lowest bin index
5. Filter to this invocation's batch

No static batch field in `courses.json` — assignment rebalances automatically when courses are added or removed.

## Loop structure: date-outer, course-inner

**Current:** for each course → for each date. Under tight budgets, late courses get zero polling while early courses get all 7 dates.

**New:** for each date (today first) → for each course in batch. Every course gets today before any course gets tomorrow. Better fairness under budget pressure.

```
for each date (priority order: today, tomorrow, day+2, ...):
  if !shouldPollDate(dateOffset, ...): continue
  for each course in batch:
    check budget, poll, decrement budget
```

## Subrequest budget tracking

Each invocation tracks a running budget starting at 45 (50 limit minus 5 headroom). Before polling each course×date, check if the course's weight fits:

```
budget = 45
for each date:
  for each course:
    weight = (platform === 'cps_golf') ? 3 : 1
    if budget < weight: stop all polling, log warning
    poll(course, date)
    budget -= weight
```

Degradation is graceful — farther-out dates drop first, today is always prioritized.

## Inactive course probing

Inactive courses are distributed across batches using the same bin-packing algorithm. Each batch probes its own inactive courses (hourly, today+tomorrow). Budget tracking applies equally.

## Housekeeping: batch 0 only

These D1-only tasks run only when batch index is 0:

- Poll_log cleanup (entries older than 7 days)
- Session cleanup (expired sessions)
- Auto-deactivation (courses with no tee times for 30 days)

Running in a single batch avoids duplicate work and prevents race conditions between auto-deactivation in one batch and auto-activation in another.

## Budget math

| Scenario | Courses | Total weight | Per batch | × 2 dates | Headroom |
|----------|---------|-------------|-----------|-----------|----------|
| Current (24) | 16 CPS + 8 other | 56 | ~11 | 22 | 23 |
| Full TC (~80) | 14 CPS + 65 other | 107 | ~21 | 42 | 3 |
| Dates 2-3 burst | — | — | ~21 | 84 | budget cap stops at 45 |

## Interface changes

- `scheduled()` in `worker.ts` passes `event.cron` to `runCronPoll`
- `runCronPoll` signature: `runCronPoll(env: CloudflareEnv, cronExpression: string)`
- Batch index derived from a static map of cron expression → index

## Paid tier upgrade path

Remove 4 cron entries from `wrangler.jsonc`, remove batch filtering logic from handler. Single trigger handles all courses with 1,000 subrequest budget. The weight/budget tracking can remain as a safety net.

## Files affected

- `wrangler.jsonc` — 5 cron triggers
- `worker.ts` — pass `event.cron` to `runCronPoll`
- `src/lib/cron-handler.ts` — batch assignment, loop reorder, budget tracking, housekeeping gating
- `src/lib/cron-handler.test.ts` — tests for batch assignment, budget exhaustion, housekeeping gating
