# PR 42/43 Test Coverage Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close all 68 test coverage gaps identified in `dev/test-coverage-reports/2026-03-26-pr42-43-test-coverage-review.md`.

**Architecture:** Fix foundation (test helpers) first, then work outward: security-critical gaps → correctness → nice-to-have. Tests are added to existing test files where they exist; new test files created only for courses/page.tsx which has none.

**Tech Stack:** Vitest 4, React Testing Library 16, better-sqlite3 (for integration tests via `d1-test-helper.ts`), jsdom (via `// @vitest-environment jsdom` pragma for React component tests)

**Coverage report:** `dev/test-coverage-reports/2026-03-26-pr42-43-test-coverage-review.md`

**Scope:** ONLY add/modify test files and the `seedCourse` helper. Do NOT modify any source/production code. If a gap reveals an actual bug, note it in the commit message but do NOT fix it — that's a separate task.

---

## Task 1: Update Test Helpers (seedCourse + makeCourseRow)

**BEFORE starting work:**
1. Read `dev/testing-pitfalls-coverage-review.md`
2. Follow TDD where applicable

**Gaps closed:** #7 (seedCourse missing state/disabled)

**Files:**
- Modify: `src/test/d1-test-helper.ts`

**What's wrong:** `seedCourse` inserts 8 columns but the `courses` table now has 10 (`state` added in migration 0006, `disabled` added in 0007). The INSERT works because both have defaults, but integration tests cannot create courses with `state != 'MN'` or `disabled = 1` without raw SQL.

**Step 1: Update `seedCourse` to include `state` and `disabled`**

In `src/test/d1-test-helper.ts`, update the `seedCourse` function:

1. Add `state` and `disabled` to the overrides type:
```typescript
export async function seedCourse(
  db: D1Database,
  overrides: Partial<{
    id: string;
    name: string;
    city: string;
    state: string;
    disabled: number;
    platform: string;
    platform_config: string;
    booking_url: string;
    is_active: number;
    last_had_tee_times: string | null;
  }> = {}
): Promise<void> {
```

2. Add defaults to the `c` object:
```typescript
  const c = {
    id: "test-course",
    name: "Test Course",
    city: "Minneapolis",
    state: "MN",
    disabled: 0,
    platform: "foreup",
    platform_config: JSON.stringify({ scheduleId: "1234" }),
    booking_url: "https://example.com/book",
    is_active: 1,
    last_had_tee_times: null as string | null,
    ...overrides,
  };
```

3. Update the INSERT to include both new columns:
```typescript
  await db
    .prepare(
      `INSERT INTO courses (id, name, city, state, disabled, platform, platform_config, booking_url, is_active, last_had_tee_times)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      c.id,
      c.name,
      c.city,
      c.state,
      c.disabled,
      c.platform,
      c.platform_config,
      c.booking_url,
      c.is_active,
      c.last_had_tee_times
    )
    .run();
```

**Step 2: Run all tests**

```bash
npm test
```

Expected: All existing tests still pass (new columns have defaults matching previous behavior).

**Step 3: Commit**

```
test: add state and disabled columns to seedCourse helper
```

**BEFORE marking this task complete:**
1. Verify `npm test` passes
2. Verify the helper defaults match column defaults (state='MN', disabled=0)

---

## Task 2: Security-Critical — Disabled Filter in Cron Handler

**BEFORE starting work:**
1. Read `src/lib/cron-handler.ts` — understand how `allCourses` is queried and split into active/inactive
2. Read `src/lib/cron-handler.test.ts` — understand the existing mock patterns (`makeCourseRow`, `makeMockDb`)
3. Read `dev/testing-pitfalls-coverage-review.md`

**Gaps closed:** #1, #2 (disabled filter unverified for polling and auto-reactivation)

**Files:**
- Modify: `src/lib/cron-handler.test.ts`

**What's wrong:** The `WHERE disabled = 0` clause at `cron-handler.ts:73` is the sole defense preventing disabled courses from being polled and auto-reactivated. No test creates a `disabled: 1` course and verifies it is excluded. Two distinct failure modes:
1. A `disabled: 1, is_active: 1` course would be polled (wasting budget and producing unwanted data)
2. A `disabled: 1, is_active: 0` course would be probed by the inactive loop and auto-reactivated when tee times are found

**Current behavior:** `makeCourseRow` always sets `disabled: 0`. The mock DB's `prepare().all()` returns the array directly — it doesn't execute SQL. So the `WHERE disabled = 0` clause is never tested.

**Fix approach:** Since the cron handler tests use mocks (not real SQL), we can't test the `WHERE` clause directly. Instead, test that the function correctly handles the `disabled` field on `CourseRow` objects by verifying the mock DB `prepare` is called with SQL containing `WHERE disabled = 0`.

**Step 1: Write test for disabled exclusion from polling SQL**

Add this test in the existing `describe("runCronPoll", ...)` block:

```typescript
it("queries only non-disabled courses", async () => {
  const courses = [makeCourseRow("active-course", "foreup")];
  const mockDb = {
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockResolvedValue({ results: courses }),
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
    }),
  };

  await runCronPoll(
    { DB: mockDb } as any,
    "*/5 * * * *"
  );

  // Verify the SQL includes the disabled filter
  const sqlCalls = mockDb.prepare.mock.calls.map((c: any[]) => c[0]);
  const courseQuery = sqlCalls.find((s: string) => s.includes("FROM courses"));
  expect(courseQuery).toContain("WHERE disabled = 0");
});
```

**Step 2: Run test to verify it passes**

```bash
npx vitest run src/lib/cron-handler.test.ts -t "queries only non-disabled courses"
```

Expected: PASS (the SQL already has the clause — this is a regression guard).

**Step 3: Commit**

```
test: verify disabled courses excluded from cron polling SQL
```

---

## Task 3: Cron Handler Correctness Gaps

**BEFORE starting work:**
1. Read `src/lib/cron-handler.test.ts` — find the existing tests for `last_had_tee_times` and auto-activation
2. Read `dev/testing-pitfalls-coverage-review.md`

**Gaps closed:** #16 (last_had_tee_times UPDATE), #17 (auto-activation DB write)

**Files:**
- Modify: `src/lib/cron-handler.test.ts`

**Gap #16:** When `pollCourse` returns "success" for an active course, `cron-handler.ts:131-136` runs `UPDATE courses SET last_had_tee_times = ? WHERE id = ?`. No test verifies this DB write — only the poll itself is tested.

**Gap #17:** When an inactive course is auto-activated (`cron-handler.ts:196-202`), the test checks the `console.log` message but doesn't verify the mock DB `prepare().bind().run()` was called with the correct SQL and arguments.

**Step 1: Write test for last_had_tee_times UPDATE on successful poll**

Find the existing test section for active course polling. Add:

```typescript
it("updates last_had_tee_times on successful poll", async () => {
  // Set up a single active course with successful poll
  const courses = [makeCourseRow("test-course", "foreup")];
  const prepareMock = vi.fn();
  const bindMock = vi.fn().mockReturnThis();
  const runMock = vi.fn().mockResolvedValue({ meta: { changes: 0 } });

  prepareMock.mockReturnValue({
    all: vi.fn().mockResolvedValue({ results: courses }),
    bind: bindMock,
    run: runMock,
  });

  const mockDb = { prepare: prepareMock };

  vi.mocked(pollCourse).mockResolvedValue("success");

  await runCronPoll({ DB: mockDb } as any, "*/5 * * * *");

  // Find the UPDATE call for last_had_tee_times
  const updateCalls = prepareMock.mock.calls
    .map((c: any[]) => c[0])
    .filter((sql: string) => sql.includes("last_had_tee_times"));

  expect(updateCalls.length).toBeGreaterThan(0);
  expect(updateCalls[0]).toContain("UPDATE courses SET last_had_tee_times");
});
```

**Step 2: Write test for auto-activation DB write args**

Find the existing inactive course auto-activation test. Add a new test (or extend the existing one) that verifies the SQL contains `SET is_active = 1`:

```typescript
it("runs UPDATE to set is_active = 1 when inactive course has tee times", async () => {
  const courses = [makeCourseRow("inactive-course", "foreup", { is_active: 0 })];
  const prepareMock = vi.fn();
  const bindMock = vi.fn().mockReturnThis();
  const runMock = vi.fn().mockResolvedValue({ meta: { changes: 0 } });

  prepareMock.mockReturnValue({
    all: vi.fn().mockResolvedValue({ results: courses }),
    bind: bindMock,
    run: runMock,
  });

  const mockDb = { prepare: prepareMock };

  vi.mocked(pollCourse).mockResolvedValue("success");

  await runCronPoll({ DB: mockDb } as any, "*/5 * * * *");

  const updateCalls = prepareMock.mock.calls
    .map((c: any[]) => c[0])
    .filter((sql: string) => sql.includes("is_active = 1"));

  expect(updateCalls.length).toBeGreaterThan(0);
});
```

**Step 3: Run tests**

```bash
npx vitest run src/lib/cron-handler.test.ts
```

**Step 4: Commit**

```
test: verify last_had_tee_times and auto-activation DB writes in cron handler
```

**BEFORE marking this task complete:**
1. Run `npm test` and confirm green
2. Verify you didn't break any existing cron handler tests

---

## Task 4: Route Integration Tests — Sync Stale SQL + Disabled/State Tests

**BEFORE starting work:**
1. Read `src/app/api/courses/route.ts` — the ACTUAL SQL query (lines 14-26)
2. Read `src/app/api/tee-times/route.ts` — the ACTUAL query builder (lines 58-92)
3. Read both `route.integration.test.ts` files — the STALE SQL that needs updating
4. Task 1 must be complete (needs `seedCourse` with `state` and `disabled` support)
5. Read `dev/testing-pitfalls-coverage-review.md`

**Gaps closed:** #3 (stale integration SQL), #4 (disabled in courses API), #5 (disabled in tee-times API), #9 (state sorting), #10 (course_state in SELECT), #14 (minSlots validation)

**Files:**
- Modify: `src/app/api/courses/route.integration.test.ts`
- Modify: `src/app/api/tee-times/route.integration.test.ts`
- Modify: `src/app/api/tee-times/route.test.ts` (for minSlots unit tests)

### Part A: Courses route integration test

**Step 1: Update stale SQL in courses integration test**

In `src/app/api/courses/route.integration.test.ts`, replace the `COURSES_LIST_SQL` constant (lines 8-21) with the exact SQL from `src/app/api/courses/route.ts`. The current test has:
- `ORDER BY c.name` → must be `ORDER BY c.state DESC, c.name ASC`
- Missing `WHERE c.disabled = 0` after the LEFT JOIN

Read the actual route file and copy the exact SQL. Do NOT paraphrase or reconstruct from memory.

**Step 2: Add test for disabled course exclusion**

```typescript
it("excludes disabled courses from results", async () => {
  await seedCourse(db, { id: "active-course", name: "Active", disabled: 0 });
  await seedCourse(db, { id: "disabled-course", name: "Disabled", disabled: 1 });

  const result = await db.prepare(COURSES_LIST_SQL).all<{ id: string }>();
  const ids = result.results.map((r) => r.id);

  expect(ids).toContain("active-course");
  expect(ids).not.toContain("disabled-course");
});
```

**Step 3: Add test for state-based sorting**

```typescript
it("sorts MN courses before CA courses", async () => {
  await seedCourse(db, { id: "ca-course", name: "Alpha CA", state: "CA" });
  await seedCourse(db, { id: "mn-course", name: "Zeta MN", state: "MN" });

  const result = await db.prepare(COURSES_LIST_SQL).all<{ id: string }>();
  const ids = result.results.map((r) => r.id);

  expect(ids.indexOf("mn-course")).toBeLessThan(ids.indexOf("ca-course"));
});
```

### Part B: Tee-times route integration test

**Step 4: Update stale query builder in tee-times integration test**

In `src/app/api/tee-times/route.integration.test.ts`, update the `queryTeeTimes` function (lines 11-67) to match the actual route:
- SELECT must include `c.state as course_state`
- WHERE must include `AND c.disabled = 0`
- ORDER BY must be `c.state DESC, t.time ASC`

Read `src/app/api/tee-times/route.ts` and copy the exact query structure.

**Step 5: Add test for disabled course exclusion in tee-times**

```typescript
it("excludes tee times from disabled courses", async () => {
  await seedCourse(db, { id: "active", disabled: 0 });
  await seedCourse(db, { id: "disabled", disabled: 1 });
  await upsertTeeTimes(db, "active", "2026-04-15", [makeTeeTime({ courseId: "active", time: "2026-04-15T08:00:00" })], now);
  await upsertTeeTimes(db, "disabled", "2026-04-15", [makeTeeTime({ courseId: "disabled", time: "2026-04-15T09:00:00" })], now);

  const result = await queryTeeTimes(db, { date: "2026-04-15" });
  const courseIds = result.results.map((r) => r.course_id);

  expect(courseIds).toContain("active");
  expect(courseIds).not.toContain("disabled");
});
```

**Step 6: Add test for state-based sorting in tee-times**

```typescript
it("sorts tee times by state DESC then time ASC", async () => {
  await seedCourse(db, { id: "ca-course", state: "CA" });
  await seedCourse(db, { id: "mn-course", state: "MN" });
  await upsertTeeTimes(db, "ca-course", "2026-04-15", [makeTeeTime({ courseId: "ca-course", time: "2026-04-15T07:00:00" })], now);
  await upsertTeeTimes(db, "mn-course", "2026-04-15", [makeTeeTime({ courseId: "mn-course", time: "2026-04-15T09:00:00" })], now);

  const result = await queryTeeTimes(db, { date: "2026-04-15" });

  // MN should come first despite later time, because state DESC puts MN before CA
  expect(result.results[0].course_id).toBe("mn-course");
  expect(result.results[1].course_id).toBe("ca-course");
});
```

**Step 7: Add test for course_state in SELECT**

```typescript
it("includes course_state in results", async () => {
  await seedCourse(db, { id: "mn-course", state: "MN" });
  await upsertTeeTimes(db, "mn-course", "2026-04-15", [makeTeeTime({ courseId: "mn-course" })], now);

  const result = await queryTeeTimes(db, { date: "2026-04-15" });
  expect(result.results[0]).toHaveProperty("course_state", "MN");
});
```

### Part C: minSlots unit tests

**Step 8: Add minSlots validation tests to tee-times route unit tests**

In `src/app/api/tee-times/route.test.ts`, add tests for the minSlots validation (which exists in the route but has no tests):

```typescript
it("returns 400 for non-numeric minSlots", async () => {
  // test with minSlots=abc
});

it("returns 400 for minSlots of 0", async () => {
  // test with minSlots=0
});

it("returns 400 for negative minSlots", async () => {
  // test with minSlots=-1
});
```

Read the existing test file first to understand the mock pattern for creating requests and asserting responses.

**Step 9: Run all tests**

```bash
npm test
```

**Step 10: Commit**

```
test: sync stale integration SQL, add disabled/state/minSlots tests
```

**BEFORE marking this task complete:**
1. Verify the SQL in both integration tests EXACTLY matches the route source code
2. Run `npm test` and confirm green

**After this task, review Tasks 1-4 as a batch:**
```
You MUST carefully review the batch of work from multiple perspectives
and revise/refine as appropriate. Repeat this review loop (you must do
a minimum of three review rounds; if you still find substantive issues
in the third review, keep going with additional rounds until there are
no findings) until you're confident there aren't any more issues. Then
update your private journal and continue onto the next tasks.
```

---

## Task 5: db.ts Integration Tests — Nines Round-Trip + Null Price

**BEFORE starting work:**
1. Read `src/lib/db.ts` — the `upsertTeeTimes` function
2. Read `src/lib/db.integration.test.ts` — the existing integration tests
3. Task 1 must be complete (needs updated `seedCourse`)

**Gaps closed:** #8 (nines column binding), #35 (null price round-trip)

**Files:**
- Modify: `src/lib/db.integration.test.ts`

**Step 1: Write test for nines round-trip**

```typescript
it("stores and retrieves nines field", async () => {
  await seedCourse(db);
  const teeTimes = [makeTeeTime({ nines: "East/West" })];

  await upsertTeeTimes(db, "test-course", "2026-04-15", teeTimes, now);

  const result = await db
    .prepare("SELECT nines FROM tee_times WHERE course_id = ?")
    .bind("test-course")
    .first<{ nines: string | null }>();

  expect(result!.nines).toBe("East/West");
});

it("stores null when nines is undefined", async () => {
  await seedCourse(db);
  const teeTimes = [makeTeeTime()]; // no nines field

  await upsertTeeTimes(db, "test-course", "2026-04-15", teeTimes, now);

  const result = await db
    .prepare("SELECT nines FROM tee_times WHERE course_id = ?")
    .bind("test-course")
    .first<{ nines: string | null }>();

  expect(result!.nines).toBeNull();
});
```

**Step 2: Write test for null price round-trip**

```typescript
it("stores null price", async () => {
  await seedCourse(db);
  const teeTimes = [makeTeeTime({ price: null })];

  await upsertTeeTimes(db, "test-course", "2026-04-15", teeTimes, now);

  const result = await db
    .prepare("SELECT price FROM tee_times WHERE course_id = ?")
    .bind("test-course")
    .first<{ price: number | null }>();

  expect(result!.price).toBeNull();
});
```

**Step 3: Run tests**

```bash
npx vitest run src/lib/db.integration.test.ts
```

**Step 4: Commit**

```
test: add nines round-trip and null price integration tests
```

---

## Task 6: Adapter Edge Cases

**BEFORE starting work:**
1. Read `src/adapters/eagle-club.ts` and `src/adapters/eagle-club.test.ts`
2. Read `src/adapters/foreup.ts` and `src/adapters/foreup.test.ts`
3. Read `src/adapters/index.ts` and `src/adapters/index.test.ts`

**Gaps closed:** #10 (Eagle Club StrExceptions fallback), #11 (Eagle Club non-numeric fee), #12 (ForeUp asymmetric nines), #13 (eagle_club lookup)

**Files:**
- Modify: `src/adapters/eagle-club.test.ts`
- Modify: `src/adapters/foreup.test.ts`
- Modify: `src/adapters/index.test.ts`

**Step 1: Eagle Club — StrExceptions fallback test**

In `eagle-club.test.ts`, add:

```typescript
it("uses StrExceptions when BoolSuccess is false and StrResult is empty", async () => {
  const errorResponse = {
    BG: {
      BoolSuccess: false,
      StrResult: "",
      StrExceptions: ["Connection timeout", "Retry failed"],
    },
    LstAppointment: [],
  };

  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(errorResponse), { status: 200 })
  );

  await expect(
    adapter.fetchTeeTimes(mockConfig, "2026-04-15")
  ).rejects.toThrow("Connection timeout; Retry failed");
});
```

**Step 2: Eagle Club — non-numeric EighteenFee test**

```typescript
it("returns null price for non-numeric EighteenFee", async () => {
  const badFeeFixture = {
    ...fixture,
    LstAppointment: [
      { ...fixture.LstAppointment[0], EighteenFee: "N/A" },
    ],
  };

  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(badFeeFixture), { status: 200 })
  );

  const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
  expect(results[0].price).toBeNull();
});
```

**Step 3: ForeUp — asymmetric nines test**

In `foreup.test.ts`, add:

```typescript
it("omits nines when only teesheet_side_name is set", async () => {
  const asymmetricFixture = [
    {
      ...fixture[0],
      teesheet_side_name: "East",
      reround_teesheet_side_name: null,
    },
  ];

  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(asymmetricFixture), { status: 200 })
  );

  const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");
  expect(results[0].nines).toBeUndefined();
});
```

Note: use `fixture[0]` spread (the existing imported fixture). Read the test file to confirm the import name.

**Step 4: Index — eagle_club lookup test**

In `index.test.ts`, add:

```typescript
it("returns EagleClubAdapter for eagle_club platform", () => {
  const adapter = getAdapter("eagle_club");
  expect(adapter).toBeDefined();
  expect(adapter!.platformId).toBe("eagle_club");
});
```

Follow the pattern of the existing adapter lookup tests in the file.

**Step 5: Run tests**

```bash
npx vitest run src/adapters/
```

**Step 6: Commit**

```
test: add adapter edge case tests (Eagle Club fallbacks, ForeUp asymmetric nines, index lookup)
```

---

## Task 7: City Mapping Completeness

**BEFORE starting work:**
1. Read `src/config/areas.ts` — the `CITY_TO_AREA` mapping
2. Read `src/config/areas.test.ts` — the existing tests

**Gaps closed:** #18–31 (14 city-to-area mappings lack specific assertions)

**Files:**
- Modify: `src/config/areas.test.ts`

**Fix approach:** Add a single data-driven test that asserts the exact area for every city in `CITY_TO_AREA`. This closes all 14 gaps with one test rather than 14 individual tests.

**Step 1: Add exhaustive city mapping test**

In `areas.test.ts`, inside the `describe("getArea", ...)` block, add:

```typescript
it.each([
  ["Brooklyn Park", "North Metro"],
  ["Coon Rapids", "North Metro"],
  ["Blaine", "North Metro"],
  ["Ham Lake", "North Metro"],
  ["Anoka", "North Metro"],
  ["White Bear Lake", "East Metro"],
  ["Maplewood", "East Metro"],
  ["Inver Grove Heights", "East Metro"],
  ["Chaska", "South Metro"],
  ["Apple Valley", "South Metro"],
  ["Bloomington", "South Metro"],
  ["Golden Valley", "South Metro"],
  ["Medina", "South Metro"],
  ["Maple Plain", "South Metro"],
  ["Maple Grove", "South Metro"],
])("maps %s to %s", (city, expectedArea) => {
  expect(getArea(city)).toBe(expectedArea);
});
```

This covers every city that previously only had the `courses.json` guard (which can't detect misclassification). Cities already covered by individual tests (Minneapolis, St. Paul, Roseville, Edina, Hopkins, Stillwater, SD cities) are intentionally not duplicated.

**Step 2: Run tests**

```bash
npx vitest run src/config/areas.test.ts
```

**Step 3: Commit**

```
test: add exhaustive city-to-area mapping assertions
```

**After this task, review Tasks 5-7 as a batch:**
```
You MUST carefully review the batch of work from multiple perspectives
and revise/refine as appropriate. Repeat this review loop (minimum three rounds).
```

---

## Task 8: UI Component Tests — tee-time-list.tsx

**BEFORE starting work:**
1. Read `src/components/tee-time-list.tsx` — the component code
2. Read `src/components/tee-time-list.test.ts` — the existing tests (only `isStale`)
3. This file needs `// @vitest-environment jsdom` pragma for React rendering tests
4. Import from `@testing-library/react`: `render`, `screen`

**Gaps closed:** #15 (nines display), #47–63 (17 rendering paths)

**Files:**
- Modify: `src/components/tee-time-list.test.ts`

**Important:** The existing test file tests `isStale` and `STALE_THRESHOLD_MS` in a `node` environment. The new rendering tests need `jsdom`. Create a SEPARATE test file `src/components/tee-time-list.render.test.tsx` with `// @vitest-environment jsdom` to avoid breaking existing tests. The `.tsx` extension is needed for JSX.

Actually, create `src/components/tee-time-list.render.test.tsx` as a new file.

**Files (revised):**
- Create: `src/components/tee-time-list.render.test.tsx`
- Do NOT modify: `src/components/tee-time-list.test.ts` (leave existing tests untouched)

**Step 1: Create the render test file**

The file must start with:
```typescript
// @vitest-environment jsdom
// ABOUTME: Rendering tests for the TeeTimeList component.
// ABOUTME: Covers nines display, loading/empty states, date grouping, and price formatting.
```

**Step 2: Write test helpers**

```typescript
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TeeTimeList } from "./tee-time-list";

// Mock useAuth since it's used by the component
vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ isLoggedIn: false }),
}));

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    <a href={href}>{children}</a>,
}));

function makeTeeTimeItem(overrides: Partial<Parameters<typeof TeeTimeList>[0]["teeTimes"][0]> = {}) {
  return {
    course_id: "test-course",
    course_name: "Test Course",
    course_city: "Minneapolis",
    date: "2026-04-15",
    time: "08:00",
    price: 45,
    holes: 18,
    open_slots: 4,
    booking_url: "https://example.com",
    fetched_at: new Date().toISOString(),
    ...overrides,
  };
}
```

**Step 3: Write rendering tests**

Test these specific paths:

```typescript
describe("TeeTimeList rendering", () => {
  it("shows loading message when loading is true", () => {
    render(<TeeTimeList teeTimes={[]} loading={true} />);
    expect(screen.getByText("Loading tee times...")).toBeDefined();
  });

  it("shows empty state when no tee times", () => {
    render(<TeeTimeList teeTimes={[]} loading={false} />);
    expect(screen.getByText("No tee times found")).toBeDefined();
  });

  it("displays nines label when nines is present", () => {
    const items = [makeTeeTimeItem({ nines: "East/West" })];
    render(<TeeTimeList teeTimes={items} loading={false} />);
    expect(screen.getByText("18 holes (East/West)")).toBeDefined();
  });

  it("omits nines label when nines is null", () => {
    const items = [makeTeeTimeItem({ nines: null })];
    render(<TeeTimeList teeTimes={items} loading={false} />);
    expect(screen.getByText("18 holes")).toBeDefined();
  });

  it("omits nines label when nines is undefined", () => {
    const items = [makeTeeTimeItem()]; // no nines
    render(<TeeTimeList teeTimes={items} loading={false} />);
    expect(screen.getByText("18 holes")).toBeDefined();
  });

  it("displays singular 'spot' for 1 open slot", () => {
    const items = [makeTeeTimeItem({ open_slots: 1 })];
    render(<TeeTimeList teeTimes={items} loading={false} />);
    expect(screen.getByText("1 spot")).toBeDefined();
  });

  it("displays plural 'spots' for multiple open slots", () => {
    const items = [makeTeeTimeItem({ open_slots: 3 })];
    render(<TeeTimeList teeTimes={items} loading={false} />);
    expect(screen.getByText("3 spots")).toBeDefined();
  });

  it("shows price when not null", () => {
    const items = [makeTeeTimeItem({ price: 45 })];
    render(<TeeTimeList teeTimes={items} loading={false} />);
    expect(screen.getByText("$45.00")).toBeDefined();
  });

  it("hides price when null", () => {
    const items = [makeTeeTimeItem({ price: null })];
    render(<TeeTimeList teeTimes={items} loading={false} />);
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("renders course name as a link", () => {
    const items = [makeTeeTimeItem({ course_id: "braemar", course_name: "Braemar" })];
    render(<TeeTimeList teeTimes={items} loading={false} />);
    const link = screen.getByText("Braemar");
    expect(link.closest("a")).toHaveAttribute("href", "/courses/braemar");
  });

  it("renders Book button with external link", () => {
    const items = [makeTeeTimeItem({ booking_url: "https://example.com/book" })];
    render(<TeeTimeList teeTimes={items} loading={false} />);
    const bookLink = screen.getByText("Book");
    expect(bookLink).toHaveAttribute("href", "https://example.com/book");
    expect(bookLink).toHaveAttribute("target", "_blank");
  });
});
```

Note: You may need to adjust the query methods (`getByText`, `queryByText`) depending on how React Testing Library finds text in the rendered DOM. Read the component's JSX carefully — text may be inside nested elements. Use `screen.getByText` with exact or regex matching as appropriate.

**Step 4: Run tests**

```bash
npx vitest run src/components/tee-time-list.render.test.tsx
```

If tests fail due to mocking or environment issues, debug and fix. Common issues:
- `formatTime` import may need mocking if it uses browser APIs
- `staleAge` import may need mocking
- The `navigator.sendBeacon` call may need a mock in jsdom

**Step 5: Commit**

```
test: add TeeTimeList rendering tests (nines display, loading/empty states, price)
```

---

## Task 9: UI Component Tests — courses/page.tsx

**BEFORE starting work:**
1. Read `src/app/courses/page.tsx` — the component code
2. This needs `// @vitest-environment jsdom` and `.tsx` extension
3. The component imports from `@/hooks/use-favorites`, `@/config/areas`, `@/config/courses.json` — all need mocking

**Gaps closed:** #6 (disabled filter in courses page), #36–46 (11 page rendering paths)

**Files:**
- Create: `src/app/courses/page.test.tsx`

**Step 1: Create test file with mocks**

```typescript
// @vitest-environment jsdom
// ABOUTME: Tests for the courses browser page.
// ABOUTME: Verifies disabled course filtering, area grouping, and favorite toggling.
```

Mock dependencies:
- `@/hooks/use-favorites` — return `{ toggleFavorite: vi.fn(), isFavorite: () => false }`
- `@/config/courses.json` — provide a small test catalog (3-4 courses with varying `disabled` values)
- `next/link` — render as `<a>`

**Step 2: Write tests**

Focus on the gaps that matter most:

```typescript
it("filters out disabled courses", () => {
  // Mock catalog with one active and one disabled course
  // Render, verify disabled course is not in the DOM
});

it("shows all non-disabled courses", () => {
  // Mock catalog with multiple active courses
  // Render, verify all are in the DOM
});

it("groups courses by area", () => {
  // Mock catalog with courses in different areas
  // Verify area headings appear
});
```

Read `src/app/courses/page.tsx` to understand the exact component structure and what to assert on.

**Step 3: Run tests**

```bash
npx vitest run src/app/courses/page.test.tsx
```

**Step 4: Commit**

```
test: add courses page tests (disabled filtering, area grouping)
```

---

## Task 10: Nice-to-Have — AbortSignal + Cron Error Catches

**BEFORE starting work:**
1. Read the adapter test files for chronogolf, eagle-club, and foreup
2. Read `src/lib/cron-handler.test.ts`

**Gaps closed:** #32–34 (AbortSignal.timeout), #64–68 (cron error catch paths)

**Files:**
- Modify: `src/adapters/chronogolf.test.ts`
- Modify: `src/adapters/eagle-club.test.ts`
- Modify: `src/adapters/foreup.test.ts`
- Modify: `src/lib/cron-handler.test.ts`

### Part A: AbortSignal tests

For each of the three adapters, add a test verifying `AbortSignal.timeout(10000)` is passed to fetch:

```typescript
it("passes AbortSignal.timeout to fetch", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(/* appropriate fixture or empty response */), { status: 200 })
  );

  await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

  const fetchOptions = fetchSpy.mock.calls[0][1] as RequestInit;
  expect(fetchOptions.signal).toBeDefined();
});
```

Note: `AbortSignal.timeout` creates a signal, not a raw number. We can only verify a signal was passed. If you want to verify the timeout value, check if `fetchOptions.signal` is an `AbortSignal` instance.

### Part B: Cron handler error catch tests

Add tests for housekeeping error isolation. These verify that if one cleanup function throws, the others still run:

```typescript
it("continues cleanup when deactivateStaleCourses throws", async () => {
  // Mock deactivateStaleCourses to throw
  // Verify cleanupOldPolls and cleanupExpiredSessions are still called
});
```

Read the existing housekeeping test section to understand the mock patterns.

**Run tests and commit:**

```bash
npm test
```

```
test: add AbortSignal and cron error isolation tests
```

**After this task, review Tasks 8-10 as a batch:**
```
You MUST carefully review the batch of work from multiple perspectives
and revise/refine as appropriate. Repeat this review loop (minimum three rounds).
```

**BEFORE marking this task complete:**
1. Run `npm test && npx tsc --noEmit` and confirm green
2. Review tests against `dev/testing-pitfalls-coverage-review.md`

---

## Parallelization Notes

**Sequential dependencies:**
- Task 1 must complete first (unblocks Tasks 4, 5 which use `seedCourse`)
- Task 4 depends on Task 1
- Tasks 2, 3 depend on Task 1 (for `seedCourse` with disabled support)

**After Task 1, these groups can run in parallel:**
- Group A: Tasks 2, 3 (cron handler + route integration tests)
- Group B: Tasks 5, 6 (db.ts + adapter edge cases + city mappings)
- Group C: Tasks 8, 9 (UI component tests)
- Task 10 (nice-to-haves) can run anytime after Task 1

**Recommended approach:** Sequential Tasks 1-4, then parallel Groups B and C, then Task 10.

**Review checkpoints:**
- After Tasks 1-4 (foundation + security-critical + integration tests)
- After Tasks 5-7 (db + adapters + areas)
- After Tasks 8-10 (UI + nice-to-haves)
