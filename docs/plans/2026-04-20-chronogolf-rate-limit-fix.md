# Chronogolf rate-limit fix (post-PR-#99 regression)

**Date:** 2026-04-20 ~02:15 CT
**Trigger:** PR #99 catalog expansion grew Chronogolf course count 8 → 38 (4.75×). First post-deploy cron cycles produced 365 Chronogolf 429 errors vs 154 successes (~59% error rate). Other platforms (CPS, ForeUp, TeeItUp, Teesnap, Eagle Club, MemberSports) had 0 errors and are unaffected.

## Symptom evidence

Query: `SELECT c.platform, p.status, COUNT(*) FROM poll_log p JOIN courses c ON p.course_id = c.id WHERE p.polled_at >= '2026-04-20T05:30:00Z' GROUP BY c.platform, p.status`

| Platform | Success | Error | no_data |
|----------|---------|-------|---------|
| chronogolf | 154 | **365** | 99 |
| cps_golf | 374 | 0 | 88 |
| foreup | 93 | 0 | 2 |
| teeitup | 44 | 0 | 28 |
| teesnap | 36 | 0 | 2 |
| eagle_club | 27 | 0 | 0 |
| membersports | 22 | 0 | 0 |

All errors are `Chronogolf API returned HTTP 429`. Pre-existing context: baker-national-*, dwan, and bluff-creek had 100+ 429 errors each dating from 2026-04-13, meaning Chronogolf's rate limit was already tight; PR #99 amplified a latent issue.

## Root cause

- Chronogolf enforces an aggressive per-IP rate limit (appears to be around ≤1 req/sec based on observed behavior).
- Cron bin-packs courses across 5 batches of ~2 minutes each. With 38 Chronogolf courses, each batch holds ~8 Chronogolf courses × 7 dates = **~56 Chronogolf API calls per batch per 5 min**.
- The current `await sleep(250)` global post-poll delay is platform-agnostic. Between two back-to-back Chronogolf calls, we sleep 250ms plus the preceding API round-trip (~300-500ms). Effective call cadence is ~500-750ms per Chronogolf call — faster than Chronogolf's bucket refill rate.
- Other platforms aren't affected because their per-batch share is smaller and/or their rate limits are more generous.

## Option space (all three documented; A shipped)

### Option A — Per-platform post-poll sleep (SHIPPING)

Change the global `sleep(250)` inside the cron handler to a platform-aware duration. Chronogolf polls get a longer recovery window (~1500 ms); other platforms keep the 250 ms cadence they have today.

**Code shape:**
```ts
const SLEEP_AFTER_POLL_MS: Record<string, number> = {
  chronogolf: 1500,
};
const DEFAULT_SLEEP_AFTER_POLL_MS = 250;
function sleepAfterPoll(platform: string): number {
  return SLEEP_AFTER_POLL_MS[platform] ?? DEFAULT_SLEEP_AFTER_POLL_MS;
}
// ...
await sleep(sleepAfterPoll(course.platform));
```

**Effect on Chronogolf call rate:** 56 calls × 1500ms = 84 seconds of sleep + ~28 seconds of API time = ~112 seconds of Chronogolf activity per batch. Well within the 5-minute cron window. At ~1 call/1.5s we stay under Chronogolf's apparent ceiling.

**Effect on other platforms:** unchanged. CPS, ForeUp, TeeItUp, Teesnap, Eagle Club, MemberSports keep their 250ms cadence.

**Pros:**
- Minimal diff (~10 lines in `src/lib/cron-handler.ts` + tests).
- Platform-isolated blast radius: changes affect one platform, rest untouched.
- Easy to tune per-platform later (add more entries to the map).
- Preserves existing batching, auth, adapter contracts. No downstream shape changes.

**Cons:**
- Platform-specific magic number in production code (mitigated by the `SLEEP_AFTER_POLL_MS` map naming the intent).
- Assumes 1500ms is enough. If Chronogolf's bucket is actually 1 req per 2s, we'll still see some 429s. Second iteration can double again.
- Doesn't help the existing baker/dwan/bluff 429s go away by itself — they were already failing at the pre-expansion cadence. But cutting *total* Chronogolf rate by ~6× should pull us well under the per-IP ceiling across the board.

**Rollback path:** single-line revert. Set all platforms back to 250 ms.

### Option B — Route Chronogolf through the Lambda fetch proxy

Extend the existing AWS Lambda fetch proxy (currently used by CPS Golf for 403 bypass) to also handle Chronogolf. Different IP = different rate-limit bucket.

**Code shape:**
- Add `chronogolf.com` to the Lambda's allowed-host list in `lambda/fetch-proxy/index.mjs`.
- Modify `src/adapters/chronogolf.ts` to call `proxyFetch(...)` instead of `fetch(...)`, same pattern as CPS.
- Deploy the Lambda (CI does this automatically on merge to main).

**Pros:**
- Different egress IP; if Chronogolf's rate limit is per-IP, this fully bypasses.
- Proxy-aware adapter pattern is already established (CPS uses it).

**Cons:**
- Larger diff across 2 services (Lambda + adapter).
- Unknown whether Chronogolf also rate-limits by API-key or other fingerprint — may not help if so.
- Lambda has its own rate/concurrency limits we'd be consuming.
- Undici-blocked-by-TLS is the usual CPS driver; Chronogolf 403 vs 429 is a different failure class. Using a proxy to work around rate-limit pressure is arguably wrong-tool-for-job.
- More surface area to monitor.

**When to pick:** if Option A at 1500 ms + a bump to 2500/3000 ms still shows material 429 rates.

### Option D — Split Chronogolf traffic across direct + proxy routes (per-route-per-platform rate limiter)

Send a fraction of Chronogolf calls through the direct egress IP and the remainder through the Lambda fetch proxy. Two egress IPs = two independent rate-limit buckets from Chronogolf's perspective. Pair with a per-(route, platform) rate limiter that tracks last-call-time per route and enforces a minimum spacing per route independently.

**Code shape:**
- `src/lib/fetch-route.ts` (new): a small routing layer that picks direct vs proxy for a given `(platform, courseId)` pair. Consistent routing (same course always on same route) so rate-limit behavior is reproducible in debugging.
- `src/lib/rate-limit-per-route.ts` (new): `Map<string, number>` tracking last call time keyed on `${route}:${platform}`. Before a Chronogolf call, sleep to enforce minimum spacing on that specific route.
- `src/adapters/chronogolf.ts`: accept a fetch function from the route picker instead of calling `fetch()` directly.
- `lambda/fetch-proxy/index.mjs`: add `chronogolf.com` to the allowed hosts.
- `src/lib/batch.ts`: no change — `sleepAfterPoll` becomes irrelevant for Chronogolf since spacing is enforced pre-call in the rate limiter.

**Routing split:** 50/50 hash-based on courseId is simplest. Skew is possible for tuning (e.g., 40% direct / 60% proxy if Lambda has more headroom).

**Pros:**
- If Chronogolf's ceiling is purely per-IP, this roughly doubles effective throughput without slowing any individual path.
- Each route can run at the natural per-IP safe cadence (e.g., 1 req/sec per route = 2 req/sec aggregate).
- Natural fit if we later need to scale further (add a third route, etc.).
- Survives Chronogolf tightening their per-IP limit further — we already have the architecture to spread.

**Cons:**
- **Ethically gray.** Chronogolf set the per-IP limit because "one IP = one client" is their mental model. Using two IPs to double our rate is recognizable as circumvention, even though our total load is modest (~300 calls/hr across both routes). Mitigating factors: legitimate low-volume aggregator use case, real User-Agent, no auth evasion. But if a Chronogolf engineer looked at our traffic and saw two IPs polling correlated course UUIDs, they could reasonably call us out. Worth naming plainly, not hiding behind "technically allowed."
- Moderate engineering complexity: new routing layer, new rate limiter, two adapters' worth of test updates, Lambda config change, proxy deploy.
- Two execution paths to monitor and debug.
- Lambda has its own concurrency/rate budget we'd be consuming.
- If Chronogolf rate-limits on API key or fingerprint (unlikely for this endpoint but possible), splitting does nothing.

**When to pick:** if Option A at 1500 ms (or escalated to 2500-4000 ms) leaves a persistent error rate >10-20%, AND we're confident the limit is per-IP (probe: does a second IP hit a fresh bucket? Lambda proxy from a test adapter call would answer this).

**Rollback path:** route all Chronogolf calls back to the direct path; remove Lambda allowlist entry. Rate limiter can stay (no-op if only one route in use).

### Option C — Stagger Chronogolf across cron cycles

Only poll a fraction of Chronogolf courses per batch. E.g., each 5-min cycle polls 1/N of Chronogolf courses (round-robin by course ID hash + minute-of-hour), so the same course is polled every N×5 minutes instead of every 5 minutes.

**Code shape:**
- Add a `chronogolfStride` logic in `assignBatches()` or in the per-batch poll loop.
- Track a rolling "bucket index" modulo N, derived from `event.scheduledTime` or similar.
- Only poll courses whose hash-bucket matches the current cycle.

**Pros:**
- Ceiling on Chronogolf calls per cycle is deterministic and tunable via N.
- Works even if per-IP and per-key rate limits both apply.

**Cons:**
- User-facing freshness penalty: Chronogolf tee time data becomes (N×5) minutes stale in the worst case. For N=3, that's 15-min staleness. Our hybrid refresh model includes user-triggered refetch, so the impact is bounded — but a new architectural contract is crossed.
- Changes the batching contract in a way that existing tests cover implicitly; test suite updates required.
- More complex to reason about when debugging staleness.

**When to pick:** if both A and B are insufficient, OR if Chronogolf's rate limit is actually much tighter than observed (e.g., 100 req/hr).

## Decision rubric

| Post-A error rate | Next step |
|--|--|
| <10% after Option A at 1500 ms | Done. Monitor only. |
| 10-25% after Option A at 1500 ms | Tune: Option A at 2500 ms, then 4000 ms. |
| >25% after Option A at 4000 ms | Probe whether Chronogolf limits per-IP or per-key: have the Lambda proxy make one test call with same course UUID. If the proxy call succeeds while direct 429s, the limit is per-IP and **Option D** applies. If proxy also 429s, it's per-key and **Option C** (staggering) applies. |
| Confirmed per-IP ceiling, ≥25% error rate needed to resolve | **Option D.** Accept the ethical gray area; we're a low-volume legitimate aggregator. |
| Confirmed per-key ceiling or key-based rate limit | **Option C.** Accept some staleness (up to N×5 min) in exchange for eliminating 429s. |

Option B (proxy-only, no split) is effectively a subset of Option D with a 0/100 split and no direct egress; if we need the proxy at all, we likely want the hybrid. Kept in the doc for completeness but unlikely to be the chosen shape.

## Post-ship verification

After Option A deploys:

1. Wait ~20 minutes for the first batch cycle to complete with the new sleep.
2. Query the same `SELECT platform, status, COUNT(*)` aggregate for the 30-minute window after deploy.
3. Target: Chronogolf error rate drops below 10%. If still >25%, iterate on the sleep value (try 2500, then 4000).
4. If still >25% after 4000 ms: escalate to Option B.

## Files affected (Option A)

- `src/lib/cron-handler.ts` — replace `sleep(250)` with `sleep(sleepAfterPoll(course.platform))`
- `src/lib/cron-handler.test.ts` — add test asserting Chronogolf gets 1500 ms sleep, others get 250 ms
- `src/lib/batch.ts` (no change expected) — just referencing `platformWeight` pattern for naming consistency

## Non-goals of this fix

- Does NOT re-architect the cron batching system.
- Does NOT address the pre-existing baker/dwan/bluff 429 pattern except incidentally (lowering cadence across the board for all Chronogolf courses should also help them).
- Does NOT add adaptive rate-limit learning (track actual Chronogolf 429 responses and back off). That's Option D-future if we want to get fancy.

## References

- [docs/plans/2026-04-20-overnight-decisions.md D-11](./2026-04-20-overnight-decisions.md#d-11) — the catalog expansion that triggered this.
- `src/lib/cron-handler.ts:275` — the sleep call to be modified.
- `src/lib/batch.ts` — existing per-platform pattern (`platformWeight`) to follow for naming.
