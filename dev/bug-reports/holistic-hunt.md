# Holistic Bug Hunt: Google OAuth System

Cross-cutting semantic analysis of the full OAuth + session + protected route system.

---

## Finding 1: `sendBeacon` booking-clicks will silently fail during token refresh

**Description:** `navigator.sendBeacon()` sends a fire-and-forget POST that includes cookies. If the user's JWT has expired (>15 min old), the `authenticateRequest` function will attempt to rotate tokens and return new Set-Cookie headers in the response. However, `sendBeacon` responses are discarded by the browser — the new cookies from token rotation are never applied. This means the booking-clicks endpoint returns 200 with new cookies, but the browser ignores them. The *next* request still has the expired JWT + old refresh token, which triggers *another* rotation. This isn't a functional failure (the click still gets recorded during the rotation), but it means every beacon call with an expired JWT wastes a token rotation (D1 delete + insert + user lookup) that gets thrown away. Worse: if the user has *no other requests in flight*, the rotated refresh token in D1 no longer matches the cookie, so the old refresh cookie is now orphaned — the *next* real request (e.g. toggling a favorite) will attempt rotation with the old refresh token, find no matching session in D1, and get logged out.

**Wait — let me re-examine.** The `sendBeacon` fires, server rotates the refresh token (deletes old session row, inserts new one), returns new cookies in response. Browser discards the response. The user's browser still has the **old** refresh token cookie. On the next real fetch (e.g., `/api/user/favorites`), `authenticateRequest` hashes the old refresh token, queries D1 for it — but it was already deleted by the beacon's rotation. Result: user gets 401 and is logged out.

**Files Involved:**
- `src/components/tee-time-list.tsx` (sendBeacon call)
- `src/lib/auth.ts` (`authenticateRequest` — token rotation deletes old session)
- `src/app/api/user/booking-clicks/route.ts`

**Severity:** High

**Evidence:** In `auth.ts:144-148`, the old session is deleted during rotation. `sendBeacon` discards the response (per spec), so the new refresh token cookie is never stored. The old cookie now points to a deleted session row. Next authenticated request = forced logout.

**Suggested Fix:** The booking-clicks route should skip token rotation. Options:
1. Create a lightweight auth check that only verifies the JWT without attempting refresh (return 401 if JWT expired, don't try rotation). The click is fire-and-forget anyway.
2. Accept that some clicks won't be tracked when the JWT is expired — this is analytics, not critical path.

---

## Finding 2: Logout test mocks `clearAuthCookies` — doesn't verify cookies are actually set

**Description:** The logout route test at `route.test.ts` mocks `@/lib/auth` and asserts `clearAuthCookies` *was called*, but because `clearAuthCookies` is mocked to a no-op, the test never verifies that the response actually contains `Set-Cookie` headers with `Max-Age=0`. The test is verifying that a mock function was called, not that the route actually clears cookies.

**Files Involved:**
- `src/app/api/auth/logout/route.test.ts` (mocks `clearAuthCookies`)
- `src/app/api/auth/logout/route.ts` (calls real `clearAuthCookies` which appends to `headers`, then does `headers.forEach` to copy to response)

**Severity:** Medium

**Evidence:** Line 14-17 of the test mock the entire `@/lib/auth` module. Since `clearAuthCookies` is mocked to `vi.fn()` (no-op), the `headers` object in the route handler never gets any Set-Cookie headers appended. The `headers.forEach` on line 26 of the route iterates over an empty Headers object. The test only checks `expect(clearAuthCookies).toHaveBeenCalled()` — it doesn't verify the response headers contain cookie-clearing directives. If someone broke the `headers.forEach` copy logic, this test would still pass.

**Suggested Fix:** Either:
- Don't mock `clearAuthCookies` and instead verify the actual response headers contain `Max-Age=0` for both cookies, OR
- Add an assertion that the response headers contain the expected Set-Cookie values.

---

## Finding 3: Account deletion test mocks `clearAuthCookies` — same issue as logout

**Description:** Same pattern as Finding 2. The account deletion test mocks `clearAuthCookies` as a no-op, so it never verifies cookies are actually cleared in the response.

**Files Involved:**
- `src/app/api/user/account/route.test.ts`
- `src/app/api/user/account/route.ts`

**Severity:** Medium

**Evidence:** Lines 14-17 mock `@/lib/auth`. The `clearAuthCookies` mock is a no-op. The test at line 55 only checks `expect(clearAuthCookies).toHaveBeenCalled()`, not that the response actually has cookie-clearing headers.

**Suggested Fix:** Same as Finding 2.

---

## Finding 4: Account deletion relies on CASCADE but CLAUDE.md says "Never hard-delete courses"

**Description:** The account deletion route (`DELETE /api/user/account`) does `DELETE FROM users WHERE id = ?`. The schema has `ON DELETE CASCADE` on `sessions`, `user_favorites`, `booking_clicks`, and `user_settings`. This is correct for *user* deletion (cascading user data is the desired behavior). However, the CLAUDE.md gotcha says "Never hard-delete courses: CASCADE on `user_favorites` and `booking_clicks` would destroy user data." This is a documentation/architecture note, not a bug in the auth system itself. The CASCADE setup is correct for user deletion.

**Files Involved:** N/A — not a bug, noting for completeness that I analyzed it and it's correct.

**Severity:** N/A (not a bug)

---

## Finding 5: Max session cleanup deletes only one session per login

**Description:** In the OAuth callback, when a user exceeds `MAX_SESSIONS` (10), the code deletes exactly one (the oldest) session. If somehow a user accumulated 15 sessions, each new login would only trim one, converging slowly. This is a minor design issue — in practice users won't accumulate more than 11 between logins.

**Files Involved:**
- `src/app/api/auth/google/callback/route.ts` (lines 130-144)

**Severity:** Low

**Evidence:** The DELETE uses `LIMIT 1`, so only one session is removed per login. If count is 15, after login it would be 15 (one added, one removed).

**Suggested Fix:** Change the LIMIT to delete `count - MAX_SESSIONS` oldest sessions, or use `DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)`.

---

## Finding 6: OAuth callback doesn't validate `code` parameter before using it

**Description:** On line 67 of the callback route, `request.nextUrl.searchParams.get("code")!` uses a non-null assertion. If Google redirects without a `code` parameter (and without an `error` parameter), this will pass `null` to `google.validateAuthorizationCode()`. Arctic would likely throw, which is caught by the try/catch on line 76, so it's not a crash — but the error message would be confusing (something about invalid code rather than "missing code parameter").

**Files Involved:**
- `src/app/api/auth/google/callback/route.ts` (line 67)

**Severity:** Low

**Evidence:** The `!` non-null assertion on `request.nextUrl.searchParams.get("code")` means TypeScript won't warn about null. If Google sends a callback without `code` or `error` (unlikely but possible with malicious requests), the code passes null to Arctic. The try/catch handles it, but no test covers this edge case.

**Suggested Fix:** Add an explicit null check for `code` before calling `validateAuthorizationCode`, returning an auth_failed redirect if missing.

---

## Finding 7: `setFavorites` in auth-provider passes objects but client expects `FavoriteEntry[]`

**Description:** This is actually correct — just verifying. In `auth-provider.tsx` line 68-73, after merge, it fetches server favorites and calls `setFavorites(favorites.map(f => ({ id: f.courseId, name: f.courseName })))`. The `setFavorites` from `@/lib/favorites` accepts `FavoriteEntry[]` which is `{id: string, name: string}[]`. This matches. No bug here.

**Files Involved:** N/A — verified correct.

**Severity:** N/A (not a bug)

---

## Finding 8: Cron handler's expired session cleanup uses `datetime('now')` without timezone

**Description:** SQLite's `datetime('now')` returns UTC. The `sessions.expires_at` values are set via `new Date().toISOString()` which is also UTC. This is consistent, so no actual bug. Verified correct.

**Files Involved:** N/A — verified correct.

**Severity:** N/A (not a bug)

---

## Summary

| # | Finding | Severity |
|---|---------|----------|
| 1 | `sendBeacon` token rotation causes silent logout | High |
| 2 | Logout test mocks `clearAuthCookies`, doesn't verify response cookies | Medium |
| 3 | Account deletion test same mock-verification issue | Medium |
| 5 | Max session cleanup only trims one session per login | Low |
| 6 | OAuth callback uses `!` on `code` param without null check | Low |
