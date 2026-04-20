# Multi-hole tee time display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the silent truncation of multi-hole tee time slots (Baker, Francis) by emitting one `TeeTime` record per bookable hole variant at the adapter layer and merging sibling rows into a single display card at the UI layer.

**Architecture:** Adapter layer emits N records per slot (one per bookable hole count). D1 schema is unchanged. A new pure helper `mergeHoleVariants` groups adjacent rows by `(course_id, date, time)` and produces display-only fields (`holesLabel: "9 / 18 holes"`, `priceLabel: "$30.00 / $55.00"`). `tee-time-list.tsx` calls the helper inside its per-date map. Filter queries work unchanged because the SQL `WHERE holes = ?` naturally returns the matching single variant from a pair.

**Tech Stack:** TypeScript, Next.js 16 App Router, Cloudflare D1 (SQLite), React 19, Tailwind CSS 4, Vitest 4, Playwright (CI-only).

**Design doc:** [docs/plans/2026-04-20-multi-hole-tee-times-design.md](./2026-04-20-multi-hole-tee-times-design.md)

**Pitfalls reference:** The canonical location for this project is [dev/testing-pitfalls.md](../../dev/testing-pitfalls.md) (NOT `docs/pitfalls/` — that's a generic template path). Read it before Task 2 and again before marking each task complete. Especially relevant sections for this feature: §6 External API Resilience (malformed response handling, response validation), §7 Client-Side State Management, §10 Validation & Data Quality, §12 Build & Deploy.

**Plan as live document:** Task 1 appends its investigation findings into the "Task 1 findings" section at the bottom of this plan file. Later tasks reference those findings. This is intentional — the plan is both spec AND scratch-pad for this feature.

**Execution strategy recommendation:** **in-session sequential.** This plan is compact (7 tasks), tightly coupled across the adapter → UI contract, and the current session has full codebase context. Delegation to subagents would cost context overhead without material gain. Use `superpowers:executing-plans` to step through the tasks.

---

## Task 1: Adapter shape investigation

**Goal:** Produce a short note classifying each adapter as "combined records" (multi-hole slots arrive as one record with compound `holes`) or "separate records" (multi-hole slots arrive as multiple records, one per hole count). This gates which adapters need code changes in later tasks. READ-ONLY — do not modify adapter code.

**Files:**
- Read: `src/adapters/cps-golf.ts`, `src/adapters/chronogolf.ts`, `src/adapters/foreup.ts`, `src/adapters/eagle-club.ts`, `src/adapters/membersports.ts`, and any `src/adapters/tee-it-up.ts` if present.
- Read: each adapter's `.test.ts` and `.smoke.test.ts` files, looking for fixtures that demonstrate the upstream shape.

**Step 1: Grep each adapter for the holes-mapping line**

Use the Grep tool with pattern `holes:` and path `src/adapters/`, output_mode `content`, line numbers on. (If executing from a shell without the Grep tool, use `grep -rn "holes:" src/adapters/`.)
Expected: each adapter shows its `holes` coercion line (e.g., `holes: tt.holes === 9 ? 9 : 18`). Note the input type for `tt.holes` in each case.

**Step 2: Inspect each adapter's TypeScript interface for the upstream record shape**

For each adapter, find the `interface <Name>TeeTime` near the top of the file. Record the `holes` field type (`number`, `string`, `number | string`).

**Step 3: Search test fixtures for any multi-hole-indicative values**

Use the Grep tool with pattern `'9/18'|"9/18"|'9,18'|"9,18"|holes: 0|holesOptions|bookable_holes`, path `src/`, output_mode `content`, line numbers on.
Expected: at minimum, `foreup.test.ts:205` shows `holes: "9/18"`. Record any additional hits.

**Step 4: Write the investigation note**

Append to the end of this plan file (Task 1 has no code changes — the note IS the deliverable) a section like:

```
## Task 1 findings
- ForeUp: COMBINED. Evidence: foreup.test.ts:205 uses `holes: "9/18"`. Fix in Task 2.
- CPS Golf: <TBD — combined|separate|hardcoded>. Evidence: <file:line>.
- Chronogolf: <TBD>. Evidence: <file:line>. (Assumption pre-investigation: separate records per bookable_holes.)
- Eagle Club: HARDCODED 18. No change possible or needed.
- TeeItUp: <TBD>. Evidence: <file:line>.
- MemberSports: <TBD>. Evidence: <file:line>.
- (Any other adapter found in src/adapters/): <TBD>.
```

Every `<TBD>` must be resolved with evidence before this task commits. Do NOT copy the ForeUp/Eagle Club lines as pre-validated — those two are established by this plan's design work; every other adapter still requires Task 1 verification.

**Step 5: Commit**

```bash
git add docs/plans/2026-04-20-multi-hole-tee-times-plan.md
git commit -m "docs: adapter shape investigation for multi-hole support"
```

**Definition of done:** Every adapter in `src/adapters/` has a one-line classification (combined / separate / hardcoded) with a file:line citation, recorded in the plan file's findings section.

---

## Task 2: ForeUp adapter — expand combined `holes` strings into multiple records

**Files:**
- Modify: `src/adapters/foreup.ts` (replace the `holes:` mapping at line ~67 and surrounding `.map()`)
- Modify: `src/adapters/foreup.test.ts` (update existing test at line ~200, add new cases)

**BEFORE starting work:**
1. Invoke `/superpowers:test-driven-development`.
2. Re-read `dev/testing-pitfalls.md` §6 (External API Resilience) and §10 (Validation & Data Quality).

**Step 1: Write the failing test — multi-hole expansion**

Open `src/adapters/foreup.test.ts`. Replace the existing test `"parses string holes value '9/18' as 18"` (line ~200) with:

```ts
it("expands string holes value '9/18' into two records", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify([{
      time: "2026-04-15 08:00",
      green_fee: "45.00",
      holes: "9/18",
      available_spots: 4,
      schedule_id: 7829,
    }]), { status: 200 })
  );

  const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
  expect(results).toHaveLength(2);
  expect(results.map((r) => r.holes).sort()).toEqual([9, 18]);
  expect(results[0].time).toBe(results[1].time);
  expect(results[0].openSlots).toBe(results[1].openSlots);
  expect(results[0].price).toBe(results[1].price);
});
```

**Step 2: Add defensive edge-case tests**

Add these below:

```ts
it("leaves a numeric holes value as a single record", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify([{
      time: "2026-04-15 08:00",
      green_fee: "45.00",
      holes: 18,
      available_spots: 4,
      schedule_id: 7829,
    }]), { status: 200 })
  );

  const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
  expect(results).toHaveLength(1);
  expect(results[0].holes).toBe(18);
});

it("handles a whitespace-only holes string without expanding", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify([{
      time: "2026-04-15 08:00",
      green_fee: "45.00",
      holes: "   ",
      available_spots: 4,
      schedule_id: 7829,
    }]), { status: 200 })
  );

  const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
  expect(results).toHaveLength(1);
  expect(results[0].holes).toBe(18);
});

it("handles a null holes field defensively", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify([{
      time: "2026-04-15 08:00",
      green_fee: "45.00",
      holes: null,
      available_spots: 4,
      schedule_id: 7829,
    }]), { status: 200 })
  );

  const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
  expect(results).toHaveLength(1);
  expect(results[0].holes).toBe(18);
});

it("does NOT match a 9 digit inside a larger number like '19'", async () => {
  // Regression guard against any future refactor to \b9\b regex — the digit
  // 9 inside the string "19" must not be interpreted as a 9-hole variant.
  // The current split/parseInt implementation handles this correctly.
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify([{
      time: "2026-04-15 08:00",
      green_fee: "45.00",
      holes: "18/19",
      available_spots: 4,
      schedule_id: 7829,
    }]), { status: 200 })
  );

  const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
  // "18/19" splits to [18, 19]. Only 18 is recognized. Falls through to [18].
  expect(results).toHaveLength(1);
  expect(results[0].holes).toBe(18);
});
```

**Note on the ForeUp adapter type signature:** update the `ForeUpTeeTime` interface in `foreup.ts:9` from `holes: number | string;` to `holes: number | string | null;` to reflect the null defensive path.

**Step 3: Run the tests — confirm failure**

Run: `npx vitest run src/adapters/foreup.test.ts`
Expected: the three new/modified tests fail. Old tests still pass.

**Step 4: Implement the expansion**

In `src/adapters/foreup.ts`, locate the block starting with `return data.map((tt) => {` and ending with its matching `});`. This is inside `fetchTeeTimes` and is the adapter's main output. Replace that whole block with:

```ts
return data.flatMap((tt) => {
  const isInformative = (name: string | null | undefined): name is string =>
    !!name && name !== "New Tee Sheet";
  const nines =
    isInformative(tt.teesheet_side_name) &&
    isInformative(tt.reround_teesheet_side_name)
      ? `${tt.teesheet_side_name}/${tt.reround_teesheet_side_name}`
      : undefined;

  const holeVariants = parseHolesField(tt.holes);
  const priceNum =
    tt.green_fee !== null && !Number.isNaN(parseFloat(tt.green_fee))
      ? parseFloat(tt.green_fee)
      : null;

  return holeVariants.map((holes) => ({
    courseId: config.id,
    time: this.toIso(tt.time),
    price: priceNum,
    holes,
    openSlots: tt.available_spots,
    bookingUrl: config.bookingUrl,
    ...(nines && { nines }),
  }));
});
```

And add this free function above the class (pure, no `this` dependencies):

```ts
/**
 * Parse the upstream `holes` field into one or more hole-count variants.
 *
 * Upstream ForeUp returns either a number (9, 18) OR a compound string
 * ("9/18", "9,18") indicating a slot that's bookable as either. This helper
 * expands compound strings into the list of variants the adapter should emit
 * as separate TeeTime records.
 *
 * Values other than 9 or 18 (e.g., hypothetical 27-hole courses) are coerced
 * to [18]. 27/36-hole support is explicitly out of scope for this feature.
 */
function parseHolesField(h: number | string | null | undefined): (9 | 18)[] {
  if (typeof h === "number") return [h === 9 ? 9 : 18];
  if (h == null) return [18]; // null/undefined → defensive default
  const s = String(h).trim();
  if (s === "") return [18];
  // Split on non-digit runs, parse integers. Robust against "9/18", "9,18",
  // "9 or 18", etc. Avoids the \b9\b regex trap where "19" matches as 9.
  const nums = s
    .split(/\D+/)
    .map((n) => parseInt(n, 10))
    .filter((n) => !Number.isNaN(n));
  const has9 = nums.includes(9);
  const has18 = nums.includes(18);
  if (has9 && has18) return [9, 18];
  if (has9) return [9];
  return [18]; // numeric-but-not-9 OR unknown string → default 18
}
```

**Step 5: Run the tests — confirm green**

Run: `npx vitest run src/adapters/foreup.test.ts`
Expected: all tests pass, including the three new/modified ones.

**Step 6: Run type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. Pre-existing lint warnings unchanged.

**BEFORE marking this task complete:**
1. Re-read `dev/testing-pitfalls.md` §6. Verify the new tests cover: malformed `holes` (whitespace, unknown string), number passthrough, multi-hole expansion. §10: whitespace-only strings handled.
2. Verify `parseHolesField` does not throw for any input type.
3. `npm test` full suite — green.

**Step 7: Commit**

```bash
git add src/adapters/foreup.ts src/adapters/foreup.test.ts
git commit -m "fix: ForeUp adapter expands multi-hole slots into per-hole records

Upstream API returns 'holes: \"9/18\"' for slots bookable as either 9 or 18
holes. The adapter silently collapsed these to holes=18 via Number('9/18')
=== 9 ? 9 : 18 falling through. Users saw only one variant.

Adds parseHolesField helper that expands compound strings to both variants
and passes through numeric values unchanged. Emits one TeeTime record per
variant. UI merging happens in a later task."
```

**Do NOT in this task:**
- Modify the `TeeTime` type signature in `src/types/index.ts`.
- Modify other adapters.
- Touch `upsertTeeTimes`.
- Add any UI display code.

---

## Task 3: CPS Golf adapter — conditional fix

**Precondition:** Task 1 findings classify CPS Golf. If "separate," skip this task entirely and note in the commit message. If "combined," proceed with Steps 1–7.

**Files:**
- Modify: `src/adapters/cps-golf.ts`
- Modify: `src/adapters/cps-golf.test.ts`

**BEFORE starting work:**
1. Invoke `/superpowers:test-driven-development`.
2. Re-read `dev/testing-pitfalls.md` §6 and §10.

**Step 1: Write the failing test for whatever combined shape was discovered in Task 1**

Shape-dependent. Three anticipated cases, handle per Task 1 findings:

- **Compound string** (e.g., `holes: "9/18"` in one record) — mirror Task 2's test structure verbatim, substituting the CPS fixture shape.
- **Array field** (e.g., `holesOptions: [9, 18]` in one record) — write a test with that shape; adapter iterates the array.
- **Unknown shape** — STOP. Do not guess. Re-investigate in Task 1's findings section, record the observed shape with evidence, and ask before writing code. This task can be paused mid-execution.

**Step 2: Run test — confirm red.**

Run: `npx vitest run src/adapters/cps-golf.test.ts`

**Step 3: Implement the change — extraction decision**

Extract `parseHolesField` to a shared helper if EITHER of these conditions holds:

- Task 1 findings identify CPS AND at least one more adapter (TeeItUp, MemberSports) as "combined" → extract now, at Task 3, so Task 4 can import.
- Task 1 findings identify only CPS beyond ForeUp as "combined" (two adapters total) → extract now in Task 3.

Do NOT extract if ForeUp remains the only "combined" adapter after the full Task 1 audit.

Steps to extract (do this as a SEPARATE commit before implementing the CPS change):

1. Create `src/adapters/_shared/parse-holes.ts` containing only the `parseHolesField` function (copy verbatim from `foreup.ts`, keeping the same exports). Prepend the two-line ABOUTME header required by `CLAUDE.md`, e.g.:
   ```ts
   // ABOUTME: Parses an upstream adapter's `holes` field into one or more hole-count variants.
   // ABOUTME: Handles compound strings ("9/18", "9,18"), numeric values, and defensive null/whitespace.
   ```
2. Create `src/adapters/_shared/parse-holes.test.ts` with the same cases covered by the ForeUp adapter tests: numeric passthrough, compound string expansion, whitespace, null, `"18/19"` regression.
3. Update `foreup.ts` to `import { parseHolesField } from "./_shared/parse-holes";` and delete the local function.
4. Run `npm test` — green.
5. Commit: `refactor: extract parseHolesField to src/adapters/_shared/parse-holes.ts for reuse`.

Then implement the CPS change using the shared helper.

If CPS is the only "combined" adapter (Task 4 turns up no more), leave the helper inline in `foreup.ts` and do NOT pre-extract.

**Step 4: Run tests — confirm green.**

Run: `npx vitest run src/adapters/cps-golf.test.ts src/adapters/foreup.test.ts`
Expected: both pass.

**Step 5: Type-check and lint.**

**BEFORE marking this task complete:** Re-read testing pitfalls §6 and §10.

**Step 6: Commit** (or skip-commit with note):

If the task was skipped:
```bash
git commit --allow-empty -m "chore: skip CPS Golf multi-hole change — adapter emits separate records

Per Task 1 investigation, CPS Golf API returns one record per hole count.
The existing 'tt.holes === 9 ? 9 : 18' logic correctly preserves each variant.
No code change needed."
```

Otherwise:
```bash
git add src/adapters/cps-golf.ts src/adapters/cps-golf.test.ts [src/adapters/_shared/*]
git commit -m "fix: CPS Golf adapter expands multi-hole slots into per-hole records"
```

**Do NOT:**
- Modify CPS transaction-registration, auth-header, or proxy logic.
- Refactor unrelated CPS adapter code.
- Speculatively add multi-hole handling if Task 1 showed the API emits separate records.

---

## Task 4: Other adapters audit (TeeItUp, MemberSports, Chronogolf verification)

**Precondition:** Task 1 findings cover these adapters.

**BEFORE starting work:** Invoke `/superpowers:test-driven-development`.

**Step 1: For each "combined" adapter surfaced in Task 1**

Apply the Task 2 pattern: write failing test, implement using `parseHolesField` (import from shared if extracted, else inline), verify green.

**Step 2: For Chronogolf, add a single defensive test**

If Task 1 classified Chronogolf as "separate," add a test to `src/adapters/chronogolf.test.ts` that locks the current behavior: given two upstream records with same `start_time` but different `bookable_holes` (9 and 18), assert both appear in the returned `TeeTime[]` with correct holes values. This codifies the assumption for future regressions.

```ts
it("preserves both hole variants when the API returns separate records per bookable_holes", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({
      status: "success",
      teetimes: [
        { start_time: "8:00", date: "2026-04-15", max_player_size: 4,
          default_price: { green_fee: 30, bookable_holes: 9 } },
        { start_time: "8:00", date: "2026-04-15", max_player_size: 4,
          default_price: { green_fee: 55, bookable_holes: 18 } },
      ],
    }), { status: 200 })
  );
  const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
  expect(results).toHaveLength(2);
  expect(results.map((r) => r.holes).sort()).toEqual([9, 18]);
});
```

**Step 3: Run tests — confirm green.**

**BEFORE marking this task complete:** Re-read testing pitfalls §6. Verify each adapter's malformed-response path is still covered.

**Step 4: Commit**

```bash
git add src/adapters/
git commit -m "fix/test: multi-hole support audit for remaining adapters

<Per-adapter summary of what changed and what was verified.>"
```

**Do NOT:**
- Speculatively add multi-hole support to adapters with no evidence of combined records.
- Modify Eagle Club (hardcoded 18, out of scope).

---

## End-of-adapter-batch review gate

After Task 4 and before starting Task 5, run 3+ rounds of adversarial review on the adapter-layer diff. Check:
- Does every combined-shape adapter now expand? Any silent truncations remaining?
- Do existing tests for solo-hole slots still pass?
- Is `parseHolesField` (or inline logic) safe for: null, undefined, empty string, whitespace, numbers other than 9/18, strings containing only "18", strings containing only "9"?

If round 3 finds issues, continue.

Run: `npm test && npx tsc --noEmit && npm run lint` — all clean.

---

## Task 5: `mergeHoleVariants` display helper

**Files:**
- Create: `src/components/merge-hole-variants.ts`
- Create: `src/components/merge-hole-variants.test.ts`

**BEFORE starting work:**
1. Invoke `/superpowers:test-driven-development`.
2. Re-read `dev/testing-pitfalls.md` §7.

**Step 0: Export `TeeTimeItem` from `tee-time-list.tsx`**

The interface `TeeTimeItem` is currently declared at `src/components/tee-time-list.tsx:10` without `export`. The merge helper needs to import it. In that file, change:

```ts
interface TeeTimeItem {
```

to:

```ts
export interface TeeTimeItem {
```

Run: `npx tsc --noEmit`
Expected: clean (no other callers should break since `TeeTimeItem` was only used inside `tee-time-list.tsx` and tests).

**Step 1: Write the test file skeleton**

Create `src/components/merge-hole-variants.test.ts`:

```ts
// @vitest-environment jsdom
// ABOUTME: Tests for the mergeHoleVariants display helper.
// ABOUTME: Verifies sibling rows at same (course, date, time) collapse into one display card.
import { describe, it, expect } from "vitest";
import { mergeHoleVariants, type DisplayTeeTime } from "./merge-hole-variants";
import type { TeeTimeItem } from "./tee-time-list";

function makeItem(overrides: Partial<TeeTimeItem> = {}): TeeTimeItem {
  return {
    course_id: "test-course",
    course_name: "Test Course",
    course_city: "Minneapolis",
    date: "2026-04-15",
    time: "08:00",
    price: 45.0,
    holes: 18,
    open_slots: 4,
    booking_url: "https://example.com",
    fetched_at: new Date().toISOString(),
    nines: null,
    ...overrides,
  };
}

describe("mergeHoleVariants", () => {
  it("returns empty array for empty input", () => {
    expect(mergeHoleVariants([])).toEqual([]);
  });

  it("passes a single solo row through with labels populated", () => {
    const out = mergeHoleVariants([makeItem({ holes: 18, price: 45 })]);
    expect(out).toHaveLength(1);
    expect(out[0].holesLabel).toBe("18 holes");
    expect(out[0].priceLabel).toBe("$45.00");
  });

  it("populates priceLabel as null when solo row has null price", () => {
    const out = mergeHoleVariants([makeItem({ price: null })]);
    expect(out[0].priceLabel).toBeNull();
  });

  it("merges two rows with same (course, date, time) and different holes", () => {
    const out = mergeHoleVariants([
      makeItem({ holes: 9, price: 30 }),
      makeItem({ holes: 18, price: 55 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].holesLabel).toBe("9 / 18 holes");
    expect(out[0].priceLabel).toBe("$30.00 / $55.00");
  });

  it("shows only the non-null price when one side is null", () => {
    const out = mergeHoleVariants([
      makeItem({ holes: 9, price: null }),
      makeItem({ holes: 18, price: 55 }),
    ]);
    expect(out[0].holesLabel).toBe("9 / 18 holes");
    expect(out[0].priceLabel).toBe("$55.00");
  });

  it("returns null priceLabel when all variants have null price", () => {
    const out = mergeHoleVariants([
      makeItem({ holes: 9, price: null }),
      makeItem({ holes: 18, price: null }),
    ]);
    expect(out[0].priceLabel).toBeNull();
  });

  it("uses the minimum open_slots across merged variants", () => {
    const out = mergeHoleVariants([
      makeItem({ holes: 9, open_slots: 4 }),
      makeItem({ holes: 18, open_slots: 2 }),
    ]);
    expect(out[0].open_slots).toBe(2);
  });

  it("preserves a single non-null nines across the pair", () => {
    const out = mergeHoleVariants([
      makeItem({ holes: 9, nines: null }),
      makeItem({ holes: 18, nines: "East/West" }),
    ]);
    expect(out[0].nines).toBe("East/West");
  });

  it("comma-joins distinct nines values", () => {
    const out = mergeHoleVariants([
      makeItem({ holes: 9, nines: "East/West" }),
      makeItem({ holes: 18, nines: "South/North" }),
    ]);
    expect(out[0].nines).toBe("East/West, South/North");
  });

  it("merges three rows at same key into a three-way label", () => {
    // TeeTimeItem.holes is typed as `number` so 27 is legal at compile time.
    // The production type is not `9 | 18`; it's the D1 row shape.
    const out = mergeHoleVariants([
      makeItem({ holes: 9, price: 10 }),
      makeItem({ holes: 18, price: 20 }),
      makeItem({ holes: 27, price: 30 }),
    ]);
    expect(out[0].holesLabel).toBe("9 / 18 / 27 holes");
    expect(out[0].priceLabel).toBe("$10.00 / $20.00 / $30.00");
  });

  it("does NOT merge rows with same (course, time) but different date", () => {
    const out = mergeHoleVariants([
      makeItem({ date: "2026-04-15", holes: 9 }),
      makeItem({ date: "2026-04-16", holes: 18 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("does NOT merge rows with same (date, time) but different course_id", () => {
    const out = mergeHoleVariants([
      makeItem({ course_id: "a", holes: 9 }),
      makeItem({ course_id: "b", holes: 18 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("preserves input order for groups (first-seen wins)", () => {
    const out = mergeHoleVariants([
      makeItem({ course_id: "b", holes: 18 }),
      makeItem({ course_id: "a", holes: 9 }),
      makeItem({ course_id: "a", holes: 18 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].course_id).toBe("b");
    expect(out[1].course_id).toBe("a");
  });
});
```

**Step 2: Run tests — confirm they all fail**

Run: `npx vitest run src/components/merge-hole-variants.test.ts`
Expected: file fails to import (helper not implemented yet).

**Step 3: Implement the helper**

Create `src/components/merge-hole-variants.ts`:

```ts
// ABOUTME: Pure display helper that merges sibling tee time rows into one card.
// ABOUTME: Rows with matching (course_id, date, time) collapse into a single DisplayTeeTime.
import type { TeeTimeItem } from "./tee-time-list";

export interface DisplayTeeTime extends TeeTimeItem {
  holesLabel: string;
  priceLabel: string | null;
}

function formatPrice(p: number): string {
  return `$${p.toFixed(2)}`;
}

function keyOf(item: TeeTimeItem): string {
  return `${item.course_id}|${item.date}|${item.time}`;
}

export function mergeHoleVariants(items: TeeTimeItem[]): DisplayTeeTime[] {
  const groups = new Map<string, TeeTimeItem[]>();
  const order: string[] = [];
  for (const item of items) {
    const k = keyOf(item);
    if (!groups.has(k)) {
      groups.set(k, []);
      order.push(k);
    }
    groups.get(k)!.push(item);
  }

  const out: DisplayTeeTime[] = [];
  for (const k of order) {
    const variants = groups.get(k)!.slice().sort((a, b) => a.holes - b.holes);

    if (variants.length === 1) {
      const v = variants[0];
      out.push({
        ...v,
        holesLabel: `${v.holes} holes`,
        priceLabel: v.price !== null ? formatPrice(v.price) : null,
      });
      continue;
    }

    const holesLabel = `${variants.map((v) => v.holes).join(" / ")} holes`;

    const knownPrices = variants.map((v) => v.price).filter((p): p is number => p !== null);
    const priceLabel =
      knownPrices.length === 0
        ? null
        : knownPrices.map(formatPrice).join(" / ");

    const openSlots = Math.min(...variants.map((v) => v.open_slots));

    const ninesValues = variants
      .map((v) => v.nines)
      .filter((n): n is string => !!n);
    const uniqueNines = Array.from(new Set(ninesValues));
    const nines = uniqueNines.length === 0 ? null : uniqueNines.join(", ");

    const first = variants[0];
    out.push({
      ...first,
      open_slots: openSlots,
      nines,
      holesLabel,
      priceLabel,
    });
  }

  return out;
}
```

**Step 4: Run tests — confirm green**

Run: `npx vitest run src/components/merge-hole-variants.test.ts`
Expected: all 13 tests pass.

**Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

**BEFORE marking this task complete:** Re-read testing pitfalls §7. Verify the helper is pure (no state, no side effects), does not mutate its input, returns a new array each call.

**Step 6: Commit**

```bash
git add src/components/merge-hole-variants.ts src/components/merge-hole-variants.test.ts
git commit -m "feat: add mergeHoleVariants display helper for multi-hole slots

Pure function that groups tee time rows by (course_id, date, time) and
produces DisplayTeeTime entries with holesLabel and priceLabel strings.
Solo rows pass through with their labels populated; pairs merge into
\"9 / 18 holes\" and \"\$30.00 / \$55.00\" display strings. Caller
integration comes in the next task."
```

**Do NOT:**
- Integrate the helper into `tee-time-list.tsx` yet — that's Task 6.
- Make the helper filter-aware. The caller has already applied filters.
- Mutate `TeeTimeItem[]`.

**Contract with adapter layer (document this in the helper's JSDoc):** adapters SHOULD emit one record per distinct `(course_id, date, time, holes)` tuple. If two records share a full 4-tuple (i.e., an adapter bug emits two `holes: 9` records for the same slot), the helper still runs without crashing but produces an ugly label like `"9 / 9 holes"`. This is intentional — the helper does not mask upstream duplication silently. Adapter bugs surface as visible UI anomalies for catch-and-fix.

---

## Task 6: Integrate `mergeHoleVariants` into `tee-time-list.tsx`

**Files:**
- Modify: `src/components/tee-time-list.tsx`
- Modify: `src/components/tee-time-list.render.test.tsx`

**BEFORE starting work:**
1. Invoke `/superpowers:test-driven-development`.
2. Re-read `dev/testing-pitfalls.md` §7 and §12.

**Step 1: Write the failing render tests**

Add to `src/components/tee-time-list.render.test.tsx` (before the accessibility test at the bottom):

```ts
it("merges two rows with same (course, date, time) into a single card with combined labels", () => {
  const teeTimes = [
    makeTeeTimeItem({ course_id: "baker", date: "2026-04-15", time: "08:00", holes: 9, price: 30, nines: null }),
    makeTeeTimeItem({ course_id: "baker", date: "2026-04-15", time: "08:00", holes: 18, price: 55, nines: null }),
  ];
  render(<TeeTimeList teeTimes={teeTimes} loading={false} />);
  expect(screen.getByText("9 / 18 holes")).toBeDefined();
  expect(screen.getByText("$30.00 / $55.00")).toBeDefined();
  // Should NOT render two separate "9 holes" / "18 holes" lines
  expect(screen.queryByText("9 holes")).toBeNull();
  expect(screen.queryByText("18 holes")).toBeNull();
});

it("renders solo holes without merge formatting for single-variant slots", () => {
  const teeTimes = [
    makeTeeTimeItem({ course_id: "solo", time: "09:00", holes: 18, price: 40 }),
  ];
  render(<TeeTimeList teeTimes={teeTimes} loading={false} />);
  expect(screen.getByText("18 holes")).toBeDefined();
  expect(screen.getByText("$40.00")).toBeDefined();
  // Merged label pattern "X / Y holes" must NOT appear for a solo slot.
  expect(screen.queryByText(/\d+\s\/\s\d+ holes/)).toBeNull();
});

it("counts raw rows (not merged cards) in the results header", () => {
  const teeTimes = [
    makeTeeTimeItem({ course_id: "baker", time: "08:00", holes: 9, price: 30 }),
    makeTeeTimeItem({ course_id: "baker", time: "08:00", holes: 18, price: 55 }),
    makeTeeTimeItem({ course_id: "other", time: "09:00", holes: 18, price: 40 }),
  ];
  render(<TeeTimeList teeTimes={teeTimes} loading={false} />);
  // 3 raw tee times, at 2 distinct courses, rendered as 2 visible cards
  expect(screen.getByText("3 tee times at 2 courses")).toBeDefined();
});
```

**Step 2: Run tests — confirm they fail**

Run: `npx vitest run src/components/tee-time-list.render.test.tsx`
Expected: the three new tests fail.

**Step 3: Integrate the helper**

In `src/components/tee-time-list.tsx`, make these three targeted changes:

**3a.** Add the import after the existing `import { formatTime, staleAge } from "@/lib/format";` line:

```ts
import { mergeHoleVariants } from "./merge-hole-variants";
```

**3b.** Inside the `dateGroups.map(({ date, items }) => { ... })` callback (currently starts with `const isCollapsed = collapsed.includes(date);`), add a line immediately after `const isCollapsed = collapsed.includes(date);`:

```ts
const displayItems = mergeHoleVariants(items);
```

Then change the iteration block `{items.map((tt, i) => (` to `{displayItems.map((tt, i) => (`. Only the iteration source changes.

**Locked decision — per-date header count:** the date-row header `({items.length})` stays as `items.length` (raw tee-time count). Rationale: the top summary header `"3 tee times at 2 courses"` also reports raw tee-time count; a user comparing the two numbers should see a consistent "bookable slots" semantic. The (usually small) gap between header count and visible card count when multi-hole slots merge is intended — it communicates "there are 4 bookable variants here, shown in 3 cards after visual merging." Do NOT change this to `displayItems.length` without explicit product sign-off; if it's genuinely confusing in practice, address in a follow-up with user feedback.

**3c.** Inside that card's body, replace the exact line:

```tsx
<span>{tt.holes} holes{tt.nines ? ` (${tt.nines})` : ""}</span>
```

with:

```tsx
<span>{tt.holesLabel}{tt.nines ? ` (${tt.nines})` : ""}</span>
```

(Keep the nines-in-parens shape — the helper computes a merged `nines` value; the UI still renders it separately from `holesLabel` so the visual format stays identical for solo rows.)

**3d.** In the same card body, replace the exact line:

```tsx
{tt.price !== null && <span>${tt.price.toFixed(2)}</span>}
```

with:

```tsx
{tt.priceLabel !== null && <span>{tt.priceLabel}</span>}
```

No other lines in the file change.

**Step 4: Run tests — confirm green**

Run: `npx vitest run src/components/tee-time-list.render.test.tsx`
Expected: all tests pass including the three new ones and all pre-existing ones.

**Step 5: Run the full vitest suite**

Run: `npm test`
Expected: all suites green.

**Step 6: Type-check, lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

**BEFORE marking this task complete:**
1. Re-read testing pitfalls §7 (Client-Side State). Verify no stateful merge side-effects, deterministic output.
2. Verify accessibility test still passes (accessibility rule on `region` already disabled in the existing setup).

**Step 7: Commit**

```bash
git add src/components/tee-time-list.tsx src/components/tee-time-list.render.test.tsx
git commit -m "feat: merge multi-hole tee time rows into combined display cards

Integrates mergeHoleVariants into tee-time-list.tsx. Rows sharing a
(course_id, date, time) key render as one card with \"9 / 18 holes\"
and \"\$30.00 / \$55.00\" labels. Solo rows keep the original shape.
Raw row counts in the results header are preserved; only the card
count per date group reflects merging."
```

**Do NOT:**
- Change the `TeeTimeItem` interface.
- Add memoization (YAGNI until profiling shows need).
- Change the results count semantics.

---

## Task 7: Full-stack verification & push

**Files:** none modified.

**Step 1: Full local verification**

Run these in sequence:
```bash
npm test
npx tsc --noEmit
npm run lint
```
Expected: starting from the post-Task-6 baseline (628 tests), this feature adds roughly 20 new tests (adapter: 4 in Task 2, 0–2 in Tasks 3–4; helper: 13 in Task 5; render: 3 in Task 6). Final count should land in the 645–650 range. tsc clean, lint only pre-existing warnings.

**Step 2: Push to dev**

```bash
git push origin dev
```
Expected: push accepted. CI triggers automatically (triggers include dev per the e2e CI work).

**Step 3: Monitor CI**

Run: `gh run watch --exit-status`
Expected: all 5 CI jobs (Lint / Type Check / Test / Build / E2E) pass.

**Step 4: Open PR when CI green**

```bash
gh pr create --base main --head dev --title "fix: display multi-hole tee times as merged rows (Baker/Francis)" --body "$(cat <<'EOF'
## Summary

Fixes test-user feedback about Baker Championship and Francis A Gross showing only one of their two bookable hole variants. Courses list these slots as "9/18" on their own booking sites; this app silently collapsed to a single variant because adapters coerced unexpected `holes` values through `=== 9 ? 9 : 18`, dropping the 9-hole option when ForeUp returned the compound string `"9/18"`.

## Approach

- **Adapter layer:** `parseHolesField` helper expands compound `holes` fields into an array of variants. ForeUp (and any other "combined-record" adapters identified during Task 1) now emit one `TeeTime` per bookable hole count.
- **UI layer:** new pure helper `mergeHoleVariants` groups adjacent rows by `(course_id, date, time)` and produces display-only `holesLabel` (`"9 / 18 holes"`) and `priceLabel` (`"$30.00 / $55.00"`). `tee-time-list.tsx` calls the helper inside its per-date map.
- **Schema:** unchanged.
- **Filter semantics:** unchanged — `WHERE holes = ?` naturally returns one side of the pair, and the helper no-ops on solo rows.

## Verification

- New adapter tests cover: compound string expansion, numeric passthrough, whitespace/null defensive paths, `"18/19"` regression guard.
- New merge-helper tests cover 13 cases including solo, pair, three-way, null prices, differing open_slots, differing nines, and group-key boundaries.
- New render test asserts `"9 / 18 holes"` and `"$30.00 / $55.00"` appear in merged cards while solo rows keep the original shape.
- CI (all 5 jobs including E2E nav spec) green.

## Out of scope

- Deep-link Book modal for multi-hole selection (next feature).
- 27/36-hole course support.
- Any D1 schema change.

## Follow-up

Next feedback items are: 9/18 hole filter UI (feedback #2), catalog expansion (#4), deep-link Book with per-hole selection modal (#1).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 5: After merge — update TODO**

After Sam merges, we're done with this feature. Next feedback items remain:
- #2 (9/18 filter) — builds on this work
- #4 (catalog expansion)
- #1 (deep-link Book with modal for multi-hole)

---

## End-of-feature review gate

Before opening the PR (before Task 7 Step 4), run 5 rounds of adversarial review on the complete diff using `plan-review-cycle` principles. Check every dimension:

- **Ambiguity:** each commit's diff reads as "one behavior change explained by its tests"? No vague "improvements"?
- **Context gaps:** could a reviewer approve without knowing the design doc? Commit messages link back?
- **Interpretation drift:** any code that could be misread as "feature creep"? Any comments claiming "improved" or "new"?
- **Cross-task conflicts:** does the final diff edit the same line in two commits unnecessarily? Any merge conflicts between tasks?
- **Testing pitfalls:** each new test covers the success path and at least one failure path? No mock-only tests that never exercise real logic?
- **Implementation pitfalls:** no `process.env` usage? Cloudflare bindings via `getCloudflareContext()`? D1 queries parameterized?

If round 5 finds issues, keep going.

---

## Task 1 findings

_(To be filled in during Task 1 execution.)_
