# Multi-hole tee time display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the silent truncation of multi-hole tee time slots at the adapter layer (ForeUp, Chronogolf, Teesnap, Teewire, TeeItUp, and potentially CPS Golf), and merge sibling rows into a single display card at the UI layer.

**Architecture:** Each affected adapter emits one `TeeTime` record per bookable hole variant per slot, rather than silently collapsing to one. D1 schema is unchanged. A new pure helper `mergeHoleVariants` groups adjacent rows by `(course_id, date, time)` and produces display-only fields (`holesLabel: "9 / 18 holes"`, `priceLabel: "$30.00 / $55.00"`). `tee-time-list.tsx` calls the helper inside its per-date map. Filter queries work unchanged because the SQL `WHERE holes = ?` naturally returns the matching single variant from a pair.

**Tech Stack:** TypeScript, Next.js 16 App Router, Cloudflare D1 (SQLite), React 19, Tailwind CSS 4, Vitest 4, Playwright (CI-only).

**Design doc:** [docs/plans/2026-04-20-multi-hole-tee-times-design.md](./2026-04-20-multi-hole-tee-times-design.md)

**Revision note:** Original plan (v1) assumed only ForeUp and maybe CPS Golf needed adapter fixes. Task 1 investigation surfaced 4+ combined-shape adapters. This v2 plan covers the full scope.

**Pitfalls reference:** Canonical project path is [dev/testing-pitfalls.md](../../dev/testing-pitfalls.md) (NOT `docs/pitfalls/` — generic template path). Re-read before each task and again before marking complete. Especially relevant: §6 External API Resilience (malformed response handling, response validation), §7 Client-Side State Management, §10 Validation & Data Quality, §12 Build & Deploy.

**Plan as live document:** Task 1 findings are recorded below. Later tasks reference those findings. The plan is both spec AND scratch-pad for this feature.

**Execution strategy:** **in-session sequential.** Tightly coupled via the adapter → merge-helper → UI contract. Each adapter gets its own commit.

**Shared-helper policy:** `parseHolesField` is ForeUp-specific (operates on a compound *string*). Chronogolf, Teesnap, Teewire, and TeeItUp operate on arrays of variant records with completely different field names and shapes. **Do NOT extract a shared "expand variants" helper across these adapters** — each has adapter-specific variant-identification logic that's clearer inline.

**Per-adapter-task protocol for Tasks 4–7 (stub-test tasks):** the plan provides the fix *direction* and *shape assertions* but not exact test bodies, because the test bodies must match the real upstream response shape. Before writing tests for any of these tasks:

1. Read `src/adapters/<adapter>.ts` end-to-end to understand current parsing.
2. Read `src/adapters/<adapter>.test.ts` to see the existing mock shapes.
3. Read `src/test/fixtures/<adapter>-tee-times.json` to see real upstream data.
4. Construct test mocks that match fixture shape exactly — do NOT invent fields.

If any adapter's fixture lacks a multi-hole example (Teesnap's fixture on line 39 is the only one with a multi-variant shape), FIRST capture a live response via `npx vitest run --config vitest.smoke.config.ts src/adapters/<adapter>.smoke.test.ts` and inspect the captured JSON before writing tests.

---

## Task 1 findings (investigation complete)

| Adapter | Classification | Evidence | Action |
|---|---|---|---|
| **foreup** | COMBINED (string `"9/18"`) | [`foreup.test.ts:205`](../../src/adapters/foreup.test.ts) uses `holes: "9/18"`; adapter at [`foreup.ts:67`](../../src/adapters/foreup.ts) coerces via `Number(tt.holes) === 9 ? 9 : 18`, silently falling through to 18 for compound strings | Task 2 — string parser + expansion |
| **chronogolf** | COMBINED (course-level signal) | [`chronogolf-tee-times.json`](../../src/test/fixtures/chronogolf-tee-times.json) lines 9/40/71/102 show `course.bookable_holes: [9, 18]`; each record has single `default_price.bookable_holes`; adapter at [`chronogolf.ts:66`](../../src/adapters/chronogolf.ts) emits one record per upstream record, missing the non-default variant | Task 3 — detect multi-hole courses via `course.bookable_holes.length > 1`, emit second record with `price: null` (Option A — no extra API calls) |
| **teesnap** | COMBINED (prices array per record) | [`teesnap-tee-times.json`](../../src/test/fixtures/teesnap-tee-times.json) line 39 shows `prices: [{roundType: "NINE_HOLE", ...}, {roundType: "EIGHTEEN_HOLE", ...}]`; adapter at [`teesnap.ts:122`](../../src/adapters/teesnap.ts) picks one via `holes: eighteenPrice ? 18 : 9`, dropping the other | Task 4 — iterate prices array, emit per-roundType record |
| **teewire** | COMBINED (rates array) | [`teewire-tee-times.json`](../../src/test/fixtures/teewire-tee-times.json) line 53 shows `available_holes: [9, 18]`; [`teewire.test.ts:220-221`](../../src/adapters/teewire.test.ts) shows `pricing.rates` with both 9-hole and 18-hole entries; adapter at [`teewire.ts:77-87`](../../src/adapters/teewire.ts) picks one Walking rate, dropping the other | Task 5 — iterate rates array filtered by intent (walking preferred), emit per-holes record |
| **teeitup** | LIKELY COMBINED (rates array) | Interface has `rates: TeeItUpRate[]` with per-rate `holes: number`; adapter at [`teeitup.ts:57`](../../src/adapters/teeitup.ts) does `tt.rates.find((r) => !r.trade) ?? tt.rates[0]` picking one; fixture only has single-rate arrays, so live multi-hole evidence missing but pattern strongly suggests truncation | Task 6 — investigate live shape, iterate rates if multi-hole confirmed |
| **cps-golf** | UNKNOWN (weak signal) | Fixture records all have `is18HoleOnly: true` (cps-golf.ts fixture); `shItemCode: "GreenFee18"` pattern hints at potential `"GreenFee9"` variants; adapter at [`cps-golf.ts:110`](../../src/adapters/cps-golf.ts) coerces single `holes` number. Francis A Gross is on CPS per memory — test user reports multi-hole there, so this adapter DOES have the bug in production. Shape is unclear from fixtures alone. | Task 7 — live investigation first, conditional fix |
| **eagle-club** | HARDCODED 18 | [`eagle-club.ts:96`](../../src/adapters/eagle-club.ts): `holes: 18 as const` | No change |
| **membersports** | SEPARATE/SINGLE | [`membersports-tee-times.json`](../../src/test/fixtures/membersports-tee-times.json) shows `golfCourseNumberOfHoles: 18` as single per-record value; no array/combined signals | No change expected; Task 8 verifies via defensive test |

Six adapters need fixes; two (eagle-club, membersports) don't. Chronogolf uses Option A (partial-price) to avoid doubling API load.

---

## Task 2: ForeUp adapter — expand compound `holes` strings into two records

**Files:**
- Modify: `src/adapters/foreup.ts`
- Modify: `src/adapters/foreup.test.ts`

**BEFORE starting work:**
1. Invoke `/superpowers:test-driven-development`.
2. Re-read `dev/testing-pitfalls.md` §6 and §10.

**Step 1: Write the failing test — multi-hole expansion**

In `src/adapters/foreup.test.ts`, replace the existing test `"parses string holes value '9/18' as 18"` (around line 200) with:

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

```ts
it("leaves a numeric holes value as a single record", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify([{
      time: "2026-04-15 08:00", green_fee: "45.00", holes: 18,
      available_spots: 4, schedule_id: 7829,
    }]), { status: 200 })
  );
  const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
  expect(results).toHaveLength(1);
  expect(results[0].holes).toBe(18);
});

it("handles a whitespace-only holes string without expanding", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify([{
      time: "2026-04-15 08:00", green_fee: "45.00", holes: "   ",
      available_spots: 4, schedule_id: 7829,
    }]), { status: 200 })
  );
  const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
  expect(results).toHaveLength(1);
  expect(results[0].holes).toBe(18);
});

it("handles a null holes field defensively", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify([{
      time: "2026-04-15 08:00", green_fee: "45.00", holes: null,
      available_spots: 4, schedule_id: 7829,
    }]), { status: 200 })
  );
  const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
  expect(results).toHaveLength(1);
  expect(results[0].holes).toBe(18);
});

it("does NOT match a 9 digit inside a larger number like '19'", async () => {
  // Regression guard against any future refactor to \b9\b regex. The digit 9
  // inside the string "19" must not be interpreted as a 9-hole variant.
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify([{
      time: "2026-04-15 08:00", green_fee: "45.00", holes: "18/19",
      available_spots: 4, schedule_id: 7829,
    }]), { status: 200 })
  );
  const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
  expect(results).toHaveLength(1);
  expect(results[0].holes).toBe(18);
});
```

**Note on type:** update the `ForeUpTeeTime` interface field `holes: number | string;` to `holes: number | string | null;`.

**Step 3: Run tests — confirm failure**

Run: `npx vitest run src/adapters/foreup.test.ts`
Expected: the new/modified tests fail. Older solo-hole tests still pass.

**Step 4: Implement the expansion**

Add a free function above the `ForeUpAdapter` class:

```ts
/**
 * Parse the upstream `holes` field into one or more hole-count variants.
 * Upstream ForeUp returns either a number (9, 18) OR a compound string
 * ("9/18", "9,18") indicating a slot bookable as either. Expands compound
 * strings into the list of variants the adapter should emit.
 *
 * Values other than 9 or 18 (e.g., hypothetical 27-hole courses) are coerced
 * to [18]. 27/36-hole support is explicitly out of scope.
 */
function parseHolesField(h: number | string | null | undefined): (9 | 18)[] {
  if (typeof h === "number") return [h === 9 ? 9 : 18];
  if (h == null) return [18];
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
  return [18];
}
```

Replace the `return data.map((tt) => { ... });` block inside `fetchTeeTimes` with:

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

**Step 5: Run tests — confirm green**

Run: `npx vitest run src/adapters/foreup.test.ts`
Expected: all tests pass.

**Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

**BEFORE marking complete:** Verify §6 (malformed response handling) and §10 (validation). `parseHolesField` must not throw for any input type.

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

**Do NOT:**
- Modify the `TeeTime` type signature in `src/types/index.ts`.
- Modify other adapters.
- Touch `upsertTeeTimes`.
- Add UI display code.

---

## Task 3: Chronogolf adapter — expand multi-hole courses using course-level signal

**Files:**
- Modify: `src/adapters/chronogolf.ts`
- Modify: `src/adapters/chronogolf.test.ts`

**BEFORE starting work:**
1. Invoke `/superpowers:test-driven-development`.
2. Re-read `dev/testing-pitfalls.md` §6.

**Key context:** Chronogolf API returns per-teetime records with a single `default_price.bookable_holes` value. For multi-hole courses, `course.bookable_holes` is the array `[9, 18]`. The current adapter ignores the course-level signal and emits only one variant per slot (whichever the default). Fix: detect multi-hole courses, emit the default variant with its known price AND a second variant with `price: null` (Option A from the design). Downstream merge UI handles the partial-price gracefully.

**Step 1: Update the TypeScript interface**

In `chronogolf.ts`, update the `ChronogolfTeeTime` interface to include the course-level field:

```ts
interface ChronogolfTeeTime {
  start_time: string;
  date: string;
  max_player_size: number;
  course: {
    bookable_holes: number | number[]; // single (solo-hole course) OR [9, 18] (multi-hole)
  };
  default_price: {
    green_fee: number;
    bookable_holes: number;
  };
}
```

**Step 2: Write the failing test — multi-hole expansion**

Add to `src/adapters/chronogolf.test.ts`:

```ts
it("expands multi-hole courses (course.bookable_holes array) into two records", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({
      status: "success",
      teetimes: [
        {
          start_time: "8:00",
          date: "2026-04-15",
          max_player_size: 4,
          course: { bookable_holes: [9, 18] },
          default_price: { green_fee: 55, bookable_holes: 18 },
        },
      ],
    }), { status: 200 })
  );
  const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
  expect(results).toHaveLength(2);
  expect(results.map((r) => r.holes).sort()).toEqual([9, 18]);
  // Default variant (18) carries the known price; the other (9) is null.
  const v18 = results.find((r) => r.holes === 18)!;
  const v9 = results.find((r) => r.holes === 9)!;
  expect(v18.price).toBe(55);
  expect(v9.price).toBeNull();
  expect(v9.time).toBe(v18.time);
  expect(v9.openSlots).toBe(v18.openSlots);
});

it("emits a single record when course.bookable_holes is a single number", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({
      status: "success",
      teetimes: [
        {
          start_time: "8:00",
          date: "2026-04-15",
          max_player_size: 4,
          course: { bookable_holes: 18 },
          default_price: { green_fee: 55, bookable_holes: 18 },
        },
      ],
    }), { status: 200 })
  );
  const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
  expect(results).toHaveLength(1);
  expect(results[0].holes).toBe(18);
  expect(results[0].price).toBe(55);
});

it("emits a single record when course.bookable_holes is [18] (array with one value)", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({
      status: "success",
      teetimes: [
        {
          start_time: "8:00",
          date: "2026-04-15",
          max_player_size: 4,
          course: { bookable_holes: [18] },
          default_price: { green_fee: 55, bookable_holes: 18 },
        },
      ],
    }), { status: 200 })
  );
  const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
  expect(results).toHaveLength(1);
  expect(results[0].holes).toBe(18);
});

it("defaults to a single 18-hole record when course.bookable_holes is missing", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({
      status: "success",
      teetimes: [
        {
          start_time: "8:00",
          date: "2026-04-15",
          max_player_size: 4,
          course: {},
          default_price: { green_fee: 55, bookable_holes: 18 },
        },
      ],
    }), { status: 200 })
  );
  const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
  expect(results).toHaveLength(1);
  expect(results[0].holes).toBe(18);
});

it("defaults to a single record when course.bookable_holes is null", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({
      status: "success",
      teetimes: [
        {
          start_time: "8:00",
          date: "2026-04-15",
          max_player_size: 4,
          course: { bookable_holes: null },
          default_price: { green_fee: 55, bookable_holes: 18 },
        },
      ],
    }), { status: 200 })
  );
  const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
  expect(results).toHaveLength(1);
  expect(results[0].holes).toBe(18);
});

it("falls back to the default variant when course.bookable_holes contains only unrecognized values", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({
      status: "success",
      teetimes: [
        {
          start_time: "8:00",
          date: "2026-04-15",
          max_player_size: 4,
          course: { bookable_holes: [27] },
          default_price: { green_fee: 55, bookable_holes: 18 },
        },
      ],
    }), { status: 200 })
  );
  const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
  expect(results).toHaveLength(1);
  expect(results[0].holes).toBe(18);
});
```

**Step 3: Run tests — confirm failure**

Run: `npx vitest run src/adapters/chronogolf.test.ts`
Expected: the 4 new tests fail. Existing tests may fail if they lack `course.bookable_holes` in their mocks — if so, add `course: { bookable_holes: <value> }` to those mocks matching each test's expected output holes.

**Step 4: Implement the expansion**

Replace the inner `for (const tt of data.teetimes) { ... }` block in `fetchTeeTimes` with:

```ts
for (const tt of data.teetimes) {
  const defaultHoles: 9 | 18 = tt.default_price.bookable_holes === 9 ? 9 : 18;
  const courseHoles = tt.course?.bookable_holes;
  const allVariants: (9 | 18)[] = Array.isArray(courseHoles)
    ? courseHoles
        .filter((h): h is 9 | 18 => h === 9 || h === 18)
    : [defaultHoles];

  // If the course array doesn't cleanly normalize (empty or all unknown), fall
  // back to the default variant alone — honest one-record output rather than
  // silent drop.
  const variants = allVariants.length > 0 ? allVariants : [defaultHoles];

  for (const h of variants) {
    allTeeTimes.push({
      courseId: config.id,
      time: this.toIso(tt.date, tt.start_time),
      price: h === defaultHoles ? tt.default_price.green_fee : null,
      holes: h,
      openSlots: tt.max_player_size,
      bookingUrl: config.bookingUrl,
    });
  }
}
```

**Step 5: Run tests — confirm green**

Run: `npx vitest run src/adapters/chronogolf.test.ts`
Expected: all tests pass.

**Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`

**BEFORE marking complete:** Verify pitfalls §6. Check that malformed-response cases (missing `course`, missing `default_price`, unexpected `bookable_holes` value types) don't crash.

**Step 7: Commit**

```bash
git add src/adapters/chronogolf.ts src/adapters/chronogolf.test.ts
git commit -m "fix: Chronogolf adapter expands multi-hole courses into per-hole records

Upstream API signals multi-hole support at course level via
course.bookable_holes: [9, 18], but returns one default_price per teetime
record. The adapter silently dropped the non-default variant.

Detects multi-hole courses and emits two records per slot: the default
variant keeps its known price, the other carries price: null. UI merge
shows the known price alongside '9 / 18 holes'. Option A from design —
avoids doubling API load via separate per-hole queries."
```

**Do NOT:**
- Make two API calls per course (Option B deferred).
- Touch pagination logic or the query `holes: "9,18"` param.
- Modify other adapters.

---

## Task 4: Teesnap adapter — iterate prices array per roundType

**Files:**
- Modify: `src/adapters/teesnap.ts`
- Modify: `src/adapters/teesnap.test.ts`

**BEFORE starting work:**
1. Invoke `/superpowers:test-driven-development`.
2. Re-read `dev/testing-pitfalls.md` §6.

**Key context:** Teesnap records have `prices: [{roundType: "NINE_HOLE", ...}, {roundType: "EIGHTEEN_HOLE", ...}]`. Current adapter picks one and drops the other. Fix: iterate the prices array, emit one record per entry.

**Step 1: Read the current adapter to understand the exact shape**

Read `src/adapters/teesnap.ts` end-to-end before writing the test. Note the exact roundType values and price field names.

**Step 2: Write the failing test**

Add to `src/adapters/teesnap.test.ts`:

```ts
it("expands a tee time with both NINE_HOLE and EIGHTEEN_HOLE prices into two records", async () => {
  // Fixture shape: prices array with both variants.
  // Assertion: emit two records, correct holes and prices per variant.
  // (Exact fixture shape to match teesnap-tee-times.json:39 structure.)
  // TDD: write this test first, run it, see it fail.
});

it("emits a single record when only one roundType has a price", async () => {
  // Fixture with prices: [{ roundType: "EIGHTEEN_HOLE", price: "50.00" }]
  // Assert single record, holes=18, price=50.
});

it("emits a single record when only NINE_HOLE has a price", async () => {
  // Fixture with prices: [{ roundType: "NINE_HOLE", price: "25.00" }]
  // Assert single record, holes=9, price=25.
});

it("handles an empty prices array defensively", async () => {
  // Emit either zero records or one defaulted-18 record — be consistent with
  // the adapter's existing "no price available" handling. Document choice.
});
```

NOTE: exact test bodies depend on the adapter's current fixture structure. Read `src/test/fixtures/teesnap-tee-times.json` and `src/adapters/teesnap.test.ts` first; write tests that match the real input shape. Do not invent a shape.

**Step 3: Run — confirm failure.**

Run: `npx vitest run src/adapters/teesnap.test.ts`

**Step 4: Implement**

Replace the `holes: eighteenPrice ? 18 : 9` branch logic with a `for (const priceEntry of slot.prices) { emit one record per priceEntry }` loop. Map roundType to holes:
- `"NINE_HOLE"` → `holes: 9`
- `"EIGHTEEN_HOLE"` → `holes: 18`
- Unknown/missing → skip (don't emit)

Keep all other slot fields identical across emitted records.

**Step 5: Run — confirm green.**

**Step 6: Type-check, lint.**

**BEFORE marking complete:** Verify pitfalls §6. Empty `prices` array, malformed roundType, missing price string — none should crash.

**Step 7: Commit**

```bash
git add src/adapters/teesnap.ts src/adapters/teesnap.test.ts
git commit -m "fix: Teesnap adapter emits one record per roundType price variant

Teesnap tee time records have prices: [{roundType: NINE_HOLE, ...},
{roundType: EIGHTEEN_HOLE, ...}]. Adapter previously selected one variant
(preferring 18-hole) and silently dropped the other. Now iterates the
prices array and emits one TeeTime per bookable roundType."
```

**Do NOT:**
- Refactor unrelated Teesnap parsing logic.
- Treat unknown roundType values as 18-hole (skip them instead).

---

## Task 5: Teewire adapter — iterate rates array

**Files:**
- Modify: `src/adapters/teewire.ts`
- Modify: `src/adapters/teewire.test.ts`

**BEFORE starting work:**
1. Invoke `/superpowers:test-driven-development`.
2. Re-read `dev/testing-pitfalls.md` §6.

**Key context:** Teewire records have `pricing.rates: [{holes: 18, price: "$X"}, {holes: 9, price: "$Y"}]` plus `available_holes: [9, 18]`. Current adapter picks the Walking rate for one hole count. Fix: iterate rates, emit one TeeTime per distinct holes value, preferring Walking when available.

**Step 1: Read the current adapter and test file**

Understand how "Walking" vs other rate types are selected today. Don't lose that semantic during the refactor.

**Step 2: Write the failing test**

Add to `src/adapters/teewire.test.ts`, using shapes matching the existing fixture:

```ts
it("emits one record per hole variant when rates has both 9 and 18", async () => {
  // Fixture with rates: [
  //   { rate_title: "18 Holes Walking", holes: 18, price: "$51.00" },
  //   { rate_title: "9 Holes Walking", holes: 9, price: "$28.00" },
  // ]
  // available_holes: [9, 18]
  // Assert: two records, holes [9, 18], prices match.
});

it("emits a single record when available_holes is [18] and rates has only 18", async () => {
  // Current solo behavior preserved.
});

it("prefers Walking rate within each hole variant when multiple rate types exist", async () => {
  // Fixture: rates has both "18 Holes Walking" and "18 Holes Riding"
  // Assert: emitted record uses Walking price.
});
```

**Step 3: Run — fail.**

**Step 4: Implement**

Replace the `const walkingRate = slot.pricing.rates.find(...)` single-selection logic with a grouped iteration:

1. Group `slot.pricing.rates` by `rate.holes`.
2. For each group (one per distinct holes value in `available_holes` or present in rates):
   - Prefer a rate whose title contains "Walking"; fall back to the first rate in the group.
   - Parse the price.
   - Emit one `TeeTime` with `holes: group.holes === 9 ? 9 : 18`.

If `available_holes` is present and an adapter wants to use it as the authoritative variant list, do so; otherwise rely on rate grouping. Keep the check simple.

**Step 5: Run — green.**

**Step 6: Type-check, lint.**

**BEFORE marking complete:** Verify §6.

**Step 7: Commit**

```bash
git add src/adapters/teewire.ts src/adapters/teewire.test.ts
git commit -m "fix: Teewire adapter emits one record per hole variant in rates array

Teewire records expose pricing.rates with per-rate holes and prices, plus
available_holes indicating which hole counts are bookable. Adapter previously
selected one Walking rate and dropped all others. Now groups rates by holes
and emits one TeeTime per variant, preferring Walking within each group."
```

**Do NOT:**
- Change the Walking-preference semantics.
- Emit records for rate types we don't otherwise support (skip unknown rate_titles silently).

---

## Task 6: TeeItUp adapter — iterate rates array if multi-hole shape confirmed

**Files:**
- Modify: `src/adapters/teeitup.ts`
- Modify: `src/adapters/teeitup.test.ts`

**BEFORE starting work:**
1. Invoke `/superpowers:test-driven-development`.
2. Re-read `dev/testing-pitfalls.md` §6.

**Key context:** Existing fixture only shows single-rate arrays. If live courses return multiple rates with different `holes` values for the same teetime, the current `.find()` silently drops. First validate live shape.

**Step 1: Investigate live shape**

Run the TeeItUp smoke test against SD test courses (Lomas Santa Fe, Coronado per project memory):

```bash
npx vitest run --config vitest.smoke.config.ts src/adapters/teeitup.smoke.test.ts
```

Inspect the captured API response. Look for multi-rate teetimes with distinct `holes` values. If found, proceed to Step 2. If not found, log the finding in the plan's "Task 6 findings" section below and skip the fix — file a follow-up.

If the smoke test requires SD fixture data or skips without live output, rely on the existing TypeScript interface and adapter behavior: the `rates: TeeItUpRate[]` design strongly suggests multi-variant support is intended. In that case, proceed with Step 2 defensively — the fix emitting one record per rate is safe even if live data never shows multiple rates (degenerates to current behavior).

**Step 2: Write failing test**

Add to `src/adapters/teeitup.test.ts`:

```ts
it("emits one record per rate in the rates array when multiple hole variants exist", async () => {
  // Fixture with rates: [
  //   { holes: 18, greenFeeWalking: 5500, trade: false, ... },
  //   { holes: 9, greenFeeWalking: 3000, trade: false, ... },
  // ]
  // Assert: two records, holes [9, 18], prices in dollars.
});

it("keeps the existing first-non-trade-rate preference within each hole variant", async () => {
  // Fixture with: rates: [
  //   { holes: 18, trade: true, greenFeeWalking: 9999 },
  //   { holes: 18, trade: false, greenFeeWalking: 5500 },
  // ]
  // Assert: single record, holes=18, price=55.00 (from non-trade rate).
});

it("emits a single record for solo-hole fixtures (regression)", async () => {
  // Existing single-rate fixture. Assert one record, holes=18.
});
```

**Step 3: Run — fail.**

**Step 4: Implement**

Replace `const rate = tt.rates.find((r) => !r.trade) ?? tt.rates[0];` with:

1. Group `tt.rates` by `rate.holes`.
2. For each group: pick the non-trade rate if present, else the first.
3. Emit one `TeeTime` per selected rate.

Reuse the existing price-in-cents-to-dollars parsing.

**Step 5: Run — green.**

**Step 6: Type-check, lint.**

**BEFORE marking complete:** Verify §6. Empty `rates` array, missing `holes`, missing price — no crashes.

**Step 7: Commit**

```bash
git add src/adapters/teeitup.ts src/adapters/teeitup.test.ts
git commit -m "fix: TeeItUp adapter emits one record per hole variant in rates array

TeeItUp records expose rates: Array<{holes, greenFeeWalking, trade, ...}>.
Current .find() selected one rate per teetime and silently dropped others
with different hole counts. Now groups rates by holes and emits one TeeTime
per group, preserving the non-trade preference within each group."
```

**Do NOT:**
- Change the non-trade preference semantics.
- Change the cents→dollars price conversion.

---

## Task 7: CPS Golf adapter — live investigation + conditional fix

**Files (if fix proceeds):**
- Modify: `src/adapters/cps-golf.ts`
- Modify: `src/adapters/cps-golf.test.ts`

**BEFORE starting work:**
1. Invoke `/superpowers:test-driven-development`.
2. Re-read `dev/testing-pitfalls.md` §6.

**Key context:** The test user reports Francis A Gross (CPS Golf in production) shows "9, 18" on the course's own site but only one variant in our app. So the bug is real, but the exact API shape is unknown from fixtures alone.

**Step 1: Live investigation**

Run the CPS Golf smoke test:

```bash
npx vitest run --config vitest.smoke.config.ts src/adapters/cps-golf.smoke.test.ts
```

Inspect the captured response. Look for:
- Records where `holes` is not `9` or `18` (e.g., `0`, an array, a string).
- Records where `is18HoleOnly: false` — inspect these carefully for whether they carry additional fields indicating 9-hole availability.
- Multiple records at the same `startTime` with different `holes` values (would mean CPS emits separate records per variant — no fix needed).
- A `shItemPrices` entry containing `GreenFee9` alongside `GreenFee18` for the same record (would mean both are bookable at the same slot).

Record findings in "Task 7 findings" section below. If the API emits separate records per hole variant, skip the fix with an empty commit noting "already correct by API shape."

**Step 2: If fix needed — write failing test**

Based on Task 7 findings, write a test matching the observed shape. Example if both `GreenFee9` and `GreenFee18` coexist per record:

```ts
it("emits one record per GreenFee{N} price entry when both are present", async () => {
  // Fixture with shItemPrices: [
  //   { shItemCode: "GreenFee9", price: 30 },
  //   { shItemCode: "GreenFee18", price: 55 },
  // ]
  // is18HoleOnly: false
  // Assert: two records emitted, holes [9, 18], prices [30, 55].
});
```

**Step 3: Run — fail.**

**Step 4: Implement**

Shape-dependent. Likely patterns:
- If `shItemPrices` contains both `GreenFee9` and `GreenFee18`, parse both and emit two records.
- If a `holesOptions: [9, 18]` field exists, expand like Chronogolf.

Do NOT guess — if Task 7 findings are inconclusive, skip the fix and note for follow-up.

**Step 5: Run — green.**

**Step 6: Type-check, lint.**

**BEFORE marking complete:** Verify §6.

**Step 7: Commit (or skip-commit)**

If fixed:
```bash
git add src/adapters/cps-golf.ts src/adapters/cps-golf.test.ts
git commit -m "fix: CPS Golf adapter emits one record per hole variant

<Per-finding summary of the shape observed and how the fix matches it.>"
```

If unable to determine shape or no multi-hole records in smoke test:
```bash
git commit --allow-empty -m "chore: defer CPS Golf multi-hole fix — live investigation inconclusive

Task 7 smoke test against SD courses (Encinitas, Twin Oaks) did not surface
multi-hole records. Francis A Gross (the reported bug) is in MN and
closed for the season; live shape cannot be verified now. Filing follow-up
task for spring when MN courses open."
```

**Do NOT:**
- Modify CPS transaction-registration, auth-header, or proxy logic.
- Guess at API shape.

---

## End-of-adapter-batch review gate

After Tasks 2–7 and before starting Task 8, run 3+ rounds of adversarial review on the cumulative adapter-layer diff. Check:
- Every "combined" adapter now expands. Any silent truncations remaining?
- Do existing solo-hole tests still pass for every adapter?
- Is the "no TeeTime type change" contract preserved? (TeeTime still has `holes: 9 | 18`.)
- Are helper extractions minimal? `parseHolesField` lives in foreup.ts unless actually reused — don't pre-extract.
- Do any test fixtures still carry the old "single record with compound holes" shape? Those tests should have been updated to match new behavior.

If round 3 finds issues, continue.

Run: `npm test && npx tsc --noEmit && npm run lint` — all clean.

---

## Task 8: `mergeHoleVariants` display helper

**Files:**
- Create: `src/components/merge-hole-variants.ts`
- Create: `src/components/merge-hole-variants.test.ts`

**BEFORE starting work:**
1. Invoke `/superpowers:test-driven-development`.
2. Re-read `dev/testing-pitfalls.md` §7.

**Step 0: Export `TeeTimeItem` from `tee-time-list.tsx`**

Change `interface TeeTimeItem {` at `src/components/tee-time-list.tsx:10` to `export interface TeeTimeItem {`.

Run: `npx tsc --noEmit` — clean.

**Step 1: Write the test file**

Create `src/components/merge-hole-variants.test.ts`:

```ts
// @vitest-environment jsdom
// ABOUTME: Tests for the mergeHoleVariants display helper.
// ABOUTME: Verifies sibling rows at same (course, date, time) collapse into one display card.
import { describe, it, expect } from "vitest";
import { mergeHoleVariants } from "./merge-hole-variants";
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

**Step 2: Run — confirm fail (import error).**

Run: `npx vitest run src/components/merge-hole-variants.test.ts`

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

/**
 * Group sibling TeeTimeItems by (course_id, date, time) and produce one
 * DisplayTeeTime per group.
 *
 * Contract with adapters: adapters SHOULD emit one record per distinct
 * (course_id, date, time, holes) tuple. If duplicates with the same holes
 * value appear in the same group, this helper still runs without crashing
 * but produces an ugly label like "9 / 9 holes". Intentional — surfaces
 * adapter bugs visibly rather than masking them.
 */
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

    const knownPrices = variants
      .map((v) => v.price)
      .filter((p): p is number => p !== null);
    const priceLabel =
      knownPrices.length === 0 ? null : knownPrices.map(formatPrice).join(" / ");

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

**Step 4: Run — green.**

**Step 5: Type-check.**

**BEFORE marking complete:** Verify §7. Helper is pure. Confirm no mutation of input array.

**Step 6: Commit**

```bash
git add src/components/merge-hole-variants.ts src/components/merge-hole-variants.test.ts src/components/tee-time-list.tsx
git commit -m "feat: add mergeHoleVariants display helper for multi-hole slots

Pure function that groups tee time rows by (course_id, date, time) and
produces DisplayTeeTime entries with holesLabel and priceLabel strings.
Solo rows pass through; pairs merge into '9 / 18 holes' and
'\$30.00 / \$55.00' display strings. Exports TeeTimeItem from
tee-time-list.tsx for use by the helper."
```

**Do NOT:**
- Integrate the helper into `tee-time-list.tsx` yet — that's Task 9.
- Make the helper filter-aware.
- Mutate `TeeTimeItem[]`.

---

## Task 9: Integrate `mergeHoleVariants` into `tee-time-list.tsx`

**Files:**
- Modify: `src/components/tee-time-list.tsx`
- Modify: `src/components/tee-time-list.render.test.tsx`

**BEFORE starting work:**
1. Invoke `/superpowers:test-driven-development`.
2. Re-read `dev/testing-pitfalls.md` §7 and §12.

**Step 1: Write the failing render tests**

Add to `src/components/tee-time-list.render.test.tsx` (before the accessibility test):

```ts
it("merges two rows with same (course, date, time) into a single card with combined labels", () => {
  const teeTimes = [
    makeTeeTimeItem({ course_id: "baker", date: "2026-04-15", time: "08:00", holes: 9, price: 30, nines: null }),
    makeTeeTimeItem({ course_id: "baker", date: "2026-04-15", time: "08:00", holes: 18, price: 55, nines: null }),
  ];
  render(<TeeTimeList teeTimes={teeTimes} loading={false} />);
  expect(screen.getByText("9 / 18 holes")).toBeDefined();
  expect(screen.getByText("$30.00 / $55.00")).toBeDefined();
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
  expect(screen.queryByText(/\d+\s\/\s\d+ holes/)).toBeNull();
});

it("counts raw rows (not merged cards) in the results header", () => {
  const teeTimes = [
    makeTeeTimeItem({ course_id: "baker", time: "08:00", holes: 9, price: 30 }),
    makeTeeTimeItem({ course_id: "baker", time: "08:00", holes: 18, price: 55 }),
    makeTeeTimeItem({ course_id: "other", time: "09:00", holes: 18, price: 40 }),
  ];
  render(<TeeTimeList teeTimes={teeTimes} loading={false} />);
  expect(screen.getByText("3 tee times at 2 courses")).toBeDefined();
});

it("gracefully merges when one variant has null price", () => {
  // Chronogolf Option A case: multi-hole course, one variant's price is null.
  const teeTimes = [
    makeTeeTimeItem({ course_id: "baker", time: "08:00", holes: 9, price: null }),
    makeTeeTimeItem({ course_id: "baker", time: "08:00", holes: 18, price: 55 }),
  ];
  render(<TeeTimeList teeTimes={teeTimes} loading={false} />);
  expect(screen.getByText("9 / 18 holes")).toBeDefined();
  expect(screen.getByText("$55.00")).toBeDefined();
  expect(screen.queryByText("$55.00 / $55.00")).toBeNull();
});
```

**Step 2: Run — fail.**

Run: `npx vitest run src/components/tee-time-list.render.test.tsx`

**Step 3: Integrate**

**3a.** Add import after `import { formatTime, staleAge } from "@/lib/format";`:

```ts
import { mergeHoleVariants } from "./merge-hole-variants";
```

**3b.** Inside the `dateGroups.map(({ date, items }) => { ... })` callback body, immediately after the existing `const isCollapsed = collapsed.includes(date);`, add:

```ts
const displayItems = mergeHoleVariants(items);
```

Change the JSX iteration from `{items.map((tt, i) => (` to `{displayItems.map((tt, i) => (`.

**Locked decision — per-date header count:** the date-row header `({items.length})` stays as `items.length` (raw). Top summary `{teeTimes.length} tee times` also stays raw. Both report "bookable slots"; the gap vs visible cards for multi-hole merged slots is intentional — communicates how many bookable variants exist.

**3c.** Replace the exact line inside the card body:

```tsx
<span>{tt.holes} holes{tt.nines ? ` (${tt.nines})` : ""}</span>
```

with:

```tsx
<span>{tt.holesLabel}{tt.nines ? ` (${tt.nines})` : ""}</span>
```

**3d.** Replace:

```tsx
{tt.price !== null && <span>${tt.price.toFixed(2)}</span>}
```

with:

```tsx
{tt.priceLabel !== null && <span>{tt.priceLabel}</span>}
```

No other lines change.

**Step 4: Run — green.**

Run: `npx vitest run src/components/tee-time-list.render.test.tsx`

**Step 5: Full suite.**

Run: `npm test`

**Step 6: Type-check, lint.**

**BEFORE marking complete:** Verify §7. Accessibility test still passes.

**Step 7: Commit**

```bash
git add src/components/tee-time-list.tsx src/components/tee-time-list.render.test.tsx
git commit -m "feat: merge multi-hole tee time rows into combined display cards

Integrates mergeHoleVariants into tee-time-list.tsx. Rows sharing a
(course_id, date, time) key render as one card with '9 / 18 holes' and
'\$30.00 / \$55.00' labels. Solo rows keep the original shape. Handles
Chronogolf's partial-price case (Option A) — one side null, show only
the known price."
```

**Do NOT:**
- Change the `TeeTimeItem` interface.
- Add memoization.
- Change results-count semantics.

---

## Task 10: Full-stack verification & push

**Files:** none modified (unless hotfix needed).

**Step 1: Full local verification**

```bash
npm test
npx tsc --noEmit
npm run lint
```
Expected: significantly more tests than pre-feature (starting from 628 baseline, this feature adds roughly 30–40 new tests across 6+ adapters and the UI). Final count likely in the 660–680 range. tsc clean, lint only pre-existing warnings.

**Step 2: Push**

```bash
git push origin dev
```
Expected: CI triggers on dev push.

**Step 3: Monitor CI**

```bash
gh run watch --exit-status
```

**Step 4: Open PR when green**

```bash
gh pr create --base main --head dev --title "fix: display multi-hole tee times as merged rows (6 adapters)" --body "$(cat <<'EOF'
## Summary

Fixes test-user feedback that Baker Championship and Francis A Gross show only one of their two bookable hole variants. Investigation surfaced that FIVE additional adapters silently truncated multi-hole slots, not just ForeUp and CPS Golf: Chronogolf, Teesnap, Teewire, TeeItUp. All now emit one record per bookable hole variant; UI merges sibling rows into a single card reading \"9 / 18 holes · \$30.00 / \$55.00\".

## Adapter changes

- **ForeUp**: new `parseHolesField` helper expands compound strings like `\"9/18\"` into two variants.
- **Chronogolf**: detects multi-hole courses via `course.bookable_holes` array. Emits default variant with known price and a second variant with `price: null`. Avoids doubling API load.
- **Teesnap**: iterates `prices` array, emits one record per `roundType`.
- **Teewire**: iterates `pricing.rates`, groups by `holes`, preserves Walking preference per group.
- **TeeItUp**: iterates `rates`, groups by `holes`, preserves non-trade preference per group.
- **CPS Golf**: <status from Task 7 — fixed or deferred with explanation>.
- **Eagle Club / MemberSports**: unchanged (single-variant shapes confirmed).

## UI change

New pure helper `mergeHoleVariants` groups `(course_id, date, time)` siblings; `tee-time-list.tsx` renders merged cards. Filter semantics unchanged — `WHERE holes = ?` naturally returns the matching single variant.

## Verification

- 6 adapter suites updated with TDD tests for combined-shape expansion.
- 13 helper-unit tests covering solo, pair, three-way, null prices, differing open_slots/nines, group boundaries.
- 4 render-integration tests covering merge, solo, count, and Chronogolf partial-price case.
- All 5 CI jobs green.

## Out of scope

- Deep-link Book modal for multi-hole selection (next feature).
- Chronogolf two-call Option B for complete per-variant pricing.
- 27/36-hole course support.

## Follow-up

- 9/18 filter UI (feedback #2)
- Catalog expansion (feedback #4)
- Deep-link Book with modal (feedback #1)
- Chronogolf Option B if user feedback shows missing-price confusion

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## End-of-feature review gate

Before opening PR, run 5 rounds of adversarial review on the complete diff using `plan-review-cycle` principles.

---

## Execution status (recorded 2026-04-20)

**All tasks complete. PR #98 merged.** Full findings + decisions recorded in [`2026-04-20-overnight-decisions.md`](./2026-04-20-overnight-decisions.md) as entries D-1 through D-8.

Per-task summary:
- Task 2 (ForeUp): shipped, compound-string expansion.
- Task 3 (Chronogolf): shipped, course.bookable_holes array signal + Option A partial-price.
- Task 4 (Teesnap): shipped, prices-per-roundType iteration. D-1 for empty-prices behavior.
- Task 5 (Teewire): shipped, rates grouped by holes with Walking preference per group.
- Task 6 (TeeItUp): shipped, rates grouped by holes with non-trade preference. Defensive per D-2 (no live multi-hole evidence in fixture; pattern was identical to Teewire).
- Task 7 (CPS Golf): shipped, shItemPrices GreenFee{N} SKU inspection per D-3. Live-verified against Francis A Gross (53 multi-hole slots, $26.04 / $43.71).
- End-of-adapter review gate: 3 rounds, one Round-1 finding about MemberSports withdrawn after deeper analysis (see D-4).
- Task 8 (merge helper): shipped, 13 unit tests.
- Task 9 (UI integration): shipped, 4 render tests including Chronogolf partial-price case.
- End-of-feature review gate: 5 rounds, one Round-4 finding addressed (D-5: large-batch regression test).
- Task 10 (push + PR): PR #98 opened, CI green, merged.

**Test count:** 628 → 669 (+41 tests). All CI jobs green.
