# Pitfalls Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Address all findings from `dev/testing-pitfalls-coverage-review.md` — 27 uncovered items, 13 partial items, and 18 bug hunt findings.

**Architecture:** Organized into 6 phases. Phase 1 is quick bug fixes (source-only). Phases 2-4 are larger fixes with tests. Phases 5-6 create missing test files and fill coverage gaps. Each phase ends with a commit.

**Tech Stack:** TypeScript, Vitest, Next.js App Router, Cloudflare D1, React 19

**Reference files:**
- `dev/testing-pitfalls-coverage-review.md` — full findings
- `dev/testing-pitfalls.md` — the checklist
- `src/test/d1-mock.ts` — D1 mock helper (use `createMockD1()`)

---

## Phase 1: Quick Bug Fixes

Small source-only changes. No new tests needed — tests come in later phases.

### Task 1: Fix error detail leakage in OAuth callback (A1)

**Files:**
- Modify: `src/app/api/auth/google/callback/route.ts`

**Step 1: Remove `detail` query params from error redirects**

Replace lines 84-86 (code exchange error):
```ts
    redirectUrl.searchParams.set("error", "code_exchange");
    redirectUrl.searchParams.set("detail", String(exchangeErr));
    return NextResponse.redirect(redirectUrl);
```
with:
```ts
    console.error("OAuth code exchange failed:", exchangeErr);
    redirectUrl.searchParams.set("error", "code_exchange");
    return NextResponse.redirect(redirectUrl);
```

Replace lines 104-107 (token decode error):
```ts
    redirectUrl.searchParams.set("error", "token_decode");
    redirectUrl.searchParams.set("detail", String(tokenErr));
    return NextResponse.redirect(redirectUrl);
```
with:
```ts
    console.error("OAuth token decode failed:", tokenErr);
    redirectUrl.searchParams.set("error", "token_decode");
    return NextResponse.redirect(redirectUrl);
```

Replace lines 196-199 (DB error):
```ts
    redirectUrl.searchParams.set("error", "db_error");
    redirectUrl.searchParams.set("detail", String(err));
    return NextResponse.redirect(redirectUrl);
```
with:
```ts
    redirectUrl.searchParams.set("error", "db_error");
    return NextResponse.redirect(redirectUrl);
```
(line 195 already has `console.error` for this case)

**Step 2: Verify no `detail` params remain**

Run: `grep -n "detail" src/app/api/auth/google/callback/route.ts`
Expected: no matches

### Task 2: Clear OAuth cookies on user cancel (A2)

**Files:**
- Modify: `src/app/api/auth/google/callback/route.ts`

**Step 1: Add cookie clearing to the cancel redirect**

Replace lines 36-40:
```ts
  const error = request.nextUrl.searchParams.get("error");
  if (error) {
    const redirectUrl = new URL(returnTo, request.url);
    return NextResponse.redirect(redirectUrl);
  }
```
with:
```ts
  const error = request.nextUrl.searchParams.get("error");
  if (error) {
    const redirectUrl = new URL(returnTo, request.url);
    const response = NextResponse.redirect(redirectUrl);
    const isSecure = request.url.startsWith("https://");
    const baseCookieOpts = {
      httpOnly: true,
      sameSite: "lax" as const,
      path: "/",
      secure: isSecure,
    };
    response.cookies.set("tct-oauth-state", "", { ...baseCookieOpts, maxAge: 0 });
    response.cookies.set("tct-oauth-verifier", "", { ...baseCookieOpts, maxAge: 0 });
    return response;
  }
```

### Task 3: Fix comment in poller.ts (C5)

**Files:**
- Modify: `src/lib/poller.ts`

**Step 1: Fix the misleading comment on line 25**

Replace:
```ts
  // Days 5-7: twice daily (roughly every 10 hours)
```
with:
```ts
  // Offsets 4-6 (5-7 days out): twice daily (roughly every 10 hours)
```

### Task 4: Add top-level try/catch in runCronPoll (5.5)

**Files:**
- Modify: `src/lib/cron-handler.ts`

**Step 1: Wrap the body of runCronPoll in a try/catch**

The issue is that if `db.prepare("SELECT * FROM courses").all()` throws at line 60-62, the exception propagates into `ctx.waitUntil()` where it's silently swallowed. Wrap the function body so errors are at least logged.

Add a try/catch around the entire function body (after `const now = new Date();` and `if (!shouldRunThisCycle(now))` check). The block to wrap starts at line 59 (the comment `// Fetch ALL courses (active and inactive)`) and ends at line 194 (the `return { pollCount, courseCount: ...}` statement). Wrap everything between (and including) those lines:

```ts
  try {
    // Fetch ALL courses (active and inactive)
    const coursesResult = await db
      .prepare("SELECT * FROM courses")
      .all<CourseRow>();
    // ... all existing code through to ...
    return { pollCount, courseCount: activeCourses.length, inactiveProbeCount, skipped: false };
  } catch (err) {
    console.error("Cron poll fatal error:", err);
    return { pollCount: 0, courseCount: 0, inactiveProbeCount: 0, skipped: false };
  }
```

The indentation of all existing code within this block increases by one level. Keep the `const now` and `shouldRunThisCycle` check outside the try/catch (they should not be wrapped).

### Task 5: Fix favorites-only with 0 favorites fetching all courses (F1)

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Short-circuit fetch when favoritesOnly is true but favorites is empty**

Replace lines 82-106:
```ts
      try {
        const fetches = dates.map((date) => {
          const params = new URLSearchParams({ date });
          if (favoritesOnly) {
            if (favorites.length > 0) {
              params.set("courses", favorites.join(","));
            }
          }
```
with:
```ts
      try {
        // If filtering to favorites but none exist, show empty list
        if (favoritesOnly && favorites.length === 0) {
          setTeeTimes([]);
          return;
        }

        const fetches = dates.map((date) => {
          const params = new URLSearchParams({ date });
          if (favoritesOnly) {
            params.set("courses", favorites.join(","));
          }
```

Note: the inner `if (favorites.length > 0)` is no longer needed because the outer guard already handles the empty case.

### Task 6: Memoize contextValue in AuthProvider (F4)

**Files:**
- Modify: `src/components/auth-provider.tsx`

**Step 1: Add useMemo import and wrap contextValue**

Add `useMemo` to the import:
```ts
import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
```

Replace lines 122-130:
```ts
  const contextValue: AuthContextValue = {
    user,
    isLoggedIn: user !== null,
    isLoading,
    favoritesVersion,
    signOut,
    deleteAccount,
    showToast,
  };
```
with:
```ts
  const contextValue = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoggedIn: user !== null,
      isLoading,
      favoritesVersion,
      signOut,
      deleteAccount,
      showToast,
    }),
    [user, isLoading, favoritesVersion, signOut, deleteAccount, showToast]
  );
```

### Task 7: Add type annotation to home page teeTimes state (7.3)

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Type the teeTimes state**

The tee-times API does `SELECT t.*, c.name as course_name, c.city as course_city`. The `t.*` maps to `TeeTimeRow` from `src/types/index.ts:41-51`, plus two aliases. Use the existing `TeeTimeRow` type extended with the join fields.

Add import at the top of `src/app/page.tsx`:
```ts
import type { TeeTimeRow } from "@/types";
```

Replace line 23:
```ts
  const [teeTimes, setTeeTimes] = useState([]);
```
with:
```ts
  const [teeTimes, setTeeTimes] = useState<Array<TeeTimeRow & { course_name: string; course_city: string }>>([]);
```

This matches the exact shape returned by `GET /api/tee-times` — all `tee_times` columns (`id`, `course_id`, `date`, `time`, `price`, `holes`, `open_slots`, `booking_url`, `fetched_at`) plus the two join aliases.

### Task 8: Run tests, type-check, commit

**Step 1:** Run `npm test` — all tests must pass
**Step 2:** Run `npx tsc --noEmit` — no type errors
**Step 3:** Commit all Phase 1 changes:
```
fix: address bug hunt findings — error leakage, cookie cleanup, type safety

- Remove error detail leakage from OAuth callback redirect URLs (A1)
- Clear OAuth cookies when user cancels at Google consent screen (A2)
- Fix comment for day offset ranges in poller.ts (C5)
- Add top-level try/catch in runCronPoll for error visibility (5.5)
- Short-circuit fetch when favoritesOnly with 0 favorites (F1)
- Memoize AuthProvider contextValue to prevent unnecessary re-renders (F4)
- Add type annotation to home page teeTimes state (7.3)
```

---

## Phase 2: Cron Handler Resilience (C2, C3, C4, 1.4, 5.1)

### Task 9: Move try/catch inside the active course date loop

**Files:**
- Modify: `src/lib/cron-handler.ts`

**Step 1: Write failing test — active course error on one date doesn't skip remaining dates**

Add to `src/lib/cron-handler.test.ts` inside the `runCronPoll auto-active management` describe block. Note: `makeMockDb`, `activeCourse`, `mockedPollCourse`, and `mockedShouldPollDate` are already defined in that describe block's scope — do NOT redefine them.

```ts
  it("continues polling remaining dates after one date throws", async () => {
    // Make pollCourse throw on the 2nd call (date index 1), succeed on all others
    mockedPollCourse
      .mockResolvedValueOnce("success")  // date 0
      .mockRejectedValueOnce(new Error("transient D1 error"))  // date 1
      .mockResolvedValue("no_data");     // dates 2-6

    mockedShouldPollDate.mockReturnValue(true);
    const db = makeMockDb([activeCourse]);
    const result = await runCronPoll(db as unknown as D1Database);

    // All 7 dates should have been attempted despite the error on date 1
    expect(mockedPollCourse).toHaveBeenCalledTimes(7);
    expect(result.pollCount).toBe(7);
  });
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --reporter verbose src/lib/cron-handler.test.ts`
Expected: FAIL — currently the error on date 1 aborts the loop, so only 1-2 calls happen.

**Step 3: Restructure the active course loop to isolate per-date**

In `src/lib/cron-handler.ts`, replace lines 91-117:
```ts
  // --- Active courses: full 7-date polling at dynamic frequency ---
  for (const course of activeCourses) {
    try {
      for (let i = 0; i < dates.length; i++) {
        const lastPolled = pollTimeMap.get(`${course.id}:${dates[i]}`);
        const minutesSinceLast = lastPolled
          ? (Date.now() - new Date(lastPolled).getTime()) / 60000
          : Infinity;

        if (shouldPollDate(i, minutesSinceLast)) {
          const status = await pollCourse(db, course, dates[i]);
          pollCount++;

          if (status === "success") {
            await db
              .prepare("UPDATE courses SET last_had_tee_times = ? WHERE id = ?")
              .bind(now.toISOString(), course.id)
              .run();
          }

          await sleep(250);
        }
      }
    } catch (err) {
      console.error(`Error polling course ${course.id}:`, err);
    }
  }
```

with:
```ts
  // --- Active courses: full 7-date polling at dynamic frequency ---
  for (const course of activeCourses) {
    for (let i = 0; i < dates.length; i++) {
      const lastPolled = pollTimeMap.get(`${course.id}:${dates[i]}`);
      const minutesSinceLast = lastPolled
        ? (Date.now() - new Date(lastPolled).getTime()) / 60000
        : Infinity;

      if (shouldPollDate(i, minutesSinceLast)) {
        try {
          const status = await pollCourse(db, course, dates[i]);
          pollCount++;

          if (status === "success") {
            await db
              .prepare("UPDATE courses SET last_had_tee_times = ? WHERE id = ?")
              .bind(now.toISOString(), course.id)
              .run();
          }
        } catch (err) {
          console.error(`Error polling ${course.id} for ${dates[i]}:`, err);
          pollCount++;
        }

        await sleep(250);
      }
    }
  }
```

Key changes:
- try/catch moved inside the date loop so one date's failure doesn't skip others
- `pollCount++` also in catch so the count is accurate
- Error message includes the date for easier debugging

**Step 4: Run test to verify it passes**

Run: `npm test -- --reporter verbose src/lib/cron-handler.test.ts`
Expected: PASS

**Step 5: Write test — active course error isolation between courses**

Add to the same describe block (covers 5.1 for active courses):
```ts
  it("continues polling other active courses after one throws on all dates", async () => {
    const active2 = { ...activeCourse, id: "test-active-2", name: "Active 2" };

    // First course: all dates throw. Second course: all succeed.
    let callCount = 0;
    mockedPollCourse.mockImplementation(async (_db, course) => {
      callCount++;
      if (course.id === "test-active") throw new Error("adapter crash");
      return "no_data";
    });

    mockedShouldPollDate.mockReturnValue(true);
    const db = makeMockDb([activeCourse, active2]);
    await runCronPoll(db as unknown as D1Database);

    // Both courses should have all 7 dates attempted
    expect(callCount).toBe(14);
  });
```

**Step 6: Run test — should already pass with the new structure**

Run: `npm test -- --reporter verbose src/lib/cron-handler.test.ts`
Expected: PASS

### Task 10: Wrap logPoll in try/catch in pollCourse catch block (C2)

**Files:**
- Modify: `src/lib/poller.ts`
- Test: `src/lib/poller.test.ts`

**Step 1: Write failing test — logPoll failure in catch doesn't propagate**

Add to `src/lib/poller.test.ts` inside the `pollCourse` describe block:

```ts
  it("returns error even when logPoll throws in catch block", async () => {
    const mockAdapter = {
      platformId: "foreup",
      fetchTeeTimes: vi.fn().mockRejectedValue(new Error("API timeout")),
    };
    vi.mocked(getAdapter).mockReturnValue(mockAdapter);
    vi.mocked(logPoll).mockRejectedValueOnce(new Error("D1 connection lost"));

    const result = await pollCourse(mockDb as any, mockCourse, "2026-04-15");
    expect(result).toBe("error");
  });
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --reporter verbose src/lib/poller.test.ts`
Expected: FAIL — `logPoll` rejection propagates as an unhandled promise rejection.

**Step 3: Wrap logPoll call in the catch block**

In `src/lib/poller.ts`, replace lines 76-80:
```ts
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logPoll(db, course.id, date, "error", 0, message);
    return "error";
  }
```
with:
```ts
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await logPoll(db, course.id, date, "error", 0, message);
    } catch (logErr) {
      console.error(`Failed to log poll error for ${course.id}:`, logErr);
    }
    return "error";
  }
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --reporter verbose src/lib/poller.test.ts`
Expected: PASS

### Task 11: Commit Phase 2

Run: `npm test` — all tests pass
Run: `npx tsc --noEmit` — no type errors
Commit:
```
fix: isolate cron errors per-date and harden pollCourse error handling

- Move try/catch inside the active course date loop so a failure on
  one date doesn't skip remaining dates for that course (C3, C4)
- Add active course inter-course error isolation test (5.1)
- Wrap logPoll in try/catch inside pollCourse's catch block so a
  double-fault doesn't propagate (C2, 1.4)
```

---

## Phase 3: Client-Side Bug Fixes (F2, A5)

### Task 12: Clear localStorage favorites on sign-out (F2)

**Files:**
- Modify: `src/components/auth-provider.tsx`

**Step 1: Import setFavorites is already imported — add clearing on sign-out**

Replace lines 102-105:
```ts
  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }, []);
```
with:
```ts
  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setFavorites([]);
    setUser(null);
  }, []);
```

### Task 13: Sync server favorites on new-device sign-in (A5)

**Files:**
- Modify: `src/components/auth-provider.tsx`

**Step 1: Always fetch and sync server favorites after sign-in, not just when local favorites exist**

The current code at lines 52-84 only syncs if `localFavorites.length > 0`. Restructure so the server-to-localStorage sync always happens on `justSignedIn`, with the merge being conditional on having local favorites.

Replace lines 52-86 (the `justSignedIn` block):
```ts
        if (params.get("justSignedIn") === "true") {
          const localFavorites = getFavorites();

          if (localFavorites.length > 0) {
            const mergeRes = await fetch("/api/user/favorites/merge", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ courseIds: localFavorites }),
            });

            if (mergeRes.ok) {
              const { merged } = (await mergeRes.json()) as { merged: number };

              const favRes = await fetch("/api/user/favorites");
              if (favRes.ok) {
                const { favorites } = (await favRes.json()) as {
                  favorites: { courseId: string; courseName: string }[];
                };
                setFavorites(
                  favorites.map((f: { courseId: string; courseName: string }) => ({
                    id: f.courseId,
                    name: f.courseName,
                  }))
                );
              }

              if (merged > 0) {
                showToast(`Synced ${merged} favorites from this device`);
              }
            } else {
              showToast("Couldn\u2019t sync favorites \u2014 they\u2019ll sync next time");
            }
          }

          setFavoritesVersion((v) => v + 1);
```
with:
```ts
        if (params.get("justSignedIn") === "true") {
          const localFavorites = getFavorites();

          // Merge local favorites to server if any exist
          if (localFavorites.length > 0) {
            const mergeRes = await fetch("/api/user/favorites/merge", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ courseIds: localFavorites }),
            });

            if (mergeRes.ok) {
              const { merged } = (await mergeRes.json()) as { merged: number };
              if (merged > 0) {
                showToast(`Synced ${merged} favorites from this device`);
              }
            } else {
              showToast("Couldn\u2019t sync favorites \u2014 they\u2019ll sync next time");
            }
          }

          // Always sync server favorites to localStorage (covers new-device sign-in)
          const favRes = await fetch("/api/user/favorites");
          if (favRes.ok) {
            const { favorites } = (await favRes.json()) as {
              favorites: { courseId: string; courseName: string }[];
            };
            setFavorites(
              favorites.map((f: { courseId: string; courseName: string }) => ({
                id: f.courseId,
                name: f.courseName,
              }))
            );
          }

          setFavoritesVersion((v) => v + 1);
```

Key change: the `GET /api/user/favorites` call and `setFavorites()` are now outside the `if (localFavorites.length > 0)` block, so they run on every `justSignedIn`, including new-device sign-ins with empty localStorage.

Note: `setFavorites` here is the function imported from `@/lib/favorites` (line 6 of auth-provider.tsx), not a React `useState` setter. It writes to `localStorage`.

### Task 14: Commit Phase 3

Run: `npm test` — all tests pass
Run: `npx tsc --noEmit` — no type errors
Commit:
```
fix: clear favorites on sign-out and sync on new-device sign-in

- Clear localStorage favorites when signing out to prevent cross-account
  favorite leakage on shared devices (F2)
- Always sync server favorites to localStorage after sign-in, not just
  when local favorites exist — fixes new-device sign-in showing no
  favorites (A5)
```

---

## Phase 4: Security & Resilience (6.3, 9.4, 9.5, 4.1, 2.2, 7.4)

### Task 15: Add fetch timeout to all adapters (6.3)

**Files:**
- Modify: `src/adapters/cps-golf.ts`
- Modify: `src/adapters/foreup.ts`
- Modify: `src/adapters/teeitup.ts`

**Step 1: Add a shared timeout constant and apply to each adapter**

Each adapter makes `fetch()` calls. Add `signal: AbortSignal.timeout(10000)` (10 seconds) to every `fetch()` call in each adapter. This is short enough to prevent Worker CPU exhaustion but long enough for legitimate API responses.

Exact locations for each adapter:

For **CPS Golf** (`src/adapters/cps-golf.ts`): 3 fetch calls:
- Line 65: `fetch(\`${baseUrl}/TeeTimes?${params}\`, { ... })` — add `signal` to options
- Line 94: `fetch(url, { ... })` — token fetch, add `signal` to options
- Line 117: `fetch(\`${baseUrl}/RegisterTransactionId\`, { ... })` — add `signal` to options

For **ForeUp** (`src/adapters/foreup.ts`): 1 fetch call:
- Line 39: `fetch(url)` — change to `fetch(url, { signal: AbortSignal.timeout(10000) })`

For **TeeItUp** (`src/adapters/teeitup.ts`): 1 fetch call:
- Line 39: `fetch(url, { ... })` — add `signal` to the existing options object

The `AbortSignal.timeout()` API is available in Cloudflare Workers and all modern JS engines. When a timeout fires, `fetch()` rejects with an `AbortError`, which the adapter's existing error handling will catch and throw as a normal error.

**Step 2: Run existing adapter tests**

Run: `npm test -- --reporter verbose src/adapters/`
Expected: all pass (timeout doesn't affect mocked fetches)

### Task 16: Add cookie security attribute assertions (9.4)

**Files:**
- Modify: `src/lib/auth.test.ts`

**Step 1: Add tests asserting cookie attributes**

Add to the `authenticateRequest` describe block:

```ts
  it("sets Secure flag on cookies when request is HTTPS", async () => {
    const { createJWT, authenticateRequest } = await import("./auth");
    const { db, mockFirst } = createMockD1();

    vi.useFakeTimers();
    const jwt = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    vi.advanceTimersByTime(16 * 60 * 1000);

    mockFirst.mockResolvedValueOnce({
      user_id: "u1",
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
    mockFirst.mockResolvedValueOnce({ email: "a@b.com" });

    const req = makeRequest(
      { "tct-session": jwt, "tct-refresh": "refresh-token" },
      "https://example.com/api/test"
    );
    const result = await authenticateRequest(req, db, secret);

    const cookies = result.headers.getSetCookie();
    for (const cookie of cookies) {
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Secure");
    }

    vi.useRealTimers();
  });

  it("omits Secure flag on cookies when request is HTTP", async () => {
    const { createJWT, authenticateRequest } = await import("./auth");
    const { db, mockFirst } = createMockD1();

    vi.useFakeTimers();
    const jwt = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    vi.advanceTimersByTime(16 * 60 * 1000);

    mockFirst.mockResolvedValueOnce({
      user_id: "u1",
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
    mockFirst.mockResolvedValueOnce({ email: "a@b.com" });

    const req = makeRequest(
      { "tct-session": jwt, "tct-refresh": "refresh-token" },
      "http://localhost:3000/api/test"
    );
    const result = await authenticateRequest(req, db, secret);

    const cookies = result.headers.getSetCookie();
    for (const cookie of cookies) {
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).not.toContain("Secure");
    }

    vi.useRealTimers();
  });
```

**Step 2: Run tests**

Run: `npm test -- --reporter verbose src/lib/auth.test.ts`
Expected: PASS (the implementation already sets these attributes correctly)

### Task 17: Add roundtrip and localStorage resilience tests (2.2, 7.4)

**Files:**
- Modify: `src/components/date-picker.test.ts`
- Modify: `src/lib/favorites.test.ts`

**Step 1: Add roundtrip consistency test to date-picker.test.ts**

```ts
it("roundtrips toDateStr(fromDateStr(s)) for any date", () => {
  const dates = ["2026-01-01", "2026-03-08", "2026-06-15", "2026-11-01", "2026-12-31"];
  for (const d of dates) {
    expect(toDateStr(fromDateStr(d))).toBe(d);
  }
});
```

**Step 2: Add localStorage unavailability test to favorites.test.ts**

The test file (`src/lib/favorites.test.ts`) uses a custom `localStorageMock` object (defined in `beforeAll`) with `vi.stubGlobal("localStorage", localStorageMock)`. To test what happens when `localStorage.getItem` throws, modify the mock's `getItem` temporarily — do NOT use `vi.spyOn(Storage.prototype, ...)` since the stubbed global bypasses `Storage.prototype`.

Add inside the `getFavorites` describe block (after the "returns empty array on malformed JSON" test):

```ts
    it("returns empty array when localStorage throws", () => {
      const originalGetItem = localStorageMock.getItem;
      localStorageMock.getItem = vi.fn(() => {
        throw new Error("SecurityError: localStorage not available");
      });
      expect(getFavorites()).toEqual([]);
      localStorageMock.getItem = originalGetItem;
    });
```

Note: `localStorageMock` is defined in the outer `describe("favorites")` scope and is accessible from this inner describe block. The `readRaw()` function in `favorites.ts` already has a try/catch around the `localStorage.getItem` call (lines 13-24), so this test documents existing resilience.

**Step 3: Run tests**

Run: `npm test -- --reporter verbose src/components/date-picker.test.ts src/lib/favorites.test.ts`
Expected: PASS

### Task 18: Add poll_log cleanup assertion (4.1)

**Files:**
- Modify: `src/lib/cron-handler.test.ts`

**Step 1: Add test to the `runCronPoll cleanup` describe block**

```ts
  it("purges poll_log entries older than 7 days", async () => {
    await runCronPoll(mockDb as unknown as D1Database);

    const pollLogCleanup = preparedStatements.find((sql) =>
      sql.includes("DELETE FROM poll_log")
    );
    expect(pollLogCleanup).toBe(
      "DELETE FROM poll_log WHERE polled_at < datetime('now', '-7 days')"
    );
  });
```

**Step 2: Run test**

Run: `npm test -- --reporter verbose src/lib/cron-handler.test.ts`
Expected: PASS (cleanup SQL already exists in source)

### Task 19: Commit Phase 4

Run: `npm test` — all tests pass
Run: `npx tsc --noEmit` — no type errors
Commit:
```
fix: add fetch timeouts, cookie attribute tests, and coverage gaps

- Add 10s AbortSignal timeout to all adapter fetch calls (6.3)
- Add cookie security attribute assertions for Secure/HttpOnly/SameSite (9.4)
- Add date-picker roundtrip consistency test (2.2)
- Add localStorage unavailability resilience test (7.4)
- Add poll_log cleanup assertion to cron handler tests (4.1)
```

---

## Phase 5: Missing Test Files

Create test files for the 5 untested modules. Each file covers the key scenarios from the pitfalls checklist.

**Important note for all Phase 5 tasks:** These tests mock `@opennextjs/cloudflare` via `vi.mock()`. This is a new mock pattern not used elsewhere in the codebase. If the mock fails to intercept (e.g., `getCloudflareContext` still tries to access the real Cloudflare runtime), the likely fix is to ensure the `vi.mock()` call is hoisted before the import. The pattern shown below — `vi.mock()` before `import { GET } from "./route"` — should work because Vitest hoists `vi.mock()` calls automatically.

### Task 20: Create tee-times route tests (10.2, 1.5)

**Files:**
- Create: `src/app/api/tee-times/route.test.ts`

**Step 1: Write the test file**

```ts
// ABOUTME: Tests for the tee-times API route's input validation and error handling.
// ABOUTME: Covers date format validation, filter parameters, and D1 error propagation.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock getCloudflareContext
const mockAll = vi.fn();
const mockDb = {
  prepare: vi.fn().mockReturnValue({
    bind: vi.fn().mockReturnValue({
      all: mockAll,
    }),
  }),
};

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn().mockResolvedValue({
    env: { DB: mockDb },
  }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/tee-times");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

describe("GET /api/tee-times", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAll.mockResolvedValue({ results: [] });
  });

  it("returns 400 when date is missing", async () => {
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("date");
  });

  it("returns 400 for invalid date format", async () => {
    const res = await GET(makeRequest({ date: "not-a-date" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid startTime format", async () => {
    const res = await GET(makeRequest({ date: "2026-04-15", startTime: "7am" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("startTime");
  });

  it("returns 400 for invalid endTime format", async () => {
    const res = await GET(makeRequest({ date: "2026-04-15", endTime: "bad" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when too many course IDs provided", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `course-${i}`).join(",");
    const res = await GET(makeRequest({ date: "2026-04-15", courses: ids }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("50");
  });

  it("returns 200 with tee times for valid request", async () => {
    mockAll.mockResolvedValueOnce({
      results: [{ course_id: "braemar", time: "07:00", date: "2026-04-15" }],
    });
    const res = await GET(makeRequest({ date: "2026-04-15" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teeTimes).toHaveLength(1);
  });

  it("returns 500 when D1 query fails", async () => {
    mockAll.mockRejectedValueOnce(new Error("D1 timeout"));
    const res = await GET(makeRequest({ date: "2026-04-15" }));
    expect(res.status).toBe(500);
  });

  it("filters by course IDs when provided", async () => {
    mockAll.mockResolvedValueOnce({ results: [] });
    await GET(makeRequest({ date: "2026-04-15", courses: "braemar,como" }));

    const sql = mockDb.prepare.mock.calls[0][0];
    expect(sql).toContain("IN");
  });
});
```

**Step 2: Run the test**

Run: `npm test -- --reporter verbose src/app/api/tee-times/route.test.ts`
Expected: PASS

### Task 21: Create refresh route tests (2.4, 1.5, 10.2)

**Files:**
- Create: `src/app/api/courses/[id]/refresh/route.test.ts`

**Step 1: Write the test file**

```ts
// ABOUTME: Tests for the course refresh API route's validation, rate limiting, and error handling.
// ABOUTME: Covers date defaults, invalid inputs, rate limit enforcement, and pollCourse failures.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFirst = vi.fn();
const mockDb = {
  prepare: vi.fn().mockReturnValue({
    bind: vi.fn().mockReturnValue({
      first: mockFirst,
      run: vi.fn().mockResolvedValue({ success: true }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    }),
  }),
};

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn().mockResolvedValue({
    env: { DB: mockDb },
  }),
}));

vi.mock("@/lib/poller", () => ({
  pollCourse: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRefreshAllowed: vi.fn(),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";
import { pollCourse } from "@/lib/poller";
import { checkRefreshAllowed } from "@/lib/rate-limit";

function makeRequest(id: string, params: Record<string, string> = {}): {
  request: NextRequest;
  routeParams: { params: Promise<{ id: string }> };
} {
  const url = new URL(`http://localhost/api/courses/${id}/refresh`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return {
    request: new NextRequest(url),
    routeParams: { params: Promise.resolve({ id }) },
  };
}

describe("POST /api/courses/[id]/refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRefreshAllowed).mockResolvedValue({ allowed: true });
    vi.mocked(pollCourse).mockResolvedValue("success");
  });

  it("returns 404 for unknown course", async () => {
    mockFirst.mockResolvedValueOnce(null);
    const { request, routeParams } = makeRequest("nonexistent");
    const res = await POST(request, routeParams);
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid date format", async () => {
    mockFirst.mockResolvedValueOnce({ id: "braemar", platform: "foreup" });
    const { request, routeParams } = makeRequest("braemar", { date: "bad" });
    const res = await POST(request, routeParams);
    expect(res.status).toBe(400);
  });

  it("uses Central Time default when no date provided", async () => {
    mockFirst.mockResolvedValueOnce({ id: "braemar", platform: "foreup" });
    const { request, routeParams } = makeRequest("braemar");
    const res = await POST(request, routeParams);

    // pollCourse should have been called with a YYYY-MM-DD date
    const dateArg = vi.mocked(pollCourse).mock.calls[0]?.[2];
    expect(dateArg).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns 429 when rate limited", async () => {
    mockFirst.mockResolvedValueOnce({ id: "braemar", platform: "foreup" });
    vi.mocked(checkRefreshAllowed).mockResolvedValue({
      allowed: false,
      reason: "Recently refreshed",
    });
    const { request, routeParams } = makeRequest("braemar", { date: "2026-04-15" });
    const res = await POST(request, routeParams);
    expect(res.status).toBe(429);
  });

  it("returns 500 when pollCourse returns error", async () => {
    mockFirst.mockResolvedValueOnce({ id: "braemar", platform: "foreup" });
    vi.mocked(pollCourse).mockResolvedValue("error");
    const { request, routeParams } = makeRequest("braemar", { date: "2026-04-15" });
    const res = await POST(request, routeParams);
    expect(res.status).toBe(500);
  });

  it("returns 500 when pollCourse throws", async () => {
    mockFirst.mockResolvedValueOnce({ id: "braemar", platform: "foreup" });
    vi.mocked(pollCourse).mockRejectedValue(new Error("D1 crash"));
    const { request, routeParams } = makeRequest("braemar", { date: "2026-04-15" });
    const res = await POST(request, routeParams);
    expect(res.status).toBe(500);
  });

  it("returns 200 with result on success", async () => {
    mockFirst.mockResolvedValueOnce({ id: "braemar", platform: "foreup" });
    const { request, routeParams } = makeRequest("braemar", { date: "2026-04-15" });
    const res = await POST(request, routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe("success");
  });
});
```

**Step 2: Run the test**

Run: `npm test -- --reporter verbose src/app/api/courses/[id]/refresh/route.test.ts`
Expected: PASS

### Task 22: Create courses list and detail route tests (4.2)

**Files:**
- Create: `src/app/api/courses/route.test.ts`
- Create: `src/app/api/courses/[id]/route.test.ts`

**Step 1: Write courses list route test**

```ts
// ABOUTME: Tests for the courses list API route.
// ABOUTME: Covers successful listing, D1 error handling, and poll_log 24-hour filter.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAll = vi.fn();
const mockPrepare = vi.fn().mockReturnValue({
  bind: vi.fn().mockReturnValue({
    all: mockAll,
    first: vi.fn(),
  }),
  all: mockAll,
});

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn().mockResolvedValue({
    env: { DB: { prepare: mockPrepare } },
  }),
}));

import { GET } from "./route";

describe("GET /api/courses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAll.mockResolvedValue({ results: [] });
  });

  it("returns 200 with courses array", async () => {
    mockAll.mockResolvedValueOnce({
      results: [{ id: "braemar", name: "Braemar" }],
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.courses).toHaveLength(1);
  });

  it("returns 500 when D1 query fails", async () => {
    mockAll.mockRejectedValueOnce(new Error("D1 timeout"));
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it("query includes 24-hour poll_log filter", async () => {
    mockAll.mockResolvedValueOnce({ results: [] });
    await GET();
    const sql = mockPrepare.mock.calls[0][0];
    expect(sql).toContain("datetime('now', '-24 hours')");
  });
});
```

**Step 2: Write course detail route test**

```ts
// ABOUTME: Tests for the course detail API route.
// ABOUTME: Covers course lookup, 404 handling, and D1 error propagation.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFirst = vi.fn();
const mockPrepare = vi.fn().mockReturnValue({
  bind: vi.fn().mockReturnValue({
    first: mockFirst,
  }),
});

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn().mockResolvedValue({
    env: { DB: { prepare: mockPrepare } },
  }),
}));

import { GET } from "./route";

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/courses/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with course data", async () => {
    mockFirst.mockResolvedValueOnce({ id: "braemar", name: "Braemar" });
    const res = await GET(new Request("http://localhost"), makeParams("braemar"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.course.id).toBe("braemar");
  });

  it("returns 404 for unknown course", async () => {
    mockFirst.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost"), makeParams("nonexistent"));
    expect(res.status).toBe(404);
  });

  it("returns 500 when D1 query fails", async () => {
    mockFirst.mockRejectedValueOnce(new Error("D1 error"));
    const res = await GET(new Request("http://localhost"), makeParams("braemar"));
    expect(res.status).toBe(500);
  });

  it("query includes 24-hour poll_log filter", async () => {
    mockFirst.mockResolvedValueOnce({ id: "braemar" });
    await GET(new Request("http://localhost"), makeParams("braemar"));
    const sql = mockPrepare.mock.calls[0][0];
    expect(sql).toContain("datetime('now', '-24 hours')");
  });
});
```

**Step 3: Run both tests**

Run: `npm test -- --reporter verbose src/app/api/courses/route.test.ts src/app/api/courses/[id]/route.test.ts`
Expected: PASS

### Task 23: Commit Phase 5

Run: `npm test` — all tests pass
Run: `npx tsc --noEmit` — no type errors
Commit:
```
test: add missing route test files for tee-times, refresh, and courses APIs

- tee-times/route.test.ts: date validation, filter params, D1 errors
- courses/[id]/refresh/route.test.ts: rate limiting, CT default date, error propagation
- courses/route.test.ts and [id]/route.test.ts: listing, 404, D1 errors, 24h filter
```

---

## Phase 6: Remaining Coverage Gap Tests

Add tests to existing test files for the remaining PARTIAL/UNCOVERED items.

### Task 24: Add adapter malformed response and 429 tests (6.1, 6.2)

**Files:**
- Modify: `src/adapters/foreup.test.ts`

ForeUp is the simplest adapter, so add the edge cases there as a representative sample.

**Step 1: Add malformed JSON test**

```ts
it("throws on malformed JSON response", async () => {
  vi.mocked(globalThis.fetch).mockResolvedValueOnce(
    new Response("not json {{{", { status: 200 })
  );
  await expect(adapter.fetchTeeTimes(config, "2026-04-15")).rejects.toThrow();
});
```

**Step 2: Add 429 response test**

```ts
it("throws on 429 rate-limited response", async () => {
  vi.mocked(globalThis.fetch).mockResolvedValueOnce(
    new Response("Rate limited", { status: 429 })
  );
  await expect(adapter.fetchTeeTimes(config, "2026-04-15")).rejects.toThrow("429");
});
```

**Step 3: Run tests**

Run: `npm test -- --reporter verbose src/adapters/foreup.test.ts`
Expected: PASS

### Task 25: Add pollCourse JSON.parse test (3.2) and logPoll success double-fault (1.4)

**Files:**
- Modify: `src/lib/poller.test.ts`

**Step 1: Add test for malformed platform_config**

```ts
  it("returns error for malformed platform_config JSON", async () => {
    const badCourse = { ...mockCourse, platform_config: "not-json" };
    vi.mocked(getAdapter).mockReturnValue({
      platformId: "foreup",
      fetchTeeTimes: vi.fn(),
    });

    const result = await pollCourse(mockDb as any, badCourse, "2026-04-15");
    expect(result).toBe("error");
    expect(logPoll).toHaveBeenCalledWith(
      mockDb, "braemar", "2026-04-15", "error", 0, expect.any(String)
    );
  });
```

**Step 2: Add test for logPoll throwing on the success path (1.4 fully)**

```ts
  it("returns error when logPoll throws on success path", async () => {
    const mockAdapter = {
      platformId: "foreup",
      fetchTeeTimes: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getAdapter).mockReturnValue(mockAdapter);
    vi.mocked(upsertTeeTimes).mockResolvedValue(undefined);
    vi.mocked(logPoll).mockRejectedValueOnce(new Error("D1 write failed"));

    // This currently throws — after the Phase 2 fix it should still propagate
    // since only the catch-block logPoll is wrapped. The success-path logPoll
    // propagation is acceptable because the caller (cron-handler) catches it.
    await expect(pollCourse(mockDb as any, mockCourse, "2026-04-15")).rejects.toThrow("D1 write failed");
  });
```

Note: this test documents the current behavior. The success-path `logPoll` failure propagates up and is caught by the cron handler's per-date try/catch (from Phase 2). This is acceptable — data is already upserted, and the cron handler logs the error and moves to the next date.

**Step 3: Run tests**

Run: `npm test -- --reporter verbose src/lib/poller.test.ts`
Expected: PASS

### Task 26: Add JWT alg:none rejection test (9.5)

**Files:**
- Modify: `src/lib/auth.test.ts`

**Step 1: Add test**

In the `verifyJWT` describe block:

```ts
  it("rejects a JWT with alg: none", async () => {
    const { verifyJWT } = await import("./auth");
    // Construct a JWT with alg: "none" — base64url encode header and payload, empty signature
    const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" })).replace(/=/g, "");
    const payload = btoa(JSON.stringify({ userId: "u1", email: "a@b.com", exp: Math.floor(Date.now() / 1000) + 3600 })).replace(/=/g, "");
    const noneToken = `${header}.${payload}.`;

    const result = await verifyJWT(noneToken, secret);
    expect(result).toBeNull();
  });
```

**Step 2: Run test**

Run: `npm test -- --reporter verbose src/lib/auth.test.ts`
Expected: PASS (jose library rejects alg:none by default)

### Task 27: Commit Phase 6

Run: `npm test` — all tests pass
Run: `npx tsc --noEmit` — no type errors
Commit:
```
test: fill remaining coverage gaps from pitfalls review

- Adapter malformed JSON and 429 response tests (6.1, 6.2)
- pollCourse malformed platform_config test (3.2)
- pollCourse logPoll double-fault on success path test (1.4)
- JWT alg:none rejection test (9.5)
```

---

## Items Not Addressed (Deliberate)

These items from the review require architectural decisions or are out of scope for a test/fix remediation:

| Item | Reason deferred |
|------|-----------------|
| 3.3 Misconfigured vs inactive | Requires design decision: should we add a `config_status` field? Discuss with Sam. |
| 5.2 Overlapping cron executions | Requires Cloudflare Durable Objects or D1 advisory locks. Over-engineering for current scale. |
| 5.4 Worker timeout resilience | Requires checkpoint-resume architecture. Plan separately when approaching 80 courses. |
| 8.2 D1 batch partial failure | D1 batch is documented as transactional. Testing partial failure requires a real D1 instance. |
| 8.3 Cascade awareness | Convention-based (documented in CLAUDE.md). A linting test could enforce this but is low ROI. |
| 9.1 Rate limit bypass | Requires atomic SQL (INSERT...SELECT with subquery). Design separately. |
| 9.3 CSRF | SameSite=Lax cookies already protect authenticated endpoints. The refresh endpoint is unauthenticated and rate-limited. Discuss with Sam whether additional protection is needed. |
| 2.5 Client-server date agreement | Both use `America/Chicago`. A cross-layer test would be brittle. Implementation correctness is verified individually. |
| A3 Token rotation race | Intentional design tradeoff. Client-side retry would add complexity. The race window is narrow (<15 min JWT expiry × concurrent requests). |
| A4 Account deletion cookies | Functionally harmless; browser processes Set-Cookie headers in order. |
| A6 Session cleanup | Already exists — cron handler has `DELETE FROM sessions WHERE expires_at < datetime('now')`. |
| C1 Bunker Hills scheduleId | Known gap. Requires discovering the correct scheduleId from ForeUp. |
| F3 Hydration flicker | Intentional tradeoff for hydration safety. |
| F5 Stale share toast count | Edge case requiring user action during open dialog. Extremely unlikely. |
| C7 inactiveProbeCount | Minor reporting inaccuracy. Not worth code change. |
| 1.2/1.3 Page error states | Requires React component testing with JSDOM. These pages have complex client state. Plan as a dedicated effort. |
| 7.1/7.2 Route param change / unmount cleanup | Same — requires React integration testing. |
| 10.1 Whitespace-only strings | Low risk for this app's inputs (dates, course IDs). |
| 10.3 ID format validation | Course IDs are slugs matched against D1 data. Invalid IDs return 404 or empty results, not errors. |
