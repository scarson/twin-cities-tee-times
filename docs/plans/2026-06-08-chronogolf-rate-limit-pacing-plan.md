# Chronogolf HTTP 429 Pacing Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` (or in-session sequential execution) to implement this plan task-by-task. Every code phase is TDD-first.

**Goal:** Eliminate the systemic Chronogolf HTTP 429 rate-limiting across ~35 courses by bounding the **global** (cross-invocation) Chronogolf request rate to a courteous ~1 req/sec, without starving other platforms or overrunning Cloudflare's cron wall-clock / CPU budgets.

**Architecture:** Three coordinated in-cron changes — (A) pin all Chronogolf courses to a single cron batch (the "Chronogolf lane") so only one stateless invocation ever polls Chronogolf at a time; (B) a per-request min-interval throttle inside `ChronogolfAdapter` that spaces **every** HTTP request including pagination (not just between polls); (C) a wall-clock deadline on the lane plus oldest-first ordering so heavy cycles never self-overlap and no course/date starves. The existing AWS Lambda fetch proxy is held as a **documented fallback** (not built) if a polite ~1 req/sec still 429s.

**Tech Stack:** TypeScript 5 (strict), Vitest 4, Cloudflare Workers (cron `scheduled()` via OpenNext), D1. No new dependencies, no new infrastructure.

---

## Living Document Contract

This plan is a living document. Every executing agent MUST update it as
execution progresses, not only at completion.

- **On phase claim:** the executor MUST flip the banner to 🚧 IN PROGRESS
  with a claim timestamp (ISO 8601 UTC) and the active branch name. The
  banner MUST NOT include an expected-completion estimate — agents cannot
  reliably estimate their own wall-clock, and a fabricated duration
  becomes a stale anchor that misleads future readers. Followers
  encountering a 🚧 banner determine liveness by observable signals (PR
  existence, recent branch commits), not by arithmetic on expected times.
  See Step 5's stale-claim reclaim protocol.
- **On phase ship:** the executor MUST update that phase's **Execution
  Status** banner with the shipped commit SHA(s) and date. If a PR is
  open, the PR number and URL MUST appear in the top-of-plan Execution
  Status table.
- **On phase defer:** the executor MUST update the banner with ⏸ status
  AND a prose description of the unblock condition + a link to the
  likely-unblocker artifact (plan page, task, or PR whose own Execution
  Status banner will signal completion). Prose + link is durable across
  paraphrases and scope edits; exact-string coordination between agents
  is not.
- **On PR merge:** the executor MUST record the merge SHA in the banner
  + the top-of-plan Execution Status table.
- **On deviation from the written plan** (scope edits, structural
  refactors, dropped tasks, reordered phases): the executor MUST
  inline-document the deviation in the affected task AND summarize it
  in the top-of-plan Execution Status as a "Deviations" subsection.
  Deviation state MUST NOT live only in PR notes or status reports.
- **On discovery** (pre-existing drift surfaced during execution, new
  bugs found, architectural issues noted): the executor MUST add a
  "Discoveries" subsection at the top of the plan with pointers to the
  files/lines affected. Follow-up dispatches read this subsection to
  avoid duplicate discovery work.

The plan SHOULD reflect reality at the end of every session that touches
it. Anything worth putting in a status report to the user is worth
putting in the plan.

Rationale: `/writing-plans-enhanced` Step 5. Writing at ship time is
cheap; reconstruction by downstream readers is expensive, compounds
across dispatches, and fails silently when state is split across PR
notes and commit messages.

---

## Execution Status

**Overall:** 1/5 phases shipped (on branch `fix/chronogolf-429-pacing`).

| Phase | Status | Ship SHA(s) | Notes |
|---|---|---|---|
| 1 — Single Chronogolf lane (`batch.ts`) | ✅ Shipped | `7362bac` | full suite green (740), `tsc` clean |
| 2 — Per-request throttle (`chronogolf.ts`) | 🚧 In progress | — | branch `fix/chronogolf-429-pacing` |
| 3 — Lane deadline + fair ordering (`cron-handler.ts`) | ⬜ Not started | — | — |
| 4 — Docs, pitfalls, memory | ⬜ Not started | — | — |
| 5 — Verification + PR | ⬜ Not started | — | — |

### Deviations
- **Phase 1 Task 1.3 (test repair method):** the plan's default rule was "retarget lane-broken `cron-handler.test.ts` tests to `BATCH_1_CRON`, keep fixtures." In execution I instead **swapped most fixtures to `chronogolf`** (so they land in the lane and keep `BATCH_0_CRON`), because the shared/identical `course-NN` fixture lines made fixture-swap the lower-collision, fewer-edit change. Kept `BATCH_1_CRON` only for the 3 weight-sensitive budget-exhaustion tests (keeps them off-lane → no coupling to Phase 3's wall-clock deadline, weight math intact). Verified the lane-coupling for the swapped tests is benign: Phase 3's deadline (210 s) never triggers in these tests, and oldest-first ordering is stable with empty `poll_log`. All repaired assertions kept at equal strength (vacuous "empty-batch-0" passes were fixed, not left).

### Discoveries
- **Pre-existing jsdom noise:** the full suite prints `Not implemented: HTMLCanvasElement's getContext()` warnings from a chart/canvas component test (unrelated to this change — no canvas code touched). Flagged only; out of scope for this PR.

---

## Root Cause (self-contained summary)

Diagnosed 2026-06-07/08. Confirmed in code 2026-06-08. **All ~35 active Chronogolf courses (42 in the catalog) intermittently fail with HTTP 429**, ~20k errors/week, in synchronized bursts at cron ticks. Three mechanisms stack:

1. **Cross-invocation concurrency (the core flaw).** Polling runs in 5 batches on 5 *separate* cron expressions 1 minute apart (`*/5`, `1-56/5`, `2-57/5`, `3-58/5`, `4-59/5` — `wrangler.jsonc`). Each invocation runs *longer than a minute* (2500 ms × its Chronogolf courses + others), so 2–5 invocations **overlap**, and their request streams **sum at the shared Cloudflare egress IP**. A per-invocation `sleep()` cannot coordinate across stateless invocations — which is why the prior fix (`sleepAfterPoll` 1500→2500 ms) regressed to 25% and is still failing.
2. **Pagination bursts.** Each Chronogolf poll fans out to **up to 10 paginated `fetch`es with zero inter-page delay** (`src/adapters/chronogolf.ts:43-89`). `sleepAfterPoll` spaces *polls*, not *requests*, so the within-poll burst is unthrottled. `platformWeight(chronogolf)=1` also mis-budgets these subrequests.
3. **Bin-packing is blind to per-platform count.** `assignBatches` balances *total weight* (CPS=3, others=1), so the 42 Chronogolf courses currently spread **7 / 6 / 7 / 14 / 8** across batches — batch 3 alone polls 14 per cycle. (Computed from `courses.json` 2026-06-08.)

**Verified platform facts (Cloudflare docs, 2026-06-08):** Cron Trigger wall-clock cap = **15 min** (Worker terminated past it); CPU cap = **30 s** for sub-hour cron intervals (sleeps/subrequest waits don't count as CPU); the 5 cron expressions are independent invocations that overlap. Subrequest cap on the paid plan is 10,000/invocation (`docs/research/cloudflare-limits.md`), so subrequests are not the binding constraint — wall-clock is. Chronogolf's ceiling is **~≤1 req/sec per-IP** (observed estimate, `docs/plans/2026-04-20-chronogolf-rate-limit-fix.md`).

**Why the prior fix structurally couldn't work:** it tuned per-invocation spacing for a limit that is enforced per-IP across all concurrent invocations. The limiter and the throttle were scoped to different things.

---

## Volume Math (the derivation — no magic numbers)

Inputs:
- **N_courses** ≈ 35 active Chronogolf (42 catalog). Source: `courses.json` + diagnostic.
- **Ceiling** ≈ 1 req/sec per-IP (conservative; the prior doc's observed estimate). We design for this and verify post-deploy.
- **Pages/poll** ≈ 1–10 (`PAGE_SIZE=24`, `MAX_PAGES=10`); realistic average ~1.5–3 (sparse/far dates → 1 page; busy near dates → 3–5).
- **Peak cron period** = 5 min = 300 s (the practical self-overlap bound for the lane); **hard wall-clock cap** = 15 min = 900 s.
- **Chosen request interval `T`** = **1100 ms** (≈ 0.9 req/sec — a 10% margin under the 1 req/sec ceiling). Tunable; see fallback rubric.

Derived constraints:
- **Per-request spacing** must be ≥ T for *every* Chronogolf HTTP request (pages included), enforced within the single lane. Global rate = 1 / T ≈ 0.9 req/sec ✅ under ceiling.
- **Today + tomorrow for all courses** ≈ 35 × 2 dates × ~3 pages ≈ **210 requests** ≈ 210 × 1.1 s ≈ **231 s ≈ 3.85 min** — which **exceeds** the 3.5-min deadline below on the busiest in-season days. **This is expected and acceptable:** on peak-busy cycles the deadline truncates *within* today+tomorrow, and oldest-first ordering (change C) rotates which courses get the near-date refresh, so every course's today/tomorrow is covered within ~1–2 cycles. On typical days many courses return 1 page (sparse/`no_data`), so average load is well under the deadline and near-dates complete every cycle. Net result vs. today: ~1-cycle-behind near-date freshness on the busiest days, instead of stale-or-missing data from 429 failures — a strict improvement, and user-triggered refresh covers urgency.
- **Lane wall-clock deadline `CHRONOGOLF_LANE_BUDGET_MS`** = **210_000 ms (3.5 min)**. Derivation: 300 s peak period − ~90 s reserved for housekeeping + inactive probing + safety margin = 210 s for the Chronogolf lane work. At T=1.1 s that is ≤ ~190 requests/cycle. Always far below the 15-min hard cap. The deadline is wall-clock-based, so it is **robust to the page-count estimate** — it stops the lane at 210 s regardless of how many pages each poll actually fetched.
- **Heavy cycles** (top-of-hour, days 2–13 also due): would need ~700–1400 requests = 13–26 min if done in one cycle — **impossible** within any cron window. Therefore the deadline truncates and the next cycle resumes (oldest-first ordering = fair rotation). Days 2–13 change slowly and are covered over several cycles; user-triggered refresh covers urgency. **This is the irreducible consequence of honoring a ~1 req/sec ceiling for 35 courses — not a defect.**
- **CPU:** the lane is almost entirely I/O + sleeps; JSON parsing of paginated responses is the only CPU and is well under the 30 s CPU cap.

---

## Design Overview

| # | Change | File(s) | Failure mode it kills |
|---|--------|---------|----------------------|
| **A** | Pin **all** Chronogolf → **batch 0** (the lane); bin-pack non-Chronogolf across batches 1–4 | `src/lib/batch.ts` | Cross-invocation concurrency. Invariant: **only batch 0 ever touches Chronogolf** — including the batch-0-gated horizon probe and the inactive-course probe, which already run in batch 0. No other batch issues a Chronogolf request. |
| **B** | Min-interval throttle inside `ChronogolfAdapter`, awaited before **every page fetch**; remove the Chronogolf `sleepAfterPoll` special-case (→ 250 ms default) | `src/adapters/chronogolf.ts`, `src/lib/batch.ts` | Unthrottled pagination bursts. Spacing becomes per-*request* (pages included), single-sourced in one constant. |
| **C** | Wall-clock **deadline** spanning **all** batch-0 Chronogolf work (active + inactive loops + horizon probe) + **oldest-first ordering** (via existing `pollTimeMap`) | `src/lib/cron-handler.ts` | Lane self-overlap on heavy cycles (would re-introduce concurrency); tail starvation under truncation. The wall-clock deadline — not the subrequest budget — is the binding guard. |

**Why batch 0 (not another batch) is the lane:** the horizon probe (`runCronPoll` → `runHorizonProbe`) is gated to `batchIndex === 0` and queries *all* eligible active courses from D1 regardless of batch — so it polls Chronogolf courses too. If the lane were any non-zero batch, the batch-0 horizon probe would poll Chronogolf concurrently with the lane = cross-invocation Chronogolf again. Making batch 0 the lane keeps the invariant airtight with **zero** extra horizon-probe changes — but the horizon probe MUST then share the lane's wall-clock deadline (Phase 3 Task 3.1), since it runs after the active/inactive loops and also issues Chronogolf requests. The cost is honest test churn in `cron-handler.test.ts` (tests that assumed batch 0 holds non-Chronogolf courses), repaired in Phase 1 Task 1.3 to keep that commit green.

**`platformWeight(chronogolf)` is deliberately left at 1.** The `weight=1`-vs-up-to-10-pages subrequest undercount is real but benign: (i) Chronogolf is now single-laned, so its weight no longer affects bin-packing of other platforms; (ii) the **wall-clock deadline** (change C) is the binding guard on the lane, which makes the subrequest-budget undercount moot. Bumping the weight would ripple into bin-packing tests for no behavioral benefit. We document the undercount in the new pitfall (Phase 4) instead.

---

## Phase 1 — Single Chronogolf Lane (`src/lib/batch.ts`)

**Execution Status:** ✅ SHIPPED at `7362bac` on 2026-06-08 (branch `fix/chronogolf-429-pacing`; full suite 740 green, `tsc` clean). Test-repair deviation recorded in the top-of-plan Deviations.

**Files:**
- Modify: `src/lib/batch.ts`
- Modify (tests): `src/lib/batch.test.ts`
- Modify (tests): `src/lib/cron-handler.test.ts` — repair tests the lane change breaks (Task 1.3), so Phase 1's commit stays green. **No** `cron-handler.ts` production change in this phase (that's Phase 3).

**BEFORE starting work:**
1. Invoke `superpowers:test-driven-development`.
2. Read `docs/pitfalls/testing-pitfalls.md`.
Follow TDD: write failing test → run it (confirm fail) → implement minimal code → run (confirm green) → refactor.

**Pitfall watch:** TIME-1 (no `toISOString()`-derived date strings — N/A here, but don't introduce any), CF-1 (no `process.env`). No SQL in this file (DB-1 N/A).

### Task 1.1 — Pin Chronogolf to the lane in `assignBatches`

**Current → desired behavior:**
- Current: all courses bin-packed by weight across all 5 batches (Chronogolf scattered 7/6/7/14/8).
- Desired: all `chronogolf` courses go to batch `CHRONOGOLF_LANE = 0`; all non-Chronogolf courses bin-pack by weight across the *other* batches (indices 1..4). Determinism (sort by id) preserved.

**Step 1 — Write failing tests** (`src/lib/batch.test.ts`, new `describe("assignBatches chronogolf lane")`):
```ts
it("assigns every chronogolf course to the lane (batch 0)", () => {
  const courses = [
    makeCourse("a-chrono", "chronogolf"),
    makeCourse("b-cps", "cps_golf"),
    makeCourse("c-chrono", "chronogolf"),
    makeCourse("d-foreup", "foreup"),
  ];
  const result = assignBatches(courses);
  const laneIds = result[CHRONOGOLF_LANE].map((c) => c.id).sort();
  expect(laneIds).toEqual(["a-chrono", "c-chrono"]);
  // No chronogolf outside the lane:
  for (let i = 0; i < BATCH_COUNT; i++) {
    if (i === CHRONOGOLF_LANE) continue;
    expect(result[i].some((c) => c.platform === "chronogolf")).toBe(false);
  }
});

it("keeps non-chronogolf courses out of the lane", () => {
  const courses = Array.from({ length: 8 }, (_, i) => makeCourse(`f-${i}`, "foreup"));
  const result = assignBatches(courses);
  expect(result[CHRONOGOLF_LANE]).toHaveLength(0);
  // distributed across the remaining 4 batches:
  const nonLaneTotal = result.filter((_, i) => i !== CHRONOGOLF_LANE).reduce((n, b) => n + b.length, 0);
  expect(nonLaneTotal).toBe(8);
});

it("balances non-chronogolf weight across the 4 non-lane batches", () => {
  const courses = Array.from({ length: 12 }, (_, i) => makeCourse(`c-${String(i).padStart(2,"0")}`, "cps_golf"));
  const result = assignBatches(courses);
  const nonLaneWeights = result
    .map((b, i) => ({ i, w: b.reduce((s, c) => s + platformWeight(c.platform), 0) }))
    .filter((x) => x.i !== CHRONOGOLF_LANE)
    .map((x) => x.w);
  const max = Math.max(...nonLaneWeights), min = Math.min(...nonLaneWeights);
  expect(max - min).toBeLessThanOrEqual(3); // within one CPS course of balanced
});
```

**Step 2 — Run, confirm fail** (`CHRONOGOLF_LANE` undefined / wrong distribution).

**Step 3 — Implement** in `src/lib/batch.ts`:
```ts
export const CHRONOGOLF_LANE = 0;
const CHRONOGOLF_PLATFORM = "chronogolf";

export function assignBatches(courses: CourseRow[]): CourseRow[][] {
  const batches: CourseRow[][] = Array.from({ length: BATCH_COUNT }, () => []);
  const weights = new Array(BATCH_COUNT).fill(0);
  const sorted = [...courses].sort((a, b) => a.id.localeCompare(b.id));

  for (const course of sorted) {
    if (course.platform === CHRONOGOLF_PLATFORM) {
      batches[CHRONOGOLF_LANE].push(course);
      weights[CHRONOGOLF_LANE] += platformWeight(course.platform);
      continue;
    }
    // Bin-pack non-chronogolf across the batches OTHER than the lane.
    let minIdx = -1;
    for (let i = 0; i < BATCH_COUNT; i++) {
      if (i === CHRONOGOLF_LANE) continue;
      if (minIdx === -1 || weights[i] < weights[minIdx]) minIdx = i;
    }
    batches[minIdx].push(course);
    weights[minIdx] += platformWeight(course.platform);
  }
  return batches;
}
```
Update the `assignBatches` doc-comment to describe the lane + per-platform rationale (no temporal/"new" language — describe as-is per Code Comments rules).

**Step 4 — Run, confirm green.**

### Task 1.2 — Update existing `assignBatches` tests whose premise changed (intentional)

These existing tests asserted the *old* all-batches bin-packing and MUST be updated to the new lane behavior. This is intentional behavior change, **not** assertion weakening — each updated assertion must remain as strong, just describing the new contract:
- `"balances CPS courses (weight 3) across batches"` — 5 CPS now pack into 4 non-lane batches, not 5. Update to assert they spread across the 4 non-lane batches with batch 0 empty.
- `"breaks ties by lowest batch index"` — a single non-Chronogolf course now lands in the lowest **non-lane** batch (index 1), not 0. Update accordingly, OR change the fixture to a `chronogolf` course (then it lands in batch 0). Pick the chronogolf fixture so the "lowest index" intent is preserved literally.
- `"distributes courses across all batches"` / `"handles fewer courses than batches"` / `"handles empty course list"` / `"is deterministic"` — re-run; update only if they assert lane-specific placement. Keep the determinism and total-count assertions.

**DO NOT** delete any test. If an assertion can't be preserved at equal strength under the new contract, STOP and raise it.

> **Note:** Chronogolf's `sleepAfterPoll` 2500 ms special-case is intentionally **left in place** through Phase 1 (it keeps Chronogolf *more* throttled in the intermediate branch state, never less). It is removed atomically with the adapter throttle that supersedes it in **Phase 2** — relocating spacing from per-poll to per-request is one logical change and belongs in one commit.

### Task 1.3 — Repair `cron-handler.test.ts` tests broken by the lane change (keeps the Phase 1 commit green)

The `assignBatches` change means non-Chronogolf courses no longer land in batch 0, so several existing `cron-handler.test.ts` tests that use `foreup`/`cps_golf` fixtures with `BATCH_0_CRON` now poll an empty batch and FAIL (e.g. "polls today for all courses before moving to tomorrow" asserts `batch0Ids.length >= 2`; the budget-exhaustion and inactive-probe tests expect polls that no longer happen). Phase 1's commit MUST leave the **whole** suite green, so repair them here — **keep every assertion at equal strength**, applying this default rule (don't choose per-test ad hoc):
- **Default: retarget the broken test to `BATCH_1_CRON` and `coursesInBatch(courses, 1)`, keeping its original non-Chronogolf fixture.** Smallest change that preserves intent (these tests exercise generic batch/poll/budget/error behavior, not Chronogolf specifically). `BATCH_1_CRON` is already defined at the top of the file.
- **The budget-exhaustion tests** (`cps_golf` weight 3 + `BATCH_0_CRON`): retarget to `BATCH_1_CRON` + `coursesInBatch(courses, 1)`. Their `coursesNeeded = ceil(...) * 5` over-provisions courses across the 4 non-lane batches, so batch 1 still gets enough to exhaust the budget — but update the `* 5` comment (it referenced 5 batches; non-Chronogolf now packs into 4). The assertion stays identical.
- **Tests that assert batch-0-only behavior and use no course fixtures** (housekeeping, horizon-probe-query-present, cleanup): stay on `BATCH_0_CRON` and are unaffected — just confirm green.
- **The `runHorizonProbe` / `checkV4Upgrades` unit tests** call those functions directly (no batch) — unaffected; confirm green.

Do NOT touch `cron-handler.ts` production code in this phase. **DO NOT** weaken an assertion to make a test pass; if the lane change makes one impossible to preserve, STOP and raise it.

**Step 5 — Run the FULL suite** (`npm test`) and confirm green — not just `batch`. The whole point of this task is that `cron-handler.test.ts` must pass too before committing.

**Step 6 — Commit:**
```bash
git add src/lib/batch.ts src/lib/batch.test.ts src/lib/cron-handler.test.ts
git commit -m "fix(cron): route all chronogolf polling through a single batch lane"
```

**BEFORE marking Phase 1 complete:**
1. Review tests against `docs/pitfalls/testing-pitfalls.md`.
2. Verify coverage: lane assignment, no-chronogolf-outside-lane, non-lane balance, empty/edge inputs, determinism, and all repaired cron-handler tests. (The `sleepAfterPoll` change is Phase 2 — the `=== 2500` assertion is unchanged here.)
3. Run `npm test` (full suite) and confirm green.

---

## Phase 2 — Per-Request Throttle in `ChronogolfAdapter` (`src/adapters/chronogolf.ts`)

**Execution Status:** ⬜ NOT STARTED

**Files:**
- Modify: `src/adapters/chronogolf.ts` (add throttle)
- Modify (tests): `src/adapters/chronogolf.test.ts`
- Modify: `src/lib/batch.ts` + `src/lib/batch.test.ts` (Task 2.3 — remove the now-superseded Chronogolf `sleepAfterPoll` special-case, atomic with the throttle)

**BEFORE starting work:** invoke `superpowers:test-driven-development`; read `docs/pitfalls/testing-pitfalls.md`.

**Pitfall watch:** TIME-1 — `Date.now()` for elapsed/interval timing is fine (TIME-1 is about *date strings*, not numeric timing); do NOT derive any date string here. CF-1 — no `process.env`.

**Preserve assertion rigor under pressure:** this phase tests timing-sensitive code with fake timers. If any assertion races or flakes, the fix is deterministic synchronization (fake-timer advancement / awaiting the in-flight promise) — **NOT** assertion removal or weakening. Prefer mechanism assertions (e.g., "the second fetch happened ≥ T after the first") over symptom assertions. If synchronization can't make it pass reliably, STOP and raise.

### Task 2.1 — Add a constructor-injectable min-interval throttle

**Design:** instance-level reservation gate. The registry constructs one `ChronogolfAdapter` reused for all Chronogolf courses in an invocation, so instance state spaces **all** Chronogolf requests (across pages AND across courses) within the single lane. Constructor injection keeps existing tests fast (`{ minRequestIntervalMs: 0 }`) and lets throttle tests use a small interval.

**Step 1 — Write failing tests** (`src/adapters/chronogolf.test.ts`):
```ts
// Uses fake timers. Asserts spacing across pages within one poll AND across polls.
it("spaces consecutive requests by at least the min interval (incl. pagination)", async () => {
  vi.useFakeTimers();
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ status: "ok", teetimes: makeFullPage() }), { status: 200 })
  ); // full page (24) forces another page → ≥2 requests
  const adapter = new ChronogolfAdapter({ minRequestIntervalMs: 1000 });
  const callTimes: number[] = [];
  fetchSpy.mockImplementation(async () => { callTimes.push(Date.now()); return new Response(JSON.stringify({ status: "ok", teetimes: makeFullPage() }), { status: 200 }); });
  // Drain every throttled setTimeout deterministically — no reliance on private MAX_PAGES.
  let settled = false;
  const promise = adapter.fetchTeeTimes(cfg, "2026-06-09").finally(() => { settled = true; });
  while (!settled) { await vi.advanceTimersByTimeAsync(1000); }
  await promise;
  expect(callTimes.length).toBeGreaterThan(1); // pagination actually ran multiple requests
  for (let i = 1; i < callTimes.length; i++) {
    expect(callTimes[i] - callTimes[i - 1]).toBeGreaterThanOrEqual(1000);
  }
  vi.useRealTimers();
});

it("does not delay when minRequestIntervalMs is 0", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "ok", teetimes: [] }), { status: 200 }));
  const adapter = new ChronogolfAdapter({ minRequestIntervalMs: 0 });
  await expect(adapter.fetchTeeTimes(cfg, "2026-06-09")).resolves.toBeInstanceOf(Array); // no hang under real timers
});
```
**FIRST read the existing `src/adapters/chronogolf.test.ts`** and reuse its existing `CourseConfig` fixture and response-shape helpers rather than inventing new ones. Concretely:
- `cfg`: a `CourseConfig` with `platformConfig: { courseId: "9602" }`, `id: "baker-national"`, `bookingUrl: "https://example.com"` (mirror whatever the existing tests already build).
- `makeFullPage()`: returns an array of exactly `PAGE_SIZE` (24) minimal valid `ChronogolfTeeTime` objects (`{ start_time: "9:15", date, max_player_size: 4, default_price: { green_fee: 50, bookable_holes: 18 } }`) so the adapter's `length < PAGE_SIZE` break never triggers and pagination runs the full `MAX_PAGES`.
- **Timer-advance robustness:** do NOT reach into the private `MAX_PAGES` via `as any`, and do NOT assume a single advance covers the whole run. Use the project's established flush-until-resolved pattern (the `withTimers` helper in `cron-handler.test.ts`, or an inline loop: `while (!settled) { await vi.advanceTimersByTimeAsync(interval); }`). This drains each throttled `setTimeout` deterministically regardless of page count and avoids a hang or a premature assertion.
- Capture call timestamps inside the `fetch` mock (`callTimes.push(Date.now())`) and assert each consecutive gap `>= interval`. This asserts our throttle *mechanism*, not mocked transport behavior.

**Step 2 — Run, confirm fail** (constructor takes no opts; no throttle).

**Step 3 — Implement** in `src/adapters/chronogolf.ts`:
```ts
export const CHRONOGOLF_MIN_REQUEST_INTERVAL_MS = 1100; // ~0.9 req/sec; margin under Chronogolf's ~1 req/sec per-IP ceiling. See docs/plans/2026-06-08-chronogolf-rate-limit-pacing-plan.md.

export class ChronogolfAdapter implements PlatformAdapter {
  readonly platformId = "chronogolf";
  private static readonly PAGE_SIZE = 24;
  private static readonly MAX_PAGES = 10;

  private readonly minRequestIntervalMs: number;
  private nextAllowedAt = 0; // epoch ms; shared across all chronogolf requests in this invocation

  constructor(opts?: { minRequestIntervalMs?: number }) {
    this.minRequestIntervalMs = opts?.minRequestIntervalMs ?? CHRONOGOLF_MIN_REQUEST_INTERVAL_MS;
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const wait = this.nextAllowedAt - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.nextAllowedAt = Math.max(now, this.nextAllowedAt) + this.minRequestIntervalMs;
  }

  async fetchTeeTimes(config, date, _env?) {
    // ...unchanged setup...
    for (let page = 1; page <= ChronogolfAdapter.MAX_PAGES; page++) {
      await this.throttle();           // <-- before EVERY request, including pages
      const response = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { Accept: "application/json" } });
      // ...unchanged parsing / break-on-short-page...
    }
  }
}
```
Add a brief WHAT/WHY comment on `throttle()`: it bounds the Chronogolf request rate to ~1/`minRequestIntervalMs` across all Chronogolf requests in an invocation (pagination included); the single-lane invariant (change A) means only one invocation polls Chronogolf at a time, so `nextAllowedAt` is never contended across invocations — a value left over in a warm isolate is always in the past and simply causes no wait. Comment must be evergreen (no "new"/"old"/temporal language, per the Code Comments rules).

**Step 4 — Run, confirm green.**

### Task 2.2 — Keep existing adapter tests fast

Audit `src/adapters/chronogolf.test.ts`: any test that constructs `new ChronogolfAdapter()` and runs under real timers will now incur ~1.1 s/request. Update those constructions to `new ChronogolfAdapter({ minRequestIntervalMs: 0 })` so they stay fast and deterministic. Do **not** change their assertions. The registry (`src/adapters/index.ts`) keeps `new ChronogolfAdapter()` (default interval) — verify it compiles and no test asserts the registry instance's interval. Also confirm the **adapter smoke test** (CI, real Chronogolf API) is unaffected — it makes few requests, so the 1.1 s spacing adds at most a couple seconds and must not be given `interval: 0` (the smoke test should exercise the real throttle).

### Task 2.3 — Remove the now-superseded Chronogolf `sleepAfterPoll` special-case (atomic with the throttle)

Now that per-request spacing lives in the adapter, the 2500 ms per-poll sleep is redundant (it would double-space and waste wall-clock). Remove it **in the same commit** as the throttle so the branch never carries both.

**Step 1 — Update the test** in `src/lib/batch.test.ts` `describe("sleepAfterPoll")`:
```ts
it("returns the default 250ms for chronogolf — per-request spacing now lives in ChronogolfAdapter", () => {
  expect(sleepAfterPoll("chronogolf")).toBe(250);
});
```
(Replaces the old `=== 2500` assertion. Keep the other-platforms and unknown-platform assertions unchanged.)

**Step 2 — Run, confirm fail.**

**Step 3 — Implement** in `src/lib/batch.ts`: delete only the `chronogolf: 2500` entry from `SLEEP_AFTER_POLL_MS` (map becomes empty → `chronogolf` falls through to `DEFAULT_SLEEP_AFTER_POLL_MS`). Update the map's doc-comment to point at `ChronogolfAdapter`'s throttle as the spacing mechanism and reference this plan; remove the stale "2500 ms per the design doc's tuning rubric" prose. **DO NOT** remove the `SLEEP_AFTER_POLL_MS` map or the `sleepAfterPoll` function — they remain the general per-platform mechanism (other platforms keep the 250 ms default). Only the `chronogolf` entry goes.

**Step 4 — Run, confirm green.**

**Step 5 — Commit (throttle + sleep removal together):**
```bash
git add src/adapters/chronogolf.ts src/adapters/chronogolf.test.ts src/lib/batch.ts src/lib/batch.test.ts
git commit -m "fix(chronogolf): throttle every request incl. pagination to ~1 req/sec"
```

**BEFORE marking Phase 2 complete:**
1. Review tests against `docs/pitfalls/testing-pitfalls.md` (real-API vs mocked: the throttle test asserts our *spacing logic* — the mock is the transport, the assertion is on our throttle timing, which is legitimate, not "testing mocked behavior").
2. Verify coverage: spacing across pages, spacing across polls (call `fetchTeeTimes` twice on the same instance), interval=0 fast path, `sleepAfterPoll("chronogolf") === 250`, and the existing parse/hole-variant tests still green.
3. Run `npm test` and confirm green (and FAST — no multi-second hangs).

---

## Phase 3 — Lane Deadline + Fair Ordering (`src/lib/cron-handler.ts`)

**Execution Status:** ⬜ NOT STARTED

**Files:**
- Modify: `src/lib/cron-handler.ts`
- Modify (tests): `src/lib/cron-handler.test.ts`

**BEFORE starting work:** invoke `superpowers:test-driven-development`; read `docs/pitfalls/testing-pitfalls.md`.

**Pitfall watch:** DB-1 — if you touch any SQL timestamp comparison, use `sqliteIsoNow()`; this phase adds **no** SQL. TIME-1 — `Date.now()` for the deadline is fine; the `pollTimeMap` already holds ISO strings, parse with `new Date(...).getTime()` (consistent with existing `cron-handler.ts:238`). CF-1 — uses the `env` already passed in.

**Preserve assertion rigor under pressure:** the deadline test is timing-sensitive (fake timers). If it races, fix with deterministic timer advancement, never by weakening the assertion. Assert the *mechanism* (loop stops issuing polls once the deadline passes; remaining courses deferred), not just a symptom.

### Task 3.1 — Make the lane budget injectable + add the deadline

**Step 1 — Write failing test** (`src/lib/cron-handler.test.ts`):
```ts
it("stops the chronogolf lane when its wall-clock budget is reached, deferring remaining polls", async () => {
  // Many chronogolf courses in the lane; tiny budget forces truncation.
  const courses = Array.from({ length: 40 }, (_, i) => makeCourseRow(`chrono-${String(i).padStart(2,"0")}`, "chronogolf"));
  mockedGetPollingDates.mockReturnValue(["2026-04-15"]); // 1 date
  mockedShouldPollDate.mockReturnValue(true);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const db = makeMockDb(courses);
  const result = await withTimers(() => runCronPoll(
    { DB: db } as unknown as CloudflareEnv, BATCH_0_CRON,
    { chronogolfLaneBudgetMs: 1000 } // budget allows only a few polls at 250ms sleep each
  ));
  expect(result.pollCount).toBeLessThan(40);            // truncated
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("chronogolf lane"));
  warnSpy.mockRestore();
});
```
**Test placement note:** `cron-handler.test.ts` defines a *separate* `makeMockDb` inside each `describe` block, and only some accept a `pollLog` second arg. Put the new Task 3.1 + 3.2 lane tests in a **new `describe("runCronPoll chronogolf lane")` block** with a `makeMockDb(courses, pollLog)` modeled on the one in the existing `"runCronPoll batch filtering"` block (which already wires `poll_log` results). Chronogolf courses land in batch 0 = the lane after Phase 1, so these tests use `BATCH_0_CRON`.

The `chronogolfLaneBudgetMs` opt is a **test seam only** — it defaults to the `CHRONOGOLF_LANE_BUDGET_MS` constant and is intentionally NOT wired to any env var or runtime config (YAGNI; tune the constant in code if production needs a different value).

**Step 2 — Run, confirm fail.**

**Step 3 — Implement** in `src/lib/cron-handler.ts`. The deadline MUST bound **all** batch-0 Chronogolf work — the active loop, the inactive-probe loop, AND the horizon probe (which runs after them in batch 0 and also issues Chronogolf requests). Use a dedicated flag, NOT `budgetExhausted` (which means *subrequest* budget and is returned in the result — keep its meaning intact):
- Add constant: `export const CHRONOGOLF_LANE_BUDGET_MS = 210_000; // 3.5 min — leaves margin under the 5-min peak cron period for housekeeping + inactive probing + horizon probe. See the pacing plan's Volume Math.`
- Import `CHRONOGOLF_LANE` from `@/lib/batch`.
- Add an optional 3rd param: `runCronPoll(env, cronExpression, opts: { chronogolfLaneBudgetMs?: number } = {})`; `const laneBudgetMs = opts.chronogolfLaneBudgetMs ?? CHRONOGOLF_LANE_BUDGET_MS;`
- At the start of the active-poll section: `const inLane = batchIndex === CHRONOGOLF_LANE;` and `const laneDeadline = inLane ? Date.now() + laneBudgetMs : Infinity;` (non-lane batches get `Infinity` → the guard is a no-op for them, so their behavior and tests are unchanged).
- Declare `let laneTimeUp = false;` near the existing `budgetExhausted`. A small helper keeps the three call sites DRY: `const laneExpired = () => { if (!laneTimeUp && Date.now() > laneDeadline) { laneTimeUp = true; console.warn(\`Batch ${batchIndex}: chronogolf lane time budget reached (${laneBudgetMs}ms), deferring remaining polls\`); } return laneTimeUp; };`
- **Active loop:** add `if (laneExpired()) break;` to the date-outer loop condition/top AND before each course poll (so both the date and course loops stop). Do NOT set `budgetExhausted`.
- **Inactive-probe loop:** at the top of the per-course body add `if (laneExpired()) break;`.
- **Horizon probe:** pass the deadline through as a field on `runHorizonProbe`'s **existing** `budget` object param — change it from `{ remaining: number }` to `{ remaining: number; deadlineMs?: number }`, and inside its per-course and per-date loops add `if (Date.now() > (budget.deadlineMs ?? Infinity)) break;`. Defaulting absent `deadlineMs` to `Infinity` keeps the existing `runHorizonProbe` unit tests (which pass `{ remaining: 500 }`) working unchanged. In `runCronPoll`, set `budget.deadlineMs = laneDeadline` (finite only when `inLane`, else `Infinity`) when constructing the object passed to `runHorizonProbe`. This guarantees batch-0 total Chronogolf wall-clock ≤ `laneBudgetMs` regardless of which loop is running.
- Housekeeping (cleanup queries, v4 check) is cheap and not Chronogolf-throttled — it runs after the deadline-bounded work and needs no guard, but it is the reason the budget reserves ~90 s under the 5-min period.

**Step 4 — Run, confirm green.** Add a second assertion to the Step 1 test: `expect(result.budgetExhausted).toBe(false);` — proving the time deadline does NOT masquerade as subrequest-budget exhaustion (guards against the conflation this fix avoids).

### Task 3.2 — Oldest-first ordering within each date (fair truncation)

**Step 1 — Write failing test:**
```ts
it("polls least-recently-polled chronogolf courses first (fair rotation under truncation)", async () => {
  const courses = [
    makeCourseRow("chrono-fresh", "chronogolf"),
    makeCourseRow("chrono-stale", "chronogolf"),
  ];
  // chrono-fresh polled 1 min ago; chrono-stale polled 50 min ago → stale goes first
  const now = new Date("2026-04-15T07:00:00-05:00");
  const pollLog = [
    { course_id: "chrono-fresh", date: "2026-04-15", last_polled: new Date(now.getTime() - 60_000).toISOString() },
    { course_id: "chrono-stale", date: "2026-04-15", last_polled: new Date(now.getTime() - 3_000_000).toISOString() },
  ];
  mockedGetPollingDates.mockReturnValue(["2026-04-15"]);
  mockedShouldPollDate.mockReturnValue(true);
  const db = makeMockDb(courses, pollLog);
  await withTimers(() => runCronPoll({ DB: db } as unknown as CloudflareEnv, BATCH_0_CRON));
  const order = mockedPollCourse.mock.calls.map((c) => c[1].id);
  expect(order.indexOf("chrono-stale")).toBeLessThan(order.indexOf("chrono-fresh"));
});
```

**Step 2 — Run, confirm fail** (default order is id-sorted → fresh before stale).

**Step 3 — Implement:** for `inLane` only, within the date-outer loop, order the active courses for the current date by last-polled ascending (never-polled = 0 → first):
```ts
const lastPolledMs = (course: CourseRow, date: string): number => {
  const lp = pollTimeMap.get(`${course.id}:${date}`);
  return lp ? new Date(lp).getTime() : 0;
};
// inside the date loop:
const orderedCourses = inLane
  ? [...activeCourses].sort((a, b) => lastPolledMs(a, dates[i]) - lastPolledMs(b, dates[i]))
  : activeCourses;
for (const course of orderedCourses) { /* ...existing... */ }
```
Keep non-lane batches on the existing order (no behavior change for them).

**Step 4 — Run, confirm green.**

### Task 3.3 — Verify the suite is green (lane-broken tests were already repaired in Phase 1 Task 1.3)

The `cron-handler.test.ts` tests broken by the *lane change* were retargeted to `BATCH_1_CRON` back in **Phase 1 Task 1.3** (so Phase 1 committed green). This phase only *adds* the deadline/ordering tests (Tasks 3.1, 3.2), which intentionally use `chronogolf` fixtures + `BATCH_0_CRON`. Confirm the whole file is consistent and green; do not re-do the Phase 1 retargets.

**`worker.ts` compatibility:** the Worker `scheduled()` handler calls `runCronPoll(env, controller.cron)`. The new optional 3rd param has a default, so `worker.ts` needs **no change** — but Phase 5 verification MUST confirm `worker.ts` still type-checks against the new signature.

**DO NOT** weaken any assertion to make a test pass. If a green suite can't be achieved without weakening, STOP and raise it — that signals a design problem, not a test problem.

**Step 5 — Commit:**
```bash
git add src/lib/cron-handler.ts src/lib/cron-handler.test.ts
git commit -m "fix(cron): bound chronogolf lane wall-clock + poll oldest dates first"
```

**BEFORE marking Phase 3 complete:**
1. Review tests against `docs/pitfalls/testing-pitfalls.md`.
2. Verify coverage: deadline truncation, oldest-first ordering, inactive-loop deadline, non-lane batches unchanged, all repaired tests green.
3. Run `npm test -- cron-handler` and confirm green.

**After completing Phases 1–3 (the code group):**
Review the batch from multiple perspectives. **Minimum 3 review rounds** (`superpowers:requesting-code-review` + `feature-dev:code-reviewer`). Each round MUST probe: does the lane truly serialize all Chronogolf requests (active + inactive + horizon)? Does the throttle cover pagination? Does the deadline keep the lane under the 5-min peak period and 15-min hard cap? Does it starve other platforms? Is the 403/undici concern correctly excluded? Are the numbers justified by the Volume Math? If round 3 still finds issues, keep going until clean. Record the rounds for the PR.

---

## Phase 4 — Docs, Pitfalls, Memory

**Execution Status:** ⬜ NOT STARTED

**Files:**
- Modify: `docs/plans/2026-04-20-chronogolf-rate-limit-fix.md` (append a "2026-06-08 structural follow-up" section: the per-invocation-vs-per-IP root cause, why sleep-tuning regressed, and the lane+throttle+deadline fix; link to this plan).
- Modify: `docs/pitfalls/implementation-pitfalls.md` — add a new pitfall in §2 (CF Runtime) **CF-4: "Per-invocation pacing cannot bound a per-IP rate limit"** (Flaw → Why → Fix → Lesson; the Fix points at the lane + per-request throttle + wall-clock deadline; note the deliberate `weight=1` subrequest undercount). Then **follow Appendix C's "Completeness Checklist" in full** — TOC range, §2.C review checklist item, Appendix B summary row, Appendix A changelog entry, and the cross-reference check against `testing-pitfalls.md`. Do not do a partial update (the doc warns that partial updates cause drift). (Config/docs — not TDD-scoped.)
- Modify: `docs/plans/2026-06-08-followup-prompts.md` — mark Prompt 3 (Chronogolf 429) status with this PR.
- Update auto-memory `project_cps_chronogolf_polling_failures.md` (this lives OUTSIDE the repo at `C:\Users\Sam\.claude\projects\c--Users-Sam-Code-twin-cities-tee-times\memory\` — it is **not** part of the git commit below; update it with the Write tool separately): note the Chronogolf 429 structural fix shipped (lane + per-request throttle + deadline), leaving the CPS auth failure as the remaining systemic issue. It's an *update* to an existing memory, so no new `MEMORY.md` index line is needed.

No code, no tests. Commit (repo docs only — the auto-memory file is external and not staged):
```bash
git add docs/ && git commit -m "docs(chronogolf): record per-IP-vs-per-invocation root cause + lane fix (CF-4)"
```

---

## Phase 5 — Verification + PR

**Execution Status:** ⬜ NOT STARTED

**BEFORE claiming done:** invoke `superpowers:verification-before-completion`.

1. Full local gate (run from the worktree):
   - `npm test` — all green.
   - `npx tsc --noEmit` — clean.
   - `npm run lint` — clean.
   - `npx @opennextjs/cloudflare build` — succeeds. If this can't run on the Windows dev/worktree environment, rely on CI's `build` job (it runs on Ubuntu and is the source of truth). A local-only OpenNext/Windows build-env failure is NOT a code defect and MUST NOT be reported as one — distinguish it from an actual compile/type error surfaced by `tsc`.
2. Confirm the smoke-test 403/undici Chronogolf skip is untouched and still correct (out of scope — only confirm, don't modify).
3. Push branch, open PR to **`dev`** (never `main`). PR body MUST include: the root-cause summary, the Volume Math, the 3-round plan-review trail, the 3-round code-review trail, and the post-deploy verification note.
4. Conventional Commits throughout. Merge authority: this is rate-limit/polling-cadence behavior → likely **Review-class** (Sam merges), not auto-merge. State the classification in the PR.

**Post-deploy verification (after merge to `main` deploys):** via `/check-logs` — the Chronogolf 429 count should fall to ~0 over a week. If a polite ~1 req/sec still shows material 429s, the limit is sub-1-req/sec or per-key → escalate per the fallback rubric below.

---

## Fallback (documented, NOT built)

If post-deploy `/check-logs` shows the lane at ~1 req/sec STILL produces material Chronogolf 429s:
1. **Tune first:** raise `CHRONOGOLF_MIN_REQUEST_INTERVAL_MS` (1100 → 1500 → 2000 ms) and re-verify across a full hour (per the 2026-04-20 doc's lesson that short windows under-sample). This trades far-date freshness for a lower rate.
2. **If sub-1-req/sec is confirmed insufficient even tuned:** probe per-IP vs per-key — route ONE test Chronogolf call through the existing no-VPC Lambda fetch proxy (rotating AWS egress IPs). If the proxy call succeeds while direct 429s, the limit is per-IP and the proxy is a viable (if circumvention-flavored) escape hatch — add `chronogolf.com` to `lambda/fetch-proxy/index.mjs` `ALLOWED_HOSTS` and route the adapter through `proxyFetch`. **This was explicitly deferred** (2026-06-08 decision): the proxy dodges the limit by IP-rotation rather than reducing load, and we don't need the throughput, so it's last-resort only.
3. **Out of scope (do not touch):** the 403 "TLS fingerprint block from Node.js undici" seen in the CI smoke test is a Node-only artifact; production uses the Workers `fetch` TLS stack. The smoke test already skips it gracefully.

---

## Execution Strategy Recommendation

**Recommended: execute sequentially in THIS session (not fresh subagents).** Reasoning:
- The three code phases are tightly coupled (shared root-cause model, shared constants, shared invariant) and sequential (Phase 3 imports Phase 1's `CHRONOGOLF_LANE`).
- This session holds the full root-cause context; a fresh subagent would risk interpretation drift on the subtle invariant (e.g., the horizon-probe-in-batch-0 reasoning) and on which test changes are intentional vs. regressions.
- It's a focused, risky production hotfix that warrants concentrated attention over parallelism.
- Each phase is one file (+ its test), so cross-task conflicts are nil; in-session sequential gives the fastest correct path with code review after the code group (Phases 1–3).

This matters: rationale is `writing-plans-enhanced` Step 5 + Step 2.
