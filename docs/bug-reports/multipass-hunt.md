# Multi-Pass Bug Hunt: Google OAuth System

Scope: Google OAuth 2.0 (Arctic) + JWT sessions (jose, HS256) in Next.js on Cloudflare Workers with D1.

---

## Pass 1: Contract Violations

### 1.1 `sendBeacon` Booking Clicks Bypass Auth

- **Description**: `tee-time-list.tsx` uses `navigator.sendBeacon()` to POST to `/api/user/booking-clicks`. `sendBeacon` sends a `text/plain` Content-Type by default (when using `Blob` with `type: "application/json"`). However, the route handler calls `await request.json()`, which *should* still parse correctly because the body is valid JSON and `request.json()` in the Fetch API parses regardless of Content-Type. More critically: `sendBeacon` does **not** include cookies in all browser contexts (partitioned storage, cross-site iframes). But for same-origin requests this is fine. **On review, this is not a real bug** — `sendBeacon` sends cookies for same-origin.

  **Verdict**: Not a bug. Withdrawing.

### 1.2 `auth-provider.tsx` Calls `setFavorites` with `{id, name}[]` — Correct Contract

- **Description**: After merge, `auth-provider.tsx` line 68 calls `setFavorites(favorites.map(f => ({ id: f.courseId, name: f.courseName })))`. The `setFavorites` function in `favorites.ts` accepts `FavoriteEntry[]` which is `{id, name}[]`. This matches correctly.

  **Verdict**: Not a bug.

*No contract violations found in this pass.*

---

## Pass 2: Pattern Deviations

### 2.1 Logout Route Does Not Propagate `clearAuthCookies` Headers to Response

- **Description**: In `src/app/api/auth/logout/route.ts`, `clearAuthCookies(headers, isSecure)` appends `Set-Cookie` headers to a local `Headers` object. The code then does `headers.forEach((value, key) => response.headers.append(key, value))` to merge them into the response. This pattern is correct and used consistently across all routes.

  **Verdict**: Not a bug. Pattern is consistent.

*No pattern deviations found that constitute bugs.*

---

## Pass 3: Failure Modes

### 3.1 OAuth Callback: Null `code` Parameter Causes Unhandled Error

- **File/Line**: `src/app/api/auth/google/callback/route.ts`, line 67
- **Severity**: Medium
- **Description**: When no `error` parameter is present but `code` is also absent (e.g., a crafted URL like `/api/auth/google/callback?state=valid-state`), the route uses `request.nextUrl.searchParams.get("code")!` with a non-null assertion. This passes `null` to `google.validateAuthorizationCode()`, which will throw. The `catch` on line 78 catches this and redirects to `returnTo?error=auth_failed`, so it **does** gracefully degrade. However, the non-null assertion (`!`) is misleading — it signals "this is guaranteed non-null" when it isn't.
- **Evidence**: Line 67: `const code = request.nextUrl.searchParams.get("code")!;` — the `!` asserts non-null but `code` can be `null` if the query param is missing.
- **Suggested Fix**: Remove the `!` assertion. The existing try/catch handles the error, so this is a code quality issue rather than a runtime failure, but the `!` masks what's actually happening. Could add an explicit null check before the try block for clarity.

### 3.2 Account Deletion: Token Rotation Headers May Contain Freshly-Rotated Cookies That Get Immediately Invalidated

- **File/Line**: `src/app/api/user/account/route.ts`, lines 12-24
- **Severity**: Low
- **Description**: If a user's JWT is expired during the `DELETE /api/user/account` request, `authenticateRequest` will rotate the tokens (creating a new session in D1 and returning `Set-Cookie` headers for the new JWT + refresh token). Then the route immediately deletes the user (which CASCADE-deletes all sessions). Finally, `clearAuthCookies` appends clearing cookies to the same `headers` object. The response will contain **both** the rotation cookies (setting new values) **and** the clearing cookies (Max-Age=0). The browser processes Set-Cookie headers in order, so the final state should be cleared cookies. However, D1 now contains an orphaned session row that was just created during rotation but then CASCADE-deleted. This is wasteful but not harmful.
- **Evidence**: The sequence is: `authenticateRequest` (may insert new session) -> `DELETE FROM users` (CASCADE deletes that session) -> `clearAuthCookies`. The work done in rotation is immediately undone.
- **Suggested Fix**: This is a benign race — the end result is correct (user deleted, cookies cleared). No fix needed unless the wasted D1 write is a concern.

### 3.3 Merge Route: Unbounded `courseIds` Array Could Cause N+1 Query Storm

- **File/Line**: `src/app/api/user/favorites/merge/route.ts`, lines 39-53
- **Severity**: Medium
- **Description**: The merge endpoint accepts an array of `courseIds` with no size limit. For each courseId, it executes a `SELECT` query and then an `INSERT OR IGNORE` query — that's 2 D1 round-trips per course. A malicious or buggy client could send thousands of IDs, causing a D1 query storm. D1 has a 1000 sub-query limit per batch, and each individual query counts against the per-request quota in Workers.
- **Evidence**: Line 39: `for (const courseId of courseIds)` with no bounds check. Each iteration does 1-2 D1 queries.
- **Suggested Fix**: Add a maximum length check: `if (courseIds.length > 100) return 400`. The app has ~80 courses total, so 100 is a safe upper bound.

---

## Pass 4: Concurrency Issues

### 4.1 Token Rotation Race Condition: Two Concurrent Requests Can Double-Rotate

- **File/Line**: `src/lib/auth.ts`, lines 109-174
- **Severity**: High
- **Description**: When a user's JWT expires, the next request triggers token rotation in `authenticateRequest`. If two requests arrive simultaneously with the same expired JWT and same refresh token:
  1. Request A: reads session by `token_hash` — finds it (line 110-113)
  2. Request B: reads session by `token_hash` — also finds it (same row, not yet deleted)
  3. Request A: deletes old session, creates new session, returns new cookies
  4. Request B: deletes old session (already deleted, DELETE succeeds with 0 changes), creates **another** new session, returns different new cookies

  The user's browser receives two different sets of cookies. Whichever response arrives last wins. The **other** session becomes an orphan in D1 (it's valid but no client holds its refresh token). Over time, orphaned sessions accumulate until the cron job cleans them up after expiry (90 days).

  More critically: Request B's lookup at step 2 may fail if Request A's DELETE has already committed. In that case, Request B falls into the "session not found" branch and **clears all cookies**. This means the user gets logged out despite having a valid session.

- **Evidence**: D1 does not support row-level locking. There is no transaction wrapping the read-then-delete-then-insert sequence in `authenticateRequest`. Lines 110-163 form a non-atomic read-modify-write cycle.
- **Suggested Fix**: Use `DELETE ... RETURNING *` to atomically claim the session. Replace the SELECT+DELETE with:
  ```sql
  DELETE FROM sessions WHERE token_hash = ? RETURNING user_id, expires_at
  ```
  If this returns no rows, another request already claimed it — return 401. D1 supports `RETURNING` (it's SQLite 3.35+). This makes the claim atomic: only one concurrent request can successfully delete and receive the row.

### 4.2 Optimistic Favorites: Stale Closure in `toggleFavorite`

- **File/Line**: `src/hooks/use-favorites.ts`, lines 60-113
- **Severity**: Medium
- **Description**: The `toggleFavorite` callback captures `favorites` and `favoriteDetails` in its closure (they're in the dependency array). If a user rapidly toggles the same course twice before the first API call resolves, the second toggle uses the optimistically-updated state from React (correct) **but** the rollback in the `.then()` / `.catch()` of the first call will restore the state to what it was *before the first toggle*. This overwrites the second toggle's optimistic update.

  Sequence:
  1. State: `[A]`. User adds B. Optimistic state: `[A, B]`. API call 1 fires (POST B).
  2. User removes B. Optimistic state: `[A]`. API call 2 fires (DELETE B).
  3. API call 1 succeeds — no rollback, state stays `[A]`. Correct so far.
  4. API call 2 **fails** — rollback restores `prevFavorites` from step 2, which was `[A, B]`. State becomes `[A, B]`, but the server has B deleted (from step 1 success then step 2 failure means B was added then failed to delete, so B is still on server).

  Actually, in step 4: if API call 2 fails, rollback uses `prevFavorites` which was `[A, B]` (the state when toggle 2 was called). This is actually correct — B is on the server (added by call 1), and the DELETE failed, so showing `[A, B]` matches server state.

  **But**: if both calls succeed, the state updates are fine. If call 1 fails and call 2 succeeds, the rollback from call 1 would restore `[A]` (pre-toggle-1 state), overwriting the result of toggle 2. The user sees B removed, but call 2 (DELETE) succeeded, so server has no B. Then call 1 rollback sets state to `[A]` which is correct. Actually this works out because call 1 failure means B wasn't added, and call 2 deleting B (which wasn't there) is a no-op.

  On further analysis, the real issue is simpler: the `.then()` callback captures `prevFavorites` and `prevDetails` from the closure at the time `toggleFavorite` was called. Because `toggleFavorite`'s dependency array includes `favorites` and `favoriteDetails`, each call gets a fresh closure. So rapid toggles should work correctly as long as React has re-rendered between calls (which it will, since `setFavorites` triggers a re-render).

  **Verdict**: The closure-based rollback is sound for sequential rapid toggles because React's state updates are synchronous within the callback, causing re-renders that update the closure for the next call. Withdrawing as not a real bug.

---

## Pass 5: Error Propagation

### 5.1 OAuth Callback Logs Full Error Object to Console

- **File/Line**: `src/app/api/auth/google/callback/route.ts`, line 167
- **Severity**: Low
- **Description**: The catch block logs `console.error("OAuth callback D1 error:", err)`. In Cloudflare Workers, `console.error` output goes to `wrangler tail` and the Workers dashboard logs. The error object may contain stack traces referencing internal paths, D1 error details, or user data (the `email`, `name`, `googleId` variables are in scope). This is standard server-side logging and not exposed to the client (the client gets a redirect with `?error=auth_failed`).
- **Evidence**: Line 167: `console.error("OAuth callback D1 error:", err)`. Client response: redirect to `returnTo?error=auth_failed`.
- **Suggested Fix**: This is acceptable server-side logging practice. No sensitive data is sent to the client. Not a bug.

### 5.2 `auth-provider.tsx`: Silent Failure on Merge Fetch Failure

- **File/Line**: `src/components/auth-provider.tsx`, lines 54-79
- **Severity**: Low
- **Description**: If the `POST /api/user/favorites/merge` call fails (line 60: `if (mergeRes.ok)`), the code silently skips the merge without notifying the user. The user's local favorites are not merged to the server. On the next page load, `useFavorites` fetches from the server and overwrites localStorage, so the user loses their local-only favorites.
- **Evidence**: Line 60 checks `mergeRes.ok` but does nothing on failure. Line 86 catches errors silently. The `justSignedIn` param is removed from the URL (line 83-84) regardless of merge success, so the merge is never retried.
- **Suggested Fix**: Show a toast on merge failure: `showToast("Couldn't sync your favorites — they'll sync next time you sign in")`. Also consider: don't remove `justSignedIn` from URL on failure, or store a flag in localStorage to retry on next load.

### 5.3 `deleteAccount` in `auth-provider.tsx` Doesn't Check Response Body

- **File/Line**: `src/components/auth-provider.tsx`, line 102
- **Severity**: Low
- **Description**: The `deleteAccount` function checks `res.ok` but doesn't read the `clearLocalStorage: true` flag from the response body. It calls `setFavorites([])` unconditionally on success. This works, but the server's `clearLocalStorage` signal is ignored. If the server ever changed to not include that flag (meaning "don't clear"), the client would still clear.
- **Evidence**: Line 102: `if (!res.ok)` — only checks status. Line 107: `setFavorites([])` — always clears.
- **Suggested Fix**: This is a minor design concern, not a real bug. The current behavior (always clear localStorage on account deletion) is correct. The `clearLocalStorage` response field is unused client-side but communicates intent. Not actionable.

---

## Summary

| # | Finding | Severity | Pass |
|---|---------|----------|------|
| 3.1 | Non-null assertion on potentially null `code` param in OAuth callback | Medium | 3 |
| 3.3 | Unbounded `courseIds` array in merge endpoint — no size limit | Medium | 3 |
| 4.1 | Token rotation race condition — concurrent requests with expired JWT | High | 4 |
| 5.2 | Silent failure on favorites merge — local favorites lost on next load | Low | 5 |

### Actionable Items (ranked by severity)

1. **High — Token rotation race (4.1)**: Use `DELETE ... RETURNING` for atomic session claim in `authenticateRequest`.
2. **Medium — Unbounded merge array (3.3)**: Add `courseIds.length` cap in merge route.
3. **Medium — Non-null assertion (3.1)**: Remove `!` on `code` param, add explicit null check.
4. **Low — Silent merge failure (5.2)**: Add toast notification on merge failure.
