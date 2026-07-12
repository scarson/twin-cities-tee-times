# Chronogolf 429 — Measured Rate Ceiling + Backoff Fix (2026-07-12)

**Status:** Shipped on branch `fix/chronogolf-429-backoff` (see Execution Status below).

**TL;DR:** The single-lane + 1.1s-spacing fix from
`docs/plans/2026-06-08-chronogolf-rate-limit-pacing-plan.md` was designed
against an *assumed* ~1 req/sec per-IP ceiling. Production telemetry shows
Chronogolf's actual limiter admits roughly **20 requests/min per IP, then
blocks for ~60s** — about a third of the design assumption. At 0.9 req/sec the
lane exhausted the allowance ~22s into every cycle and spent the remaining
~3 minutes sending requests that were all rejected (~13k wasted requests/day,
75–93% error rate per course). Fix: pace at ~15 req/min (4s interval) and back
off 61s after any 429.

---

## Investigation trail (how we know the ceiling)

All evidence from production `poll_log` (7-day retention) queried 2026-07-12,
plus one manual probe of the marketplace API.

1. **The "July 5 start" was a retention artifact.** Error `first_seen`
   clustered at 2026-07-05T05:00 UTC — exactly 7 days before the query, at the
   first overnight cron cycle past the `cleanupOldPolls` cutoff. Day-by-day
   counts are flat (~13k errors, ~2k successes, ~2k no_data per day) across
   the whole window: this was steady-state, not an onset. How long it had been
   going on is unknowable from D1; the June fix deployed to `main` on
   2026-06-09, and no code touching polling changed after that.

2. **The throttle was working as designed.** Error rows within a cycle are
   spaced ~1.1s apart — the adapter's pacing was live; politeness at
   0.9 req/sec was simply not polite enough.

3. **The limiter fingerprint.** Within a single lane cycle
   (2026-07-11T14:00–14:06 UTC): ~19–20 requests succeed from cycle start
   (~22s at 0.9 req/sec), then a solid ~60s of 429s, then ~6 polls
   (~13 requests) succeed, then 429s resume. The error:success ratio is
   ~78% at *every* hour of day despite 12× different cycle frequency —
   the shape is per-cycle, not load-dependent. That matches a
   threshold-then-block rate rule: **~20 req/min per IP, ~60s mitigation**.

4. **chronogolf.com is fronted by Cloudflare** (`server: cloudflare`,
   `__cf_bm` bot-management cookie on a manual 200 probe). No `RateLimit-*`
   policy headers on success responses. Consistent with a Cloudflare
   rate-limiting rule serving the 429s at the edge.

5. **Sustained useful throughput observed: ~29 successful polls per cycle**
   (≈12–15 successful HTTP requests/min once pagination is counted) — i.e.
   the limiter itself was already capping useful work near 20 req/min;
   everything we sent above that was pure waste.

## The fix (shipped)

- `CHRONOGOLF_MIN_REQUEST_INTERVAL_MS`: 1100 → **4000** (~15 req/min, margin
  under the ~20/min measured ceiling).
- **`CHRONOGOLF_429_BACKOFF_MS = 61_000`**: on any HTTP 429 the adapter pushes
  its `nextAllowedAt` reservation 61s out, so the next Chronogolf request
  (same or later poll) waits out the observed block window instead of sending
  into it. If the real block is longer, the next request draws another 429 and
  re-arms the backoff — the effective rate self-corrects at ~1 probe per
  backoff window (closed-loop control; no dependence on knowing the exact
  threshold).
- 429 error messages now append the `Retry-After` header value when present —
  telemetry for future tuning, no behavioral dependence.
- Lane volume math updated: 210s budget at 4s/request ≈ **52 requests/cycle**
  (was ~190 attempted, ~45 accepted). Near-date coverage (42 courses ×
  today+tomorrow) completes in ~2 cycles via the existing oldest-first
  rotation — same accepted behavior as the June plan's busiest-day case.

### Considered and ruled out

- **Keep 1.1s spacing, add backoff only.** Ruled out: each cycle would still
  burn the whole allowance in the first ~20 requests and spend most of the
  cycle in backoff; steady sub-threshold pacing yields strictly more accepted
  requests per cycle and near-zero rejected ones.
- **Honor `Retry-After` as the backoff duration.** Ruled out for now (YAGNI +
  invariant risk): a large header value would make an in-poll wait overrun the
  lane's wall-clock margin and violate the no-self-overlap invariant. The
  value is logged instead; revisit if telemetry shows blocks ≫ 60s.
- **Lambda proxy IP rotation.** Explicitly rejected again, as in the June
  plan: it circumvents rather than respects the limit, and sub-threshold
  pacing meets our actual freshness needs.
- **Adaptive AIMD interval tuning.** Deferred: a fixed 4s interval + 61s
  backoff already self-corrects in the only direction that matters
  (ceiling lower than believed). Full adaptivity adds state and test surface
  for no demonstrated need.

## Companion fixes in the same branch

- **`deactivateStaleCourses` NULL gap** (`src/lib/db.ts`): courses whose
  `last_had_tee_times` is NULL (never one success) were never deactivated and
  polled forever. Now deactivated once `poll_log` shows polling has run for
  3+ days with no success; freshly added courses are untouched; the hourly
  inactive probe auto-reactivates if data ever appears.
- **the-wilds disabled** (`src/config/courses.json`): its Chronogolf
  marketplace record reports `active: false` / `online_booking_enabled:
  false`; every poll returns `status: "closed"` with zero tee times (2,590
  polls, 0 successes in the retention window).

## Post-deploy verification

Via `/check-logs` after the next `dev` → `main` publication deploy:

1. Chronogolf 429 counts should drop to near zero within a few cycles
   (compare `poll_log` error counts per hour before/after the deploy
   timestamp).
2. Successful Chronogolf polls per cycle should hold at or above the prior
   ~29/cycle (the fix trades attempts, not throughput).
3. If material 429s persist at 15 req/min, the ceiling is lower than 20/min:
   raise the interval (4000 → 5000 → 6000) and re-verify over a full hour.
   The backoff makes the interim state safe (no hammering) but tune promptly —
   each 429 window still wastes ~61s of lane budget.
4. Watch for `Retry-After: <n>` values in new 429 `error_message` rows; if
   they show blocks ≫ 60s, raise `CHRONOGOLF_429_BACKOFF_MS` to match.

## Execution status

| Item | Status | Commit |
|---|---|---|
| Adapter pacing + 429 backoff (TDD) | ✅ | `0e45ab3` |
| deactivateStaleCourses NULL fix (TDD) | ✅ | `c1b4a1e` |
| the-wilds disabled in courses.json | ✅ | `bb7b89c` |
| Docs (this file, CF-4 amendment, June plan status, implementation log) | ✅ | see docs commit |
| Full gate (768 tests, tsc, lint) | ✅ green | — |
