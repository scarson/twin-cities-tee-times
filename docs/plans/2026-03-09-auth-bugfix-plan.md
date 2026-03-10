# Auth Bug Hunt Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 8 bugs found by three parallel bug hunters analyzing the Google OAuth implementation.

**Architecture:** Targeted changes to existing auth files. Two HIGH-severity issues (sendBeacon causing silent logout, token rotation race condition) require changes to auth core. The remaining 6 are isolated fixes. No new files created.

**Tech Stack:** TypeScript, Next.js App Router, Cloudflare D1 (SQLite), jose (JWT), vitest

---

## Subagent Execution Notes

**Sequential execution:** Tasks 1-8, then Task 9 for final verification. Tasks 1 and 2 modify auth core and should be done first. Tasks 3-8 are independent of each other but some touch files modified by Tasks 1-2 (specifically, Task 7 modifies `auth-provider.tsx` which Task 3 also modifies). Execute Task 3 before Task 7 to avoid conflicts.

**Recommended order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

**Content matching:** All edits use exact string matching (find/replace), NOT line numbers. Line numbers may drift after earlier tasks modify shared files.

**Mocking convention:** Tests mock `@opennextjs/cloudflare` for `getCloudflareContext`. Route tests mock `@/lib/auth` functions. The shared D1 mock is at `src/test/d1-mock.ts` and exposes `{ db, statement, mockFirst, mockAll, mockRun }`.

**ABOUTME comments:** All files already have ABOUTME. Only update ABOUTME if the file's purpose changes.

**Cookie names:** `tct-session` (JWT, 15-min Max-Age), `tct-refresh` (refresh token, 90-day), `tct-oauth-state`, `tct-oauth-verifier`.

**CRITICAL test rule:** Test output must be pristine. Any test that intentionally triggers `console.error` MUST capture it with `vi.spyOn(console, "error").mockImplementation(() => {})` and assert it was called.

---

### Task 1: Fix sendBeacon booking-clicks causing silent logout

**Bug:** `navigator.sendBeacon` fires POST to `/api/user/booking-clicks` with cookies. If the JWT is expired (>15 min), `authenticateRequest` rotates the refresh token — deletes old session from D1, creates new one, returns new cookies in response. But `sendBeacon` discards the response per browser spec, so the new cookies are never stored. The browser's old refresh token now points to a deleted D1 session. Next authenticated request → forced logout.

**Fix:** Replace `authenticateRequest` with `verifyJWT` in the booking-clicks route. If the JWT is valid, record the click. If expired/invalid, silently return 200 (analytics isn't critical). This avoids token rotation entirely.

**Files:**
- Modify: `src/app/api/user/booking-clicks/route.ts`
- Modify: `src/app/api/user/booking-clicks/route.test.ts`

**Step 1: Replace the entire test file `src/app/api/user/booking-clicks/route.test.ts`**

Key changes from old tests: (a) mock `verifyJWT` instead of `authenticateRequest`, (b) add test verifying expired JWT silently returns 200 without recording, (c) add test verifying no Set-Cookie headers are ever set (no rotation), (d) add test for missing session cookie.

```typescript
// ABOUTME: Tests for POST /api/user/booking-clicks route.
// ABOUTME: Verifies click tracking, idempotency, validation, and JWT-only auth (no rotation).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createMockD1, createMockEnv } from "@/test/d1-mock";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyJWT } from "@/lib/auth";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  verifyJWT: vi.fn(),
}));

describe("POST /api/user/booking-clicks", () => {
  let db: ReturnType<typeof createMockD1>["db"];
  let mockRun: ReturnType<typeof createMockD1>["mockRun"];

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockD1();
    db = mock.db;
    mockRun = mock.mockRun;
    const env = createMockEnv(db);
    vi.mocked(getCloudflareContext).mockResolvedValue({
      env,
      ctx: {},
    } as any);
  });

  function authedUser() {
    vi.mocked(verifyJWT).mockResolvedValue({
      userId: "user-1",
      email: "test@example.com",
    });
  }

  function makeRequest(body: unknown, cookies: Record<string, string> = { "tct-session": "valid-jwt" }) {
    const req = new NextRequest(
      "https://example.com/api/user/booking-clicks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    for (const [name, value] of Object.entries(cookies)) {
      req.cookies.set(name, value);
    }
    return req;
  }

  it("records a booking click when JWT is valid", async () => {
    authedUser();
    mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 1 } });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ courseId: "course-1", date: "2026-03-15", time: "08:30" })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT OR IGNORE INTO booking_clicks")
    );
  });

  it("handles duplicate click idempotently", async () => {
    authedUser();
    mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 0 } });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ courseId: "course-1", date: "2026-03-15", time: "08:30" })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });

  it("returns 400 when courseId is missing", async () => {
    authedUser();

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ date: "2026-03-15", time: "08:30" })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "Missing required fields" });
  });

  it("returns 400 when date is missing", async () => {
    authedUser();

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ courseId: "course-1", time: "08:30" })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "Missing required fields" });
  });

  it("returns 400 when time is missing", async () => {
    authedUser();

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ courseId: "course-1", date: "2026-03-15" })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "Missing required fields" });
  });

  it("silently returns 200 without recording when JWT is expired", async () => {
    vi.mocked(verifyJWT).mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ courseId: "course-1", date: "2026-03-15", time: "08:30" })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });

    // Must NOT have attempted any D1 writes
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("silently returns 200 when no session cookie exists", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      makeRequest(
        { courseId: "course-1", date: "2026-03-15", time: "08:30" },
        {} // no cookies
      )
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
    // verifyJWT should not even be called when no cookie exists
    expect(verifyJWT).not.toHaveBeenCalled();
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("never sets Set-Cookie headers (no token rotation)", async () => {
    authedUser();
    mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 1 } });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ courseId: "course-1", date: "2026-03-15", time: "08:30" })
    );

    expect(response.headers.has("Set-Cookie")).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/user/booking-clicks/route.test.ts`
Expected: FAIL — the route still imports `authenticateRequest`, not `verifyJWT`.

**Step 3: Replace the entire route file `src/app/api/user/booking-clicks/route.ts`**

```typescript
// ABOUTME: POST /api/user/booking-clicks — tracks when a user clicks a booking link.
// ABOUTME: Uses JWT-only auth (no token rotation) because sendBeacon discards responses.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyJWT } from "@/lib/auth";

const COOKIE_SESSION = "tct-session";

export async function POST(request: NextRequest) {
  const { env } = await getCloudflareContext();
  const db = env.DB;

  const sessionCookie = request.cookies.get(COOKIE_SESSION)?.value;
  if (!sessionCookie) {
    return NextResponse.json({ ok: true });
  }

  const user = await verifyJWT(sessionCookie, env.JWT_SECRET);
  if (!user) {
    return NextResponse.json({ ok: true });
  }

  try {
    const { courseId, date, time } = (await request.json()) as {
      courseId?: string;
      date?: string;
      time?: string;
    };

    if (!courseId || !date || !time) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    await db
      .prepare(
        `INSERT OR IGNORE INTO booking_clicks (user_id, course_id, date, time, clicked_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(user.userId, courseId, date, time, new Date().toISOString())
      .run();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/user/booking-clicks:", err);
    return NextResponse.json({ ok: true });
  }
}
```

Key differences from old code:
- Imports `verifyJWT` instead of `authenticateRequest`
- Reads `tct-session` cookie directly (the constant is defined locally — do NOT import it from auth.ts since it's not exported)
- If no cookie or JWT invalid/expired: returns 200 silently (no D1 interaction, no token rotation)
- No `headers` merging needed (no rotation = no Set-Cookie)
- Error catch returns 200 (fire-and-forget analytics)

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/user/booking-clicks/route.test.ts`
Expected: All 8 tests PASS.

**Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/app/api/user/booking-clicks/route.ts src/app/api/user/booking-clicks/route.test.ts
git commit -m "fix: use JWT-only auth for booking-clicks to prevent sendBeacon logout"
```

---

### Task 2: Fix token rotation race condition with atomic DELETE RETURNING

**Bug:** Two concurrent requests with an expired JWT both read the same session row via SELECT, both attempt rotation. If request A deletes the session before B's SELECT, B finds no session, clears cookies, and logs the user out — even though A successfully rotated and set new cookies.

**Fix:** Replace the SELECT + DELETE sequence with atomic `DELETE FROM sessions WHERE token_hash = ? RETURNING *`. Only one concurrent request can claim the row. If no row returned (already claimed by another request), return `user: null` with empty headers (do NOT clear cookies — the winning request already set new ones).

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `src/lib/auth.test.ts`

**Step 1: Verify D1 supports DELETE RETURNING locally**

Run:
```bash
npx wrangler d1 execute tee-times-db --local --command="CREATE TABLE IF NOT EXISTS _test_returning (id TEXT PRIMARY KEY, val TEXT); INSERT OR REPLACE INTO _test_returning VALUES ('a', 'hello'); DELETE FROM _test_returning WHERE id = 'a' RETURNING *;"
```

Expected: Output includes a row `{ id: 'a', val: 'hello' }`. If this fails, STOP and report — do not proceed.

Clean up:
```bash
npx wrangler d1 execute tee-times-db --local --command="DROP TABLE IF EXISTS _test_returning;"
```

**Step 2: Add the new test for "session already claimed (race condition)"**

In `src/lib/auth.test.ts`, inside the `describe("authenticateRequest", ...)` block, add this test AFTER the last existing test (the one starting with `it("returns null for malformed session cookie"`):

```typescript
  it("returns null without clearing cookies when session was already claimed (race condition)", async () => {
    const { createJWT, authenticateRequest } = await import("./auth");
    const { db, mockFirst } = createMockD1();

    vi.useFakeTimers();
    const jwt = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    vi.advanceTimersByTime(16 * 60 * 1000); // expire the JWT

    // DELETE RETURNING returns null — session was already claimed by another request
    mockFirst.mockResolvedValueOnce(null);

    const req = makeRequest({
      "tct-session": jwt,
      "tct-refresh": "claimed-refresh-token",
    });

    const result = await authenticateRequest(req, db, secret);
    expect(result.user).toBeNull();

    // CRITICAL: must NOT clear cookies — the winning request already set new ones
    expect(result.headers.has("Set-Cookie")).toBe(false);

    vi.useRealTimers();
  });
```

**Step 3: Run to verify the new test fails**

Run: `npx vitest run src/lib/auth.test.ts`
Expected: The new test FAILS because current code calls `clearAuthCookies` when session isn't found.

**Step 4: Update authenticateRequest in `src/lib/auth.ts`**

Find this exact block (the entire refresh/rotation section, from "JWT invalid/expired" through "Delete old session"):

```typescript
  // JWT invalid/expired — try refresh
  if (!refreshCookie) {
    clearAuthCookies(headers, isSecure);
    return { user: null, headers };
  }

  const tokenHash = await sha256(refreshCookie);
  const session = await db
    .prepare("SELECT * FROM sessions WHERE token_hash = ?")
    .bind(tokenHash)
    .first<SessionRow>();

  if (!session || new Date(session.expires_at) < new Date()) {
    // Refresh token not found or expired — clean up
    if (session) {
      await db
        .prepare("DELETE FROM sessions WHERE token_hash = ?")
        .bind(tokenHash)
        .run();
    }
    clearAuthCookies(headers, isSecure);
    return { user: null, headers };
  }

  // Refresh token valid — rotate tokens
  const userId = session.user_id;
  const userRow = await db
    .prepare("SELECT email FROM users WHERE id = ?")
    .bind(userId)
    .first<{ email: string }>();

  if (!userRow) {
    // User was deleted — clean up session
    await db
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .run();
    clearAuthCookies(headers, isSecure);
    return { user: null, headers };
  }

  // Delete old session
  await db
    .prepare("DELETE FROM sessions WHERE token_hash = ?")
    .bind(tokenHash)
    .run();
```

Replace with:

```typescript
  // JWT invalid/expired — try refresh
  if (!refreshCookie) {
    clearAuthCookies(headers, isSecure);
    return { user: null, headers };
  }

  const tokenHash = await sha256(refreshCookie);

  // Atomically claim the session — only one concurrent request can succeed.
  // DELETE RETURNING prevents race conditions where two requests both try to rotate.
  const claimed = await db
    .prepare("DELETE FROM sessions WHERE token_hash = ? RETURNING user_id, expires_at")
    .bind(tokenHash)
    .first<{ user_id: string; expires_at: string }>();

  if (!claimed) {
    // Session not found — either already claimed by a concurrent request,
    // or the token was never valid. Don't clear cookies: if another request
    // just rotated successfully, it already set new cookies.
    return { user: null, headers };
  }

  if (new Date(claimed.expires_at) < new Date()) {
    // Session was expired — already deleted above. Clear cookies.
    clearAuthCookies(headers, isSecure);
    return { user: null, headers };
  }

  // Refresh token valid — rotate tokens
  const userId = claimed.user_id;
  const userRow = await db
    .prepare("SELECT email FROM users WHERE id = ?")
    .bind(userId)
    .first<{ email: string }>();

  if (!userRow) {
    // User was deleted — session already deleted above. Clear cookies.
    clearAuthCookies(headers, isSecure);
    return { user: null, headers };
  }
```

The rest of the function (from `// Create new session` through the end) stays unchanged.

Also remove the now-unused `SessionRow` import. Find:
```typescript
import type { SessionRow } from "@/types";
```
This type is no longer used since we replaced `first<SessionRow>()` with `first<{ user_id: string; expires_at: string }>()`. Remove the import line entirely.

**Step 5: Run tests**

Run: `npx vitest run src/lib/auth.test.ts`
Expected: All tests pass including the new race condition test. The existing tests still work because:
- "rotates tokens" test: mockFirst returns `{ user_id, expires_at, ... }` — the extra fields are harmless
- "expired refresh" test: mockFirst returns the expired session — the code now checks expiry after DELETE RETURNING

**Step 6: Run full test suite + type-check**

Run: `npm test && npx tsc --noEmit`
Expected: All pass, no type errors.

**Step 7: Commit**

```bash
git add src/lib/auth.ts src/lib/auth.test.ts
git commit -m "fix: atomic DELETE RETURNING for token rotation to prevent race condition"
```

---

### Task 3: Fix post-login favorites merge race with useFavorites

**Bug:** After login (`justSignedIn=true`), both AuthProvider's merge flow and `useFavorites` hook independently fetch server favorites. The hook can resolve before merge completes, showing stale (pre-merge) data. The hook only fires once when `isLoggedIn` transitions to true, so it never refetches after merge.

**Fix:** Add a `favoritesVersion` counter to AuthContext. Increment after merge completes (or immediately for returning users without merge). `useFavorites` depends on this counter for its server fetch, so it refetches after merge.

**Files:**
- Modify: `src/components/auth-provider.tsx`
- Modify: `src/hooks/use-favorites.ts`

**Step 1: Add favoritesVersion to AuthContextValue interface**

In `src/components/auth-provider.tsx`, find:

```typescript
interface AuthContextValue {
  user: User | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  showToast: (message: string) => void;
}
```

Replace with:

```typescript
interface AuthContextValue {
  user: User | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  favoritesVersion: number;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  showToast: (message: string) => void;
}
```

**Step 2: Add favoritesVersion state**

Find:

```typescript
  const [toastMessage, setToastMessage] = useState<string | null>(null);
```

Replace with:

```typescript
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [favoritesVersion, setFavoritesVersion] = useState(0);
```

**Step 3: Increment favoritesVersion after merge (justSignedIn path)**

Find the URL cleanup block inside the `if (params.get("justSignedIn") === "true")` section:

```typescript
          const url = new URL(window.location.href);
          url.searchParams.delete("justSignedIn");
          history.replaceState({}, "", url.pathname + url.search);
```

Replace with:

```typescript
          setFavoritesVersion((v) => v + 1);
          const url = new URL(window.location.href);
          url.searchParams.delete("justSignedIn");
          history.replaceState({}, "", url.pathname + url.search);
```

**Step 4: Increment favoritesVersion for returning users (no justSignedIn)**

The `if (params.get("justSignedIn") === "true") { ... }` block needs an else branch for returning users. After Step 3 ran, the end of the justSignedIn block looks like this. Find this exact text:

```typescript
          history.replaceState({}, "", url.pathname + url.search);
        }
      } catch {
```

Replace with:

```typescript
          history.replaceState({}, "", url.pathname + url.search);
        } else {
          setFavoritesVersion((v) => v + 1);
        }
      } catch {
```

**Step 5: Add favoritesVersion to context value**

Find:

```typescript
  const contextValue: AuthContextValue = {
    user,
    isLoggedIn: user !== null,
    isLoading,
    signOut,
    deleteAccount,
    showToast,
  };
```

Replace with:

```typescript
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

**Step 6: Update useFavorites to depend on favoritesVersion**

In `src/hooks/use-favorites.ts`, find:

```typescript
  const { isLoggedIn, showToast } = useAuth();
```

Replace with:

```typescript
  const { isLoggedIn, favoritesVersion, showToast } = useAuth();
```

Then find the dependency array of the server-fetch useEffect:

```typescript
  }, [isLoggedIn]);
```

Replace with:

```typescript
  }, [isLoggedIn, favoritesVersion]);
```

**Step 7: Run tests + type-check**

Run: `npm test && npx tsc --noEmit`
Expected: All pass. Existing tests don't test the merge-then-fetch flow, so they're unaffected.

**Step 8: Commit**

```bash
git add src/components/auth-provider.tsx src/hooks/use-favorites.ts
git commit -m "fix: coordinate favorites fetch with post-login merge via version counter"
```

---

### Task 4: Add size limit to merge endpoint courseIds array

**Bug:** The merge endpoint accepts an unbounded `courseIds` array, executing 2 D1 queries per item. A client could send thousands of IDs causing a D1 query storm.

**Fix:** Cap at 100 entries (the app has ~80 courses total).

**Files:**
- Modify: `src/app/api/user/favorites/merge/route.ts`
- Modify: `src/app/api/user/favorites/merge/route.test.ts`

**Step 1: Add the failing test**

In `src/app/api/user/favorites/merge/route.test.ts`, add this test inside the existing describe block, after the last test:

```typescript
  it("returns 400 when courseIds exceeds 100 entries", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: { userId: "user-1", email: "test@example.com" },
      headers: new Headers(),
    });

    const { POST } = await import("./route");
    const courseIds = Array.from({ length: 101 }, (_, i) => `course-${i}`);
    const request = new NextRequest(
      "https://example.com/api/user/favorites/merge",
      {
        method: "POST",
        body: JSON.stringify({ courseIds }),
      }
    );
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "courseIds exceeds maximum of 100" });
  });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/user/favorites/merge/route.test.ts`
Expected: FAIL — no size check exists.

**Step 3: Add the size limit**

In `src/app/api/user/favorites/merge/route.ts`, find the end of the Array.isArray validation block:

```typescript
    if (!Array.isArray(courseIds)) {
      const response = NextResponse.json(
        { error: "courseIds must be an array" },
        { status: 400 }
      );
      headers.forEach((value, key) => response.headers.append(key, value));
      return response;
    }
```

Add immediately after (before the "Count existing favorites" comment):

```typescript

    if (courseIds.length > 100) {
      const response = NextResponse.json(
        { error: "courseIds exceeds maximum of 100" },
        { status: 400 }
      );
      headers.forEach((value, key) => response.headers.append(key, value));
      return response;
    }
```

**Step 4: Run tests**

Run: `npx vitest run src/app/api/user/favorites/merge/route.test.ts`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/app/api/user/favorites/merge/route.ts src/app/api/user/favorites/merge/route.test.ts
git commit -m "fix: cap merge endpoint courseIds at 100 to prevent D1 query storm"
```

---

### Task 5: Fix tests that mock clearAuthCookies instead of verifying response cookies

**Bug:** Logout and account deletion tests mock `clearAuthCookies` as a no-op and only assert it was called. They never verify the response actually contains `Set-Cookie: Max-Age=0` headers.

**Fix:** For logout test: stop mocking `@/lib/auth` entirely — `sha256` and `clearAuthCookies` are pure functions that work in tests. For account deletion test: partial mock (mock `authenticateRequest`, use real `clearAuthCookies`). Both tests verify actual Set-Cookie headers.

**Files:**
- Modify: `src/app/api/auth/logout/route.test.ts`
- Modify: `src/app/api/user/account/route.test.ts`

**Step 1: Replace the entire logout test file `src/app/api/auth/logout/route.test.ts`**

```typescript
// ABOUTME: Tests for POST /api/auth/logout route.
// ABOUTME: Verifies session deletion, actual cookie clearing in response, and always-200 behavior.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createMockD1, createMockEnv } from "@/test/d1-mock";
import { getCloudflareContext } from "@opennextjs/cloudflare";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

// No mock of @/lib/auth — using real sha256 and clearAuthCookies

describe("POST /api/auth/logout", () => {
  let db: ReturnType<typeof createMockD1>["db"];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    const mock = createMockD1();
    db = mock.db;
    const env = createMockEnv(db);
    vi.mocked(getCloudflareContext).mockResolvedValue({
      env,
      ctx: {},
    } as any);
  });

  it("deletes session, sets Max-Age=0 cookies, and returns 200", async () => {
    const { POST } = await import("./route");
    const request = new NextRequest("https://example.com/api/auth/logout", {
      method: "POST",
    });
    request.cookies.set("tct-refresh", "some-refresh-token");

    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });

    // Verify D1 delete was called
    expect(db.prepare).toHaveBeenCalledWith(
      "DELETE FROM sessions WHERE token_hash = ?"
    );

    // Verify actual response headers contain cookie-clearing directives
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.includes("tct-session=") && c.includes("Max-Age=0"))).toBe(true);
    expect(cookies.some((c) => c.includes("tct-refresh=") && c.includes("Max-Age=0"))).toBe(true);
  });

  it("clears cookies and returns 200 even with no auth cookies", async () => {
    const { POST } = await import("./route");
    const request = new NextRequest("https://example.com/api/auth/logout", {
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });

    // Should NOT have tried to delete any session
    expect(db.prepare).not.toHaveBeenCalled();

    // Should still clear cookies in response
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.includes("tct-session=") && c.includes("Max-Age=0"))).toBe(true);
    expect(cookies.some((c) => c.includes("tct-refresh=") && c.includes("Max-Age=0"))).toBe(true);
  });
});
```

**Step 2: Replace the entire account deletion test file `src/app/api/user/account/route.test.ts`**

```typescript
// ABOUTME: Tests for DELETE /api/user/account route.
// ABOUTME: Verifies user deletion, actual cookie clearing in response, and unauthorized responses.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createMockD1, createMockEnv } from "@/test/d1-mock";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateRequest } from "@/lib/auth";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

// Partial mock: mock authenticateRequest only, use real clearAuthCookies
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    authenticateRequest: vi.fn(),
  };
});

describe("DELETE /api/user/account", () => {
  let db: ReturnType<typeof createMockD1>["db"];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    const mock = createMockD1();
    db = mock.db;
    const env = createMockEnv(db);
    vi.mocked(getCloudflareContext).mockResolvedValue({
      env,
      ctx: {},
    } as any);
  });

  it("deletes user and sets Max-Age=0 cookies in response", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: { userId: "user-1", email: "test@example.com" },
      headers: new Headers(),
    });

    const { DELETE } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/account",
      { method: "DELETE" }
    );
    const response = await DELETE(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, clearLocalStorage: true });

    // Verify D1 delete was called
    expect(db.prepare).toHaveBeenCalledWith(
      "DELETE FROM users WHERE id = ?"
    );

    // Verify actual response contains cookie-clearing headers
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.includes("tct-session=") && c.includes("Max-Age=0"))).toBe(true);
    expect(cookies.some((c) => c.includes("tct-refresh=") && c.includes("Max-Age=0"))).toBe(true);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: null,
      headers: new Headers(),
    });

    const { DELETE } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/account",
      { method: "DELETE" }
    );
    const response = await DELETE(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("merges auth headers (e.g., rotated cookies) into response", async () => {
    const authHeaders = new Headers();
    authHeaders.append("Set-Cookie", "tct-session=new-jwt; Max-Age=900");
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: { userId: "user-1", email: "test@example.com" },
      headers: authHeaders,
    });

    const { DELETE } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/user/account",
      { method: "DELETE" }
    );
    const response = await DELETE(request);

    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    // Should contain both the auth rotation cookie AND the clearing cookies
    expect(cookies.some((c) => c.includes("tct-session=new-jwt"))).toBe(true);
    expect(cookies.some((c) => c.includes("Max-Age=0"))).toBe(true);
  });
});
```

**Step 3: Run tests**

Run: `npx vitest run src/app/api/auth/logout/route.test.ts src/app/api/user/account/route.test.ts`
Expected: All tests pass.

**Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/app/api/auth/logout/route.test.ts src/app/api/user/account/route.test.ts
git commit -m "fix: verify actual response cookies in logout and account deletion tests"
```

---

### Task 6: Add null check for OAuth callback code parameter

**Bug:** Line 67: `request.nextUrl.searchParams.get("code")!` uses non-null assertion but `code` can be absent in crafted URLs. The try/catch catches the resulting Arctic error, but the `!` masks the issue.

**Fix:** Explicit null check before the try block.

**Files:**
- Modify: `src/app/api/auth/google/callback/route.ts`
- Modify: `src/app/api/auth/google/callback/route.test.ts`

**Step 1: Add the failing test**

In `src/app/api/auth/google/callback/route.test.ts`, add this test inside the existing describe block:

```typescript
  it("redirects with error when code param is missing (no error param either)", async () => {
    const { GET } = await import("./route");

    const state = "no-code-state";
    const request = makeCallbackRequest(
      { state }, // no code, no error
      {
        "tct-oauth-state": makeStateCookie(state, "/"),
        "tct-oauth-verifier": "test-verifier",
      }
    );

    const response = await GET(request);

    expect([302, 307]).toContain(response.status);
    const location = response.headers.get("location")!;
    expect(new URL(location).searchParams.get("error")).toBe("auth_failed");
  });
```

**Step 2: Run test**

Run: `npx vitest run src/app/api/auth/google/callback/route.test.ts`
Expected: The test may pass (caught by existing try/catch) or fail. Either way, proceed with the code fix.

**Step 3: Fix the code**

In `src/app/api/auth/google/callback/route.ts`, find:

```typescript
  // Exchange auth code for tokens
  const code = request.nextUrl.searchParams.get("code")!;
```

Replace with:

```typescript
  // Exchange auth code for tokens
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    const redirectUrl = new URL(returnTo, request.url);
    redirectUrl.searchParams.set("error", "auth_failed");
    return NextResponse.redirect(redirectUrl);
  }
```

**Step 4: Run tests**

Run: `npx vitest run src/app/api/auth/google/callback/route.test.ts`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/app/api/auth/google/callback/route.ts src/app/api/auth/google/callback/route.test.ts
git commit -m "fix: explicit null check for OAuth callback code parameter"
```

---

### Task 7: Show toast on favorites merge failure

**Bug:** If POST to `/api/user/favorites/merge` fails after login, the code silently continues. `justSignedIn` is removed from URL so merge is never retried. On next page load, `useFavorites` fetches from server (without merged favorites) and overwrites localStorage.

**Fix:** Show a toast when merge fails.

**Files:**
- Modify: `src/components/auth-provider.tsx`

**NOTE:** This task modifies the same file as Task 3. Execute Task 3 first. The edits below target code that Task 3 does NOT modify (the merge success/failure handling), so there is no conflict as long as Task 3 runs first.

**Step 1: Add else branch for merge failure**

In `src/components/auth-provider.tsx`, inside the `if (localFavorites.length > 0)` block, find the closing of the `if (mergeRes.ok)` block. It currently looks like:

```typescript
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
            }
```

Replace with:

```typescript
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
```

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add src/components/auth-provider.tsx
git commit -m "fix: show toast when post-login favorites merge fails"
```

---

### Task 8: Fix max-sessions enforcement to delete all excess sessions

**Bug:** Max-sessions check deletes only the oldest 1 session via `LIMIT 1`, even if count exceeds MAX_SESSIONS by more than 1.

**Fix:** Delete all excess sessions in one query using parameterized LIMIT.

**Files:**
- Modify: `src/app/api/auth/google/callback/route.ts`
- Modify: `src/app/api/auth/google/callback/route.test.ts`

**Step 1: Update the test**

In `src/app/api/auth/google/callback/route.test.ts`, find the test "deletes oldest session when user exceeds 10 sessions". Find its assertion:

```typescript
    expect(
      prepareCalls.some(
        (sql: string) =>
          sql.includes("DELETE FROM sessions") &&
          sql.includes("ORDER BY created_at ASC LIMIT 1")
      )
    ).toBe(true);
```

Replace with:

```typescript
    expect(
      prepareCalls.some(
        (sql: string) =>
          sql.includes("DELETE FROM sessions") &&
          sql.includes("ORDER BY created_at ASC LIMIT ?")
      )
    ).toBe(true);
```

**Step 2: Update the callback route**

In `src/app/api/auth/google/callback/route.ts`, find:

```typescript
    // Enforce max sessions per user
    const countRow = await db
      .prepare("SELECT COUNT(*) as count FROM sessions WHERE user_id = ?")
      .bind(actualUserId)
      .first<{ count: number }>();

    if (countRow && countRow.count > MAX_SESSIONS) {
      await db
        .prepare(
          "DELETE FROM sessions WHERE token_hash = " +
            "(SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at ASC LIMIT 1)"
        )
        .bind(actualUserId)
        .run();
    }
```

Replace with:

```typescript
    // Enforce max sessions per user — delete all excess, not just one
    const countRow = await db
      .prepare("SELECT COUNT(*) as count FROM sessions WHERE user_id = ?")
      .bind(actualUserId)
      .first<{ count: number }>();

    const excess = (countRow?.count ?? 0) - MAX_SESSIONS;
    if (excess > 0) {
      await db
        .prepare(
          "DELETE FROM sessions WHERE token_hash IN " +
            "(SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at ASC LIMIT ?)"
        )
        .bind(actualUserId, excess)
        .run();
    }
```

**Step 3: Run tests**

Run: `npx vitest run src/app/api/auth/google/callback/route.test.ts`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/app/api/auth/google/callback/route.ts src/app/api/auth/google/callback/route.test.ts
git commit -m "fix: delete all excess sessions instead of just one per login"
```

---

### Task 9: Final verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass (should be ~170+ tests).

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Lint**

Run: `npm run lint`
Expected: No errors.

**Step 4: Commit bug reports**

```bash
git add dev/bug-reports/
git commit -m "docs: add auth bug hunt analysis reports"
```
