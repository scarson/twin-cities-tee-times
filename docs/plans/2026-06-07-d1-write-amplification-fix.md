# D1 Write-Amplification Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Stop the ~$125/mo D1 rows-written overage by making `upsertTeeTimes` skip the write when fetched tee times are unchanged (compare-then-replace), while keeping freshness UX correct and the change rate measurable.

**Architecture:** `upsertTeeTimes` reads the current rows for a `(course_id, date)`, compares them as a normalized multiset against the freshly-fetched set, and skips the DELETE+INSERT entirely when nothing changed. The write stays a full atomic `db.batch` (never a partial diff) so a stale-snapshot skip is provably benign under concurrent writers. Because skipping writes makes per-row `tee_times.fetched_at` mean "last *changed*" rather than "last *checked*", the course-detail freshness UI is migrated to `poll_log.polled_at` (the courses-list routes already use it). A new `poll_log.content_changed` column records whether each poll wrote, so the real set-change rate becomes measurable. A past-date `tee_times` prune job removes accumulated dead rows.

**Tech Stack:** TypeScript 5 (strict), Cloudflare D1 (SQLite) via `@cloudflare/workers-types`, Next.js 16 App Router API routes, React 19 components, Vitest 4. Path alias `@/` → `src/`.

**Provenance:** Design decided this session via a 5-round adversarial review. Rationale and rejected alternatives (row-level diff, stored-hash) live in `memory/project_d1_bill_write_amplification.md`. Root-cause diagnosis: that same memory file + `project_cps_chronogolf_polling_failures.md`.

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

**Overall:** Not started.

| Phase | Status | Ship SHA(s) | Notes |
|---|---|---|---|
| 1 — Compare-then-replace in `upsertTeeTimes` | ✅ Shipped (branch) | e4ba40b, f7c2424, 4725bb6 | On `fix/d1-write-amplification`; full suite + tsc + lint green. PR not yet opened (lands after Phases 2–5). |
| 2 — Measurability: `poll_log.content_changed` | ⬜ Not started | — | — |
| 3 — Freshness migration to `poll_log.polled_at` | ⬜ Not started | — | — |
| 4 — Past-date `tee_times` prune | ⬜ Not started | — | — |
| 5 — Pitfalls + verification docs | ⬜ Not started | — | — |
| Finalization — verify + open PR | ⬜ Not started | — | Review-class; Sam merges |

---

## Conventions for every task

**BEFORE starting any task:**
1. Invoke `superpowers:test-driven-development`.
2. Read `docs/pitfalls/testing-pitfalls.md` (test-scenario checklist) and the Time/D1 sections of `docs/pitfalls/implementation-pitfalls.md`.
3. Follow TDD strictly: write failing test → run & confirm it fails for the right reason → minimal implementation → run & confirm green.

**BEFORE marking any task complete:**
1. Review tests against `docs/pitfalls/testing-pitfalls.md` (error paths, edge cases, no testing-of-mocks, pristine output).
2. Run the full suite: `npm test` and `npx tsc --noEmit` and `npm run lint`. All green.
3. Commit with a Conventional Commits subject (see `CLAUDE.md` §Commit messages).

**Sequencing note (file overlap):** `src/lib/db.ts` is touched by Phases 1, 2, and 4; `src/lib/poller.ts` by Phases 1–2. Execute phases in numeric order in a single branch — do NOT parallelize these phases across agents (guaranteed merge conflicts). All work lands in ONE PR.

**Branch:** create one worktree+branch `fix/d1-write-amplification` per `docs/git-strategy.md` (`git worktree add .claude/worktrees/d1-write-amp -b fix/d1-write-amplification`). PR targets `dev`. This is a `Review`-class PR (data-integrity-adjacent) — Sam merges.

---

## Phase 1 — Compare-then-replace in `upsertTeeTimes`

**Execution Status:** ✅ SHIPPED to branch `fix/d1-write-amplification` (2026-06-08). Commits: `e4ba40b` (1.1 canonicalization helpers), `f7c2424` (1.2 compare-then-replace + caller + mock fix), `4725bb6` (1.3 integration-test rewrite). Full suite (719 tests) + `tsc --noEmit` + lint all green. Review gate run (4 rounds, no code changes required). PR opens after Phases 2–5 per the single-PR sequencing note. Deviation: the planned "NEW `src/lib/db.test.ts`" already existed (held `sqliteIsoNow` unit tests) — appended the canonicalization tests rather than overwriting, to preserve existing tests (`CLAUDE.md` §Testing).

**Why:** Root cause of the bill. `src/lib/poller.ts:75` calls `upsertTeeTimes` on every poll; `src/lib/db.ts:46` unconditionally runs `DELETE + N×INSERT`. With the table indexed on `(course_id, date)`, that is ~4× rows-written per tee time, every 5 min for today/tomorrow, regardless of change. Measured: ~10.07M inserts/week → ~175M writes/mo → ~$125 overage.

**The one correctness rule (load-bearing):** the only dangerous error is a *wrongly-equal* skip → stale availability shown to users. So canonicalization MUST be conservative — **when in doubt, declare changed.** `null`/`undefined` MUST render distinctly from `0`/`""`. Compare `price`/`open_slots` via `String(...)` of the typed value, never via re-coercion that can yield `NaN`. A `NaN` or throw in canonicalization MUST force "changed", never "equal".

### Task 1.1: Canonicalization + comparison helper

**Files:**
- Modify: `src/lib/db.ts` (add helpers above `upsertTeeTimes`)
- Test: `src/lib/db.test.ts` (NEW — pure unit tests, no D1)

**Nullability (match the actual types/schema):** `price` is `number | null` (`tee_times.price` REAL nullable, `TeeTime.price`), `nines` is `string | null` (nullable; `TeeTime.nines` is `string | undefined` → callers pass `?? null`). `time`, `holes`, `open_slots` are NON-null (schema `NOT NULL`, types `string`/`number`). So only `price` and `nines` need explicit null sentinels; the others can't be null. Even so, `String(null)` yields `"null"` (distinct from `"0"`/`""`), so the conservative property holds regardless — do NOT add casts to test impossible null inputs.

**Step 1 — Write failing tests** (`src/lib/db.test.ts`). Export the helpers from `db.ts` to test them. Cases:
```ts
import { describe, it, expect } from "vitest";
import { canonicalTeeTime, teeTimeSetsEqual } from "./db";

// canonicalTeeTime(time, price, holes, openSlots, bookingUrl, nines)
describe("canonicalTeeTime", () => {
  it("normalizes ISO time to HH:MM (matching the insert path)", () => {
    expect(canonicalTeeTime("2026-06-20T07:30:00", 45, 18, 4, "u", null))
      .toBe(canonicalTeeTime("07:30", 45, 18, 4, "u", null));
  });
  it("treats null price as DISTINCT from 0 (price is nullable)", () => {
    expect(canonicalTeeTime("07:30", null, 18, 4, "u", null))
      .not.toBe(canonicalTeeTime("07:30", 0, 18, 4, "u", null));
  });
  it("treats null nines as DISTINCT from empty string (nines is nullable)", () => {
    expect(canonicalTeeTime("07:30", 45, 18, 4, "u", null))
      .not.toBe(canonicalTeeTime("07:30", 45, 18, 4, "u", ""));
  });
  it("distinguishes a single open_slots change (4 vs 3)", () => {
    expect(canonicalTeeTime("07:30", 45, 18, 4, "u", null))
      .not.toBe(canonicalTeeTime("07:30", 45, 18, 3, "u", null));
  });
});

describe("teeTimeSetsEqual", () => {
  const k = (time: string, slots: number) => canonicalTeeTime(time, 45, 18, slots, "u", null);
  it("is order-independent (multiset)", () => {
    expect(teeTimeSetsEqual([k("07:30", 4), k("08:00", 4)], [k("08:00", 4), k("07:30", 4)])).toBe(true);
  });
  it("respects duplicate multiplicity", () => {
    expect(teeTimeSetsEqual([k("07:30", 4), k("07:30", 4)], [k("07:30", 4)])).toBe(false);
  });
  it("detects a single open_slots change (4 -> 3)", () => {
    expect(teeTimeSetsEqual([k("07:30", 4)], [k("07:30", 3)])).toBe(false);
  });
  it("empty vs empty is equal; empty vs non-empty is not", () => {
    expect(teeTimeSetsEqual([], [])).toBe(true);
    expect(teeTimeSetsEqual([], [k("07:30", 4)])).toBe(false);
  });
});
```

**Step 2 — Implement** in `src/lib/db.ts`:
```ts
/** HH:MM-normalize a tee time string the same way the INSERT path stores it. */
function canonicalTime(time: string): string {
  return time.includes("T") ? time.split("T")[1].substring(0, 5) : time;
}

/**
 * Canonical, comparison-safe representation of one tee time.
 * Conservative by design: serialized as a JSON array, so null is distinct from 0
 * and "" (a real change is never masked as "unchanged") and JSON string quoting
 * keeps each field unambiguous across boundaries.
 */
export function canonicalTeeTime(
  time: string,
  price: number | null,
  holes: number,
  openSlots: number,
  bookingUrl: string,
  nines: string | null
): string {
  // Ordered-array JSON: null serializes distinctly from 0 and "", and JSON quoting
  // keeps each field's contents from colliding across boundaries. No separator needed.
  return JSON.stringify([canonicalTime(time), price, holes, openSlots, bookingUrl, nines ?? null]);
}

/** True iff the two canonical-key arrays are equal as multisets. */
export function teeTimeSetsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}
```
**Do NOT** compare prices as floats with tolerance, hash, or use `JSON.stringify` of an *object* (key-order pitfalls); an ordered *array* via `JSON.stringify` is fine and is what `canonicalTeeTime` uses. **Do NOT** include `fetched_at` in the canonical key.

**Step 3 — Run** `npm test -- src/lib/db.test.ts`; confirm green. Commit: `feat(db): add conservative tee-time canonicalization for change detection`.

### Task 1.2: Make `upsertTeeTimes` compare-then-replace

**Files:**
- Modify: `src/lib/db.ts` (`upsertTeeTimes`, lines ~13-47)
- Modify: `src/lib/poller.ts:75` (capture return value)
- Test: `src/lib/db.integration.test.ts` (REWRITE expectations — see Task 1.3)

**Step 1 — Behavior change (current → desired):**
- Current: always `db.batch([DELETE, ...INSERT])`; returns `void`.
- Desired: `SELECT time, price, holes, open_slots, booking_url, nines FROM tee_times WHERE course_id=? AND date=?`; build canonical multiset of existing rows and of `teeTimes`; if `teeTimeSetsEqual` → **return `false` (no DB write)**; else run the existing atomic `db.batch([DELETE, ...INSERT])` and **return `true`**.
- Signature: `Promise<boolean>` (`true` = wrote/changed, `false` = skipped/unchanged).

**Step 2 — Implementation** (the INSERT path now calls the shared `canonicalTime` helper instead of its old inline `timeOnly` ternary — see the DRY note below):
```ts
export async function upsertTeeTimes(
  db: D1Database, courseId: string, date: string, teeTimes: TeeTime[], fetchedAt: string
): Promise<boolean> {
  const existing = await db
    .prepare("SELECT time, price, holes, open_slots, booking_url, nines FROM tee_times WHERE course_id = ? AND date = ?")
    .bind(courseId, date)
    .all<{ time: string; price: number | null; holes: number; open_slots: number; booking_url: string; nines: string | null }>();

  const existingKeys = existing.results.map((r) =>
    canonicalTeeTime(r.time, r.price, r.holes, r.open_slots, r.booking_url, r.nines));
  const fetchedKeys = teeTimes.map((tt) =>
    canonicalTeeTime(tt.time, tt.price, tt.holes, tt.openSlots, tt.bookingUrl, tt.nines ?? null));

  if (teeTimeSetsEqual(existingKeys, fetchedKeys)) {
    return false; // unchanged — skip the write entirely
  }

  // Full atomic replace. MUST stay a whole-set delete+insert (not a partial
  // diff): under a concurrent writer, a skip decision made against a stale
  // read is benign only because every write replaces the complete set
  // (last-writer-wins, never torn). A partial diff would reintroduce a race.
  const deleteStmt = db.prepare("DELETE FROM tee_times WHERE course_id = ? AND date = ?").bind(courseId, date);
  const insertStmts = teeTimes.map((tt) =>
    // canonicalTime is the SINGLE source of HH:MM normalization — the INSERT and
    // the comparison MUST normalize identically, or a stored value won't match its
    // own canonical key and every poll would look "changed".
    db.prepare(
      `INSERT INTO tee_times (course_id, date, time, price, holes, open_slots, booking_url, fetched_at, nines)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(courseId, date, canonicalTime(tt.time), tt.price, tt.holes, tt.openSlots, tt.bookingUrl, fetchedAt, tt.nines ?? null)
  );
  await db.batch([deleteStmt, ...insertStmts]);
  return true;
}
```

**Error handling (testing-pitfalls §1 "double-fault", §5 "error isolation"):** the new `SELECT` can throw a D1 error. It MUST propagate as an exception — do NOT wrap it to `return false`. A swallowed read error returning `false` would be a *silent skip*: stale availability shown AND the poll mislogged as success. Letting it throw means `pollCourse`'s existing `catch` logs it as `error` (the correct behavior). Add a test (in `db.integration.test.ts` or a unit test with a stub `db` whose `.all()` rejects) asserting `upsertTeeTimes` rejects rather than resolving `false` when the read fails.

**DRY:** `canonicalTime` must be defined once (Task 1.1) and used by BOTH the comparison and the INSERT. Do NOT keep a separate inline `timeOnly` ternary.

**Step 3 — Update the caller** `src/lib/poller.ts` (~line 70-79). `pollCourse` must capture the boolean and pass it to `logPoll` (wired in Phase 2). For Phase 1 alone, capture it into a local `const contentChanged = await upsertTeeTimes(...)` so Phase 2 can thread it; do not change `logPoll` yet. **Do NOT** change the `success`/`no_data` status logic (status is still `teeTimes.length === 0 ? "no_data" : "success"`).

**Step 4 — fix the existing mock** in `src/lib/poller.test.ts`: it mocks `upsertTeeTimes` and at ~line 211 calls `mockResolvedValue(undefined)`. The new `Promise<boolean>` return type makes that a type error — change it to `mockResolvedValue(false)` (or `true`). This is required for `tsc` to pass in Phase 1; the value is asserted on in Phase 2.

**Step 5** — run `npx tsc --noEmit` (caller signature) + `npm test`. Commit: `fix(db): skip tee-time rewrite when availability is unchanged`.

### Task 1.3: Rewrite `db.integration.test.ts` to the new contract

**Files:** Modify `src/lib/db.integration.test.ts`.

These tests currently assert delete+insert behavior; compare-then-replace **legitimately changes observable behavior** (unchanged poll = zero writes). This is the test correctly catching the intended change — **rewrite the assertions, do NOT delete the tests** (`CLAUDE.md` §Testing).

Required cases (use the real local D1 test harness already used in this file):
1. **First poll / empty-stored:** stored empty, fetched non-empty → rows inserted, `upsertTeeTimes` returns `true`.
2. **Unchanged poll → zero writes:** insert a set; call again with an equivalent set (same content, reordered, and with an ISO-vs-HH:MM `time` to prove normalization); assert return `false` AND that rows were NOT rewritten. Prove "not rewritten" by capturing each row's `fetched_at` (or `id`) before and asserting it is unchanged after — a fresh `fetched_at`/new `id` would mean a write happened.
3. **Changed poll → full replace:** change one `open_slots`; assert return `true` and the row reflects the new value.
4. **`no_data` (empty fetched) with prior rows:** fetched empty, stored non-empty → all rows deleted, returns `true`.
5. **`no_data` with no prior rows:** empty vs empty → returns `false`, no write.
6. **Multiset / duplicate multiplicity:** two genuinely distinct rows that share `(time, holes, nines)` but differ in `price` must still round-trip without being falsely merged or falsely equal (this also exercises the conservative-canonicalization guarantee).
7. **Atomicity preserved on the changed path (testing-pitfalls §4 "delete-then-insert atomicity", §8 "D1 batch partial failure"):** the changed path still uses a single `db.batch([DELETE, ...INSERT])`. Retain (or add) the existing test that a failing INSERT does not leave the course with its old rows deleted and no replacement — the delete+insert must remain one atomic batch. Do NOT split the DELETE and INSERTs into separate `.run()` calls.
8. **Read failure propagates (not a silent skip):** when the existing-rows `SELECT` rejects, `upsertTeeTimes` rejects — it does NOT resolve `false`. (See Task 1.2 error-handling note.)

**BEFORE marking complete:** if any assertion races/flakes, the fix is deterministic synchronization, NOT assertion weakening. The commit subject MUST state what happened to the assertions (e.g., `test(db): rewrite upsert assertions for compare-then-replace contract`).

### Phase 1 review gate
After 1.1–1.3: review the batch from multiple perspectives, minimum 3 rounds (correctness of the conservative-skip direction; the concurrency comment's claim; test rigor vs `testing-pitfalls.md`). If round 3 still finds issues, keep going until clean.

---

## Phase 2 — Measurability: `poll_log.content_changed`

**Execution Status:** ⬜ NOT STARTED

**Why:** The true set-change rate (including `open_slots`/`price` churn at constant count) is currently unmeasurable — `poll_log` stores only counts. We need it to confirm post-deploy that writes land < 50M/mo. The `poll_log` row is already inserted every poll, so widening it is near-free (no extra write, just a wider one).

### Task 2.1: Additive migration

**Files:** Create `migrations/0010_add_poll_content_changed.sql` (latest existing is `0009`).
```sql
-- Records whether a poll changed the stored tee times (1) or was a no-op skip (0).
-- Lets us measure the real set-change rate that drives D1 rows-written cost.
ALTER TABLE poll_log ADD COLUMN content_changed INTEGER NOT NULL DEFAULT 0;
```
Apply locally to verify: `npx wrangler d1 execute tee-times-db --local --file=migrations/0010_add_poll_content_changed.sql`. (Deploy workflow auto-applies on merge to `main`.) Migrations are config, not TDD-scoped. **Test harness:** `src/test/d1-test-helper.ts` reads and applies every `migrations/*.sql` in sorted order, so integration tests pick up `0010` automatically — no harness edit needed. Confirm `src/test/d1-test-helper.test.ts` still passes (it asserts migrations apply; an additive `ALTER` is fine). Commit: `feat(db): add poll_log.content_changed for change-rate measurement`.

### Task 2.2: Thread the boolean through `logPoll` and `pollCourse`

**Files:**
- Modify: `src/lib/db.ts` (`logPoll` signature + INSERT), `src/types/index.ts` (`PollLogRow`)
- Modify: `src/lib/poller.ts` (`pollCourse` passes `contentChanged`)
- Test: `src/lib/db.integration.test.ts` (logPoll cases), `src/lib/poller.test.ts`

**Behavior:** `logPoll(db, courseId, date, status, teeTimeCount, errorMessage?, contentChanged = false)` — add a trailing optional `contentChanged: boolean` param (default `false` so error-path callers and tests are unaffected). INSERT includes `content_changed` = `contentChanged ? 1 : 0`. Add `content_changed: number` to `PollLogRow`.

In `pollCourse`: Phase 1 Task 1.2 already changed the call site to `const contentChanged = await upsertTeeTimes(...)` and left `contentChanged` unused. This task consumes that local: change the success/`no_data` `logPoll` call to `await logPoll(db, course.id, date, status, teeTimes.length, undefined, contentChanged)`. The `catch`-block error `logPoll` call (and any other error-path callers) pass nothing → defaults to `false`. (If Phase 1 was not yet executed, that capture does not exist — execute phases in order.)

**Test mock:** to assert `content_changed` threading in `src/lib/poller.test.ts`, the `upsertTeeTimes` mock must return the intended boolean per case — `vi.mocked(upsertTeeTimes).mockResolvedValue(true)` for the changed case and `false` for the unchanged case — then assert the `logPoll` mock received the matching 7th argument. (Phase 1 Step 4 already changed the default mock from `undefined` to a boolean.)

**TDD:** test that an unchanged poll logs `content_changed = 0` and a changed poll logs `1`. **Do NOT** add `content_changed` to any user-facing API response — it is internal telemetry only. Commit: `feat(poller): record whether each poll changed stored tee times`.

### Phase 2 review gate
Minimum 3 rounds (default-param back-compat for existing callers; that error polls log `0` not a misleading `1`; no PII added to logs per `CLAUDE.md`).

---

## Phase 3 — Freshness migration to `poll_log.polled_at`

**Execution Status:** ⬜ NOT STARTED

**Why (REQUIRED, not cosmetic):** Skipping writes makes per-row `tee_times.fetched_at` mean "last *changed*", so a stable date polled every 5 min would show "Last updated 6h ago" and a false `* stale` badge on valid rows. Two consumers read per-row `fetched_at` for freshness and MUST move to `poll_log.polled_at` ("last *checked*"): `src/components/course-header.tsx:88-95` ("Last updated") and `src/components/tee-time-list.tsx:150-188` (`* stale` badge). The courses-LIST routes (`/api/courses`, `/api/courses/[id]`) already use `poll_log.polled_at` and are unaffected.

### Task 3.1: Return per-(course,date) poll freshness from `/api/tee-times`

**Files:** Modify `src/app/api/tee-times/route.ts`; Test: `src/app/api/tee-times/route.integration.test.ts`.

**Behavior:** add a `LEFT JOIN` to the latest successful/`no_data` poll per `(course_id, date)` and return it as `polled_at` on each tee time. Mirror the list-route pattern:
```sql
SELECT t.*, c.name AS course_name, c.city AS course_city, c.state AS course_state,
       p.polled_at AS polled_at
FROM tee_times t
JOIN courses c ON t.course_id = c.id
LEFT JOIN (
  SELECT course_id, date, polled_at,
         ROW_NUMBER() OVER (PARTITION BY course_id, date ORDER BY polled_at DESC) AS rn
  FROM poll_log
  WHERE polled_at > ${sqliteIsoNow("-24 hours")} AND status IN ('success','no_data')
) p ON t.course_id = p.course_id AND t.date = p.date AND p.rn = 1
WHERE t.date = ? AND c.disabled = 0
```
Keep all existing filters/ordering. The `idx_poll_log_course_date` index `(course_id, date, polled_at)` covers this join. **Query-performance guard (testing-pitfalls §4 "Query performance with large tables", §8):** the `WHERE polled_at > sqliteIsoNow("-24 hours")` filter on the window-function subquery is REQUIRED — without it the `ROW_NUMBER() OVER (...)` scans the entire `poll_log` (the exact prior full-scan bug). Use `sqliteIsoNow()`, never `datetime()` (implementation-pitfalls DB-1). Keep every value parameterized via `.bind()` (testing-pitfalls §8); `sqliteIsoNow()` is a controlled fragment, not user input, matching the existing list-route pattern. **TDD:** assert the response includes `polled_at` reflecting the most recent matching poll; `null` when no poll in 24h; and that a poll older than 24h does NOT appear (proves the filter is present). Commit: `feat(api): expose per-date poll freshness on tee-times`.

### Task 3.2: Point the stale badge at `polled_at`

**Files:** Modify `src/components/tee-time-list.tsx` + `src/lib/format.ts`; Tests: `src/components/tee-time-list.render.test.tsx`.

- `TeeTimeItem`: replace `fetched_at: string` with `polled_at: string | null`. (`mergeHoleVariants` spreads fields, so it carries through automatically — no change there.)
- `isStale(polledAt: string | null): boolean` → return `true` when `null` (unknown freshness = treat as stale), else the existing threshold check. `staleAge` keeps its `string` signature.
- **Null-safety in the JSX (correctness — avoid the epoch trap):** because `isStale(null)` is `true` but `staleAge(null)` would compute `new Date(null)` = epoch ("20000d old"), the age suffix MUST be guarded on non-null. Render:
  ```tsx
  {isStale(tt.polled_at) && (
    <span className="text-amber-600/70">
      * stale{tt.polled_at ? ` (${staleAge(tt.polled_at)})` : ""}
    </span>
  )}
  ```
  Do NOT call `staleAge(tt.polled_at!)` unguarded.
- Update the render test fixtures (`fetched_at` → `polled_at`) and add a case: `polled_at` 2h ago → badge shows; 5 min ago → no badge; `null` → badge shows.

**Cross-consumer check (context gap guard):** `TeeTimeList` is rendered by BOTH `src/app/courses/[id]/page.tsx` and the main time-first view `src/app/page.tsx`. After changing `TeeTimeItem` (`fetched_at` → `polled_at`), run `npx tsc --noEmit` and confirm `src/app/page.tsx` still compiles — it feeds `TeeTimeList` from `/api/tee-times` (which now returns `polled_at` per Task 3.1), so the data is present; fix any local type annotation in `page.tsx` that still names `fetched_at`. The main page does not read `fetched_at` directly.

Commit: `refactor(ui): base tee-time staleness on last poll time, not row write time`.

### Task 3.3: Point "Last updated" at `last_polled`; update detail page type

**Files:** Modify `src/components/course-header.tsx`, `src/app/courses/[id]/page.tsx`.

- `course-header.tsx`: replace the `oldestFetchedAt` derivation (lines 88-95) with `const displayTimestamp = course.last_polled;`. Then REMOVE the now-unused `teeTimes` prop: delete `teeTimes: { fetched_at: string }[];` from the `CourseHeaderProps` interface and the `teeTimes` parameter from the destructure. (Confirmed unused after the derivation is replaced — `teeTimes` was read ONLY by the deleted `oldestFetchedAt` block.) Keep the `dates` and `onRefreshed` props — they drive the Refresh button and are still used.
- `page.tsx`: drop `teeTimes={teeTimes}` from the `<CourseHeader ... />` call site.
- `page.tsx`: the inline `teeTimes` state type (line 27) `fetched_at: string` → `polled_at: string | null` so it satisfies the updated `TeeTimeList`.

**Do NOT** change the courses-list routes or `formatAge`. **Testing (firm decision — do NOT add a new course-header test):** this change *deletes* the `oldestFetchedAt` logic and replaces it with a mechanical `course.last_polled` read passed to the already-tested `formatAge`. `course-header` has no existing test harness, and standing up `useFavorites`/`useAuth` providers to assert a one-line swap is disproportionate (YAGNI). Freshness correctness is covered by Task 3.1 (API returns `last_polled`/`polled_at`) and the change is verified by `npx tsc --noEmit` + the existing course-detail behavior. If `tsc` flags an unused import (`formatAge` is still used; `teeTimes`-related imports may become unused), remove the dead import. Commit: `refactor(ui): source course-detail freshness from poll log`.

### Phase 3 review gate
Minimum 3 rounds (every `fetched_at` reader migrated — re-grep `fetched_at` across `src` excluding `db.ts`/types/tests to confirm none remain in display paths; null-freshness handling; the join doesn't drop rows when no poll exists — it's a LEFT JOIN).

---

## Phase 4 — Past-date `tee_times` prune

**Execution Status:** ⬜ NOT STARTED

**Why:** Nothing prunes past-date rows; `tee_times` holds rows back to 2026-03-09 (~90 dates, 164k rows) because `upsertTeeTimes` only touches today..+horizon. Dead weight + the "stale entries" Sam reported. Mirror the existing `cleanupOldPolls` pattern.

### Task 4.1: `cleanupPastTeeTimes` helper

**Files:** Modify `src/lib/db.ts`; Test: `src/lib/db.integration.test.ts`.
```ts
/** Delete tee_times rows for dates before today (Central Time). Returns rows deleted. */
export async function cleanupPastTeeTimes(db: D1Database, todayStr: string): Promise<number> {
  const result = await db.prepare("DELETE FROM tee_times WHERE date < ?").bind(todayStr).run();
  return result.meta.changes;
}
```
Take `todayStr` (YYYY-MM-DD, CT) as a param rather than computing inside — the caller already has it and this keeps the helper deterministically testable. **DB-2 is N/A here:** this deletes from `tee_times` (the child table), never `courses`; `tee_times` has no `ON DELETE CASCADE` dependents, so the CRITICAL "never hard-delete courses" rule does not apply. **Pitfall guard (`implementation-pitfalls.md` TIME-1 / DB-1):** `date` is a `YYYY-MM-DD` string and `todayStr` MUST be CT-derived (`todayStr` from the cron handler, which uses `toLocaleDateString("en-CA", {timeZone:"America/Chicago"})`). String `<` on `YYYY-MM-DD` is correct lexicographically — do NOT use `datetime()`. **TDD:** rows for yesterday deleted, today/future kept; returns count. Commit: `feat(db): prune past-date tee times`.

### Task 4.2: Wire into cron housekeeping (batch 0)

**Files:** Modify `src/lib/cron-handler.ts` (the `if (batchIndex === 0)` housekeeping block, alongside `cleanupOldPolls`).

Add, following the existing try/catch logging pattern:
```ts
try {
  const deletedTeeTimes = await cleanupPastTeeTimes(db, todayStr);
  if (deletedTeeTimes > 0) console.log(`Cleaned up ${deletedTeeTimes} past-date tee_times rows`);
} catch (err) {
  console.error("tee_times cleanup error:", err);
}
```
`todayStr` is already in scope in `runCronPoll`. **Do NOT** run this outside batch 0 (housekeeping is batch-0 only by design). Cron-handler logic is covered by existing tests; add/extend a test asserting the cleanup is invoked in batch 0 and skipped otherwise. **Fake-timer discipline (testing-pitfalls §11 — load-bearing):** `cron-handler.test.ts` uses `vi.useFakeTimers()` and the `withTimers(fn)` concurrent-flush helper because `runCronPoll` calls `sleep()` internally. Reuse that existing pattern. Do NOT use `vi.useFakeTimers({ shouldAdvanceTime: true })` — it caused a 156-second suite (98% of total runtime) and will reappear if copied. Commit: `feat(cron): prune past-date tee times during batch-0 housekeeping`.

### Phase 4 review gate
Minimum 3 rounds (CT date correctness per TIME-1; batch-0-only; that a failed cleanup never aborts the poll cycle — it's wrapped in try/catch like its siblings).

---

## Phase 5 — Pitfalls entry + post-deploy verification

**Execution Status:** ⬜ NOT STARTED

**Why:** Three-layer memory (`CLAUDE.md` §Thinking documentation). The write-amplification trap must travel with the repo so it isn't reintroduced.

### Task 5.1: Add implementation-pitfalls entry

**Files:** Modify `docs/pitfalls/implementation-pitfalls.md` (Database & D1 section). The next sequential ID is **`DB-4`** (existing: DB-1/2/3). Add a Flaw → Why → Fix → Lesson entry:
- **Flaw:** Rewriting cached rows (DELETE+INSERT) every poll regardless of change.
- **Why:** D1 bills rows *written*; an indexed table charges +1 write/row for the index; 5-min polling × ~75 rows × ~74 courses → ~175M writes/mo → ~$125 overage. Reads are ~1000× cheaper and were a non-factor.
- **Fix:** compare-then-replace — read current rows, normalized-multiset compare, skip the write when unchanged; keep the write a full atomic batch (never a partial diff) for concurrent-writer safety; conservative canonicalization (null never equals 0/"").
- **Lesson:** On a metered row-store, "just overwrite it" is the most expensive option. Freshness display belongs on `poll_log.polled_at` (last checked), not per-row write time.

**Complete the update per the doc's own Appendix C maintenance guide (partial updates cause drift — the doc says so explicitly). ALL of:**
1. DB-4 entry written in the Database & D1 section (format above).
2. TOC table (§ row for Database & D1): entry range `DB-1 – DB-3` → `DB-1 – DB-4`.
3. §3.C Review Checklist: add a pass/fail item (e.g. "Cached-row writes are change-gated — `upsertTeeTimes` skips the DELETE+INSERT when the fetched set is unchanged (DB-4)").
4. Appendix B summary table: add the `DB-4` row (Title, Severity `MEDIUM`, Status `VALIDATED` once the fix has shipped/tested in this PR, Domain `Database & D1`).
5. Appendix A changelog: add a dated line noting DB-4 added from this work.
6. Cross-reference: testing-pitfalls.md §4 already covers "delete-then-insert atomicity" / "table growth"; note the cross-ref in DB-4 rather than duplicating.

Docs are not TDD-scoped. Commit: `docs(pitfalls): record D1 write-amplification trap (DB-4)`.

### Task 5.2: Post-deploy verification note + implementation log

**Files:** Modify `docs/implementation-log.md`.

Record: what shipped; that the success criterion is **D1 rows-written < 50M/mo confirmed over the week after merge to `main`**, measured via the `poll_log.content_changed` rate (`SELECT AVG(content_changed) FROM poll_log WHERE status='success'` × current write volume) and the Cloudflare D1 dashboard. State the concrete revisit trigger: **only if** the sustained set-change rate keeps writes above 50M does a finer-grained approach (row-level diff) get reconsidered — otherwise close it out. Commit: `docs: log D1 write-amplification fix + post-deploy check`.

### Phase 5 review gate
Minimum 3 rounds (entry matches the established `DB-N` format; verification criterion is concrete and ownable, not an orphaned "maybe someday").

---

## Finalization (before opening the PR)

**Execution Status:** ⬜ NOT STARTED

After all five phases are green:
1. Invoke `superpowers:verification-before-completion` — evidence before claims.
2. Full local verification (all must be green): `npm test`, `npx tsc --noEmit`, `npm run lint`, and — because this PR changes API routes and adds a migration — the production build `npx @opennextjs/cloudflare build` (testing-pitfalls §12 "OpenNext compatibility"; features that pass `next dev` can still break on Workers).
3. Re-grep `fetched_at` across `src/` (excluding `db.ts`, `src/types/`, and `*.test.*`): the only remaining references should be the INSERT column name in `db.ts` and the `TeeTimeRow.fetched_at` type — NO display/staleness path should still read it.
4. Confirm the plan's Execution Status table + per-phase banners reflect reality (Living Document Contract).
5. Open ONE PR targeting `dev` (use `commit-commands:commit-push-pr` or follow `docs/git-strategy.md`). This is a **`Review`-class** PR (data-integrity-adjacent + schema migration) — **Sam merges**, agents do not auto-merge. PR body MUST state the post-deploy success criterion (D1 writes < 50M/mo, verified via `poll_log.content_changed` over the week after merge to `main`).

## Out of scope (do NOT do here)
- CPS Golf "transaction registration failed" and Chronogolf 429 fixes — separate work (`memory/project_cps_chronogolf_polling_failures.md`). Note: fixing CPS *adds* write load, so it MUST land after this PR.
- Changing today/tomorrow's 5-min poll cadence — fresh near-term data is the app's purpose; far dates are already tiered in `poller.ts shouldPollDate`.
- Row-level diff / stored-hash — rejected in design review; see memory.
- Any backward-compat shim — none needed; if one seems required, STOP and ask Sam (`CLAUDE.md`).
