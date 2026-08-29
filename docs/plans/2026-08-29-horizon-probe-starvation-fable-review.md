# Horizon Probe Starvation — Claude Fable Review

**Date:** 2026-08-29
**Reviewer:** Claude Fable, acting as Sam's delegated design approver and senior code reviewer
**Worktree:** `C:\Users\Sam\Code\twin-cities-tee-times\.claude\worktrees\fix-horizon-probe-starvation`
**Review base:** `43b3ebd`
**Implementation snapshot:** uncommitted working-tree diff; no HEAD SHA existed at review time

## Design review record

### Initial verdict: CHANGES_REQUIRED

The dedicated batch-0 `:30` maintenance cycle was judged to be the right architecture: it preserves active-poll freshness, avoids a new cron trigger, and keeps Chronogolf work in one bounded lane. The initial design required these corrections before implementation:

1. Pass Cloudflare's `ScheduledController.scheduledTime` through `worker.ts`; use scheduled time for Central-Time cadence and date selection, and execution time for deadlines and operational timestamps.
2. Track per-course probe completion explicitly. Budget or deadline interruption before the first offset or during a course must leave `last_horizon_probe` unstamped, while any monotonic horizon gain already discovered may persist.
3. Make due-course order deterministic: NULL `last_horizon_probe` first, then timestamp ascending, then course ID ascending.
4. Keep the dedicated path horizon-only and remove horizon queries from ordinary active cycles.
5. Add regression coverage for delayed delivery, Central-Time boundaries, batch isolation, deterministic ordering, interruption semantics, and independence from an exhausted ordinary lane.
6. Emit compact progress telemetry so renewed starvation is visible.

The review also accepted the bounded risk that a repeatedly deadline-consuming oldest course could remain at the head of the due queue. Telemetry is the appropriate first response; a new attempt-progress schema is not justified unless production demonstrates that risk.

### Revised-design verdict: APPROVE

The revised design incorporated every required correction. It cleanly separated scheduled-time semantics from execution-time semantics, isolated maintenance from polling and housekeeping, specified deterministic ordering and completion stamping, preserved the 210-second Chronogolf lane, and included the required regression matrix. Two implementation details were called out: use `Date.now() >= deadline` for horizon maintenance and begin its 210-second budget only after entering the maintenance path.

## Implementation review

### Scope reviewed

Read-only review of the uncommitted diff from `43b3ebd` covered:

- `worker.ts`
- `src/lib/cron-handler.ts`
- `src/lib/cron-handler.test.ts`
- `src/lib/format.ts`
- Relevant existing polling, D1 timestamp, Central-Time, and Chronogolf lane contracts

The implementation is appropriately bounded: four files changed, no schema or Wrangler configuration change, and the only shared helper change is allowing `todayCT` to format an injected `Date` while preserving its default behavior.

### Findings

#### Important — delayed-delivery test does not verify the scheduled-date or operational-clock halves of the contract

**Resolution:** RESOLVED in the focused test-only revision reviewed on 2026-08-29.

**Location:** `src/lib/cron-handler.test.ts:599-624`; production contract at `src/lib/cron-handler.ts:246-268` and `src/lib/cron-handler.ts:386-390`

The test named `uses the trigger's scheduled time when delivery is delayed` sets execution time to 2026-04-15 13:07 CT and scheduled time to 2026-04-15 20:30 CT. Because both are on the same Central calendar date, its expected probe date is identical whether `todayCT` receives `scheduledAt` or accidentally falls back to the execution clock. The test proves that scheduled time selects the maintenance cadence, but it does not prove that scheduled time selects `todayStr`. No test asserts the complementary requirement that operational timestamps such as `last_had_tee_times` use execution time rather than scheduled time.

**Required fix:** make the delayed-delivery case realistic and discriminating by placing execution on a later Central calendar date than the scheduled `:30` event, then assert the horizon date derived from the scheduled date. Add or extend an ordinary successful-poll test with different scheduled and execution instants and assert the `last_had_tee_times` bind uses the execution timestamp. These tests should fail if either clock is swapped or collapsed into the other.

This is a coverage defect rather than an observed production-code defect: the current source uses `todayCT(scheduledAt)` and a separate execution-time `operationalNow` correctly. It is Important because the two-clock distinction was a required design correction and the project requires tests to comprehensively guard production behavior.

The corrected maintenance test now sets execution to 2026-04-16 13:07 CT while retaining a scheduled event of 2026-04-15 20:30 CT, and expects the horizon date derived from April 15. Falling back to the execution date would produce April 29 instead of the asserted April 28. A new ordinary-polling test separately proves both halves of the contract: `getPollingDates` receives scheduled-date `2026-04-15`, while the successful poll's `last_had_tee_times` bind receives execution timestamp `2026-04-16T18:07:00.000Z`.

### Critical findings

None.

### Important findings

None open. The sole Important finding was resolved by the focused test revision above.

### Minor findings

None.

## Correctness assessment

- The maintenance predicate is restricted to batch 0, Central minute 30, and hours 20:00 through 04:59. The 19:30, 20:30, 04:30, and 05:30 boundaries are covered.
- Cloudflare's scheduled timestamp is passed through the worker boundary and drives cadence and Central date selection; wall-clock execution time drives the maintenance deadline and operational timestamps.
- The maintenance branch returns before all ordinary course loading, recent-poll loading, active/inactive polling, cleanup, and CPS v4 upgrade work.
- Ordinary cycles no longer query `last_horizon_probe` eligibility.
- The D1 due query preserves the enabled/active filters and explicitly orders NULL timestamps first, then timestamps and IDs ascending. The existing ISO timestamp comparison helper is used, avoiding the SQLite space-versus-`T` comparison pitfall.
- `runHorizonProbe` checks `Date.now() >= deadline`, respects platform-weighted budget, persists only upward horizon movement, and withholds `last_horizon_probe` when interrupted before or during a course.
- A fully attempted course, including one already at `MAX_HORIZON`, is stamped complete. Per-offset adapter errors retain the pre-existing meaning of an attempted offset and do not abort later courses.
- A budget/deadline partial stops the invocation after recording the affected course, which preserves the global lane bound. The summary exposes eligible, completed, partial, probe count, and partial IDs.
- No secret, PII, destructive database behavior, backward-compatibility layer, schema change, or cross-lane Chronogolf path was introduced.
- File comments remain evergreen and the production changes follow surrounding style.

## Verification evidence

The implementer reported:

- Targeted TDD red/green execution completed.
- `npm test`: 59 files and 779 tests passed, with six pre-existing canvas warnings.
- `npx tsc --noEmit`: passed.
- ESLint: zero errors and three pre-existing warnings.
- `npx @opennextjs/cloudflare build`: completed with standard Windows compatibility warnings.
- `git diff --check 43b3ebd`: no whitespace errors; Git only reported the worktree's existing LF-to-CRLF conversion warnings.
- Focused horizon-maintenance scheduling tests after review repair: 7 passed.
- Complete `src/lib/cron-handler.test.ts` after review repair: 61 passed.

The reviewer did not rerun commands that could write caches or generated files because the delegated review explicitly allowed only this persistent report to be written.

## Final implementation verdict

**APPROVE**

The production implementation is aligned with the approved design, no source correctness defect was found, and the only implementation-review finding has been resolved with discriminating tests. The focused delta changes tests only and directly guards both sides of the scheduled-time/execution-time contract.

**Delegated approval as Sam's stand-in:** Granted.

**Ready to commit/PR:** Yes. The branch is ready to commit and proceed through the repository's normal PR and CI workflow. The full-suite, type-check, lint, and Cloudflare build evidence predates the test-only review repair; the focused scheduling suite and complete cron-handler file passed afterward. Re-running the repository's normal pre-commit/CI checks remains required by project workflow but is not a review blocker.
