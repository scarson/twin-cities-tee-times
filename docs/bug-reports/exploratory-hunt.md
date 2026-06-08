# Exploratory Bug Hunt: Google OAuth System

Date: 2026-03-09
Scope: Google OAuth 2.0 + PKCE (Arctic) + JWT sessions (jose, HS256), Next.js on Cloudflare Workers/D1

## Findings

---

### 1. sendBeacon booking-click can silently invalidate user session

**Severity:** High

**File/Line:** `src/components/tee-time-list.tsx:85`, `src/lib/auth.ts:79-174`

**Description:**
When a logged-in user clicks "Book", `navigator.sendBeacon` fires a POST to `/api/user/booking-clicks`. That endpoint calls `authenticateRequest()`. If the user's JWT has expired (15-minute lifetime), `authenticateRequest` performs token rotation: it deletes the old refresh token session from D1 and creates a new one, returning new cookies in the response headers.

However, `sendBeacon` is fire-and-forget — the browser discards the response entirely, including `Set-Cookie` headers. The result:
- The old refresh token's session is deleted from D1
- The new session is created but the new refresh cookie is never set in the browser
- The browser still holds the old refresh token, which now points to a deleted session
- The next API call requiring auth will fail, silently logging the user out

**Evidence:**
1. `sendBeacon` does not process response headers (per spec)
2. `authenticateRequest` unconditionally rotates tokens when JWT is expired and refresh is valid (lines 144-172 of auth.ts)
3. The booking-clicks endpoint passes through `authenticateRequest` headers (line 42 of booking-clicks route), but they're discarded by sendBeacon

**Suggested Fix:**
Either:
- (A) Skip token rotation for sendBeacon requests — detect via `Content-Type: text/plain;charset=UTF-8` (sendBeacon with Blob sends the specified MIME type, but checking this is fragile) or a custom header (sendBeacon can't set headers, so absence of a custom header could identify it)
- (B) Make the booking-clicks endpoint NOT call `authenticateRequest` for token rotation. Instead, just verify the existing JWT and if expired, still read the claims (via `decodeJwt` without verification) or simply skip the click tracking silently. Since this is fire-and-forget analytics, failing silently is acceptable.
- (C) Best: add a parameter to `authenticateRequest` like `{ allowRotation: false }` and use it for the booking-clicks endpoint. When rotation is disabled, an expired JWT with a valid refresh token returns `user: null` instead of rotating.

---

### 2. Post-login favorites merge and useFavorites hook race condition

**Severity:** Medium

**File/Line:** `src/components/auth-provider.tsx:46-74`, `src/hooks/use-favorites.ts:24-57`

**Description:**
When a user signs in (`justSignedIn=true`), two independent async flows both fetch and write favorites:

1. **auth-provider** (lines 50-79): Reads local favorites, POSTs merge, GETs the merged server favorites, writes them to localStorage
2. **useFavorites hook** (lines 24-57): Triggered by `isLoggedIn` becoming true, GETs server favorites, writes them to both React state and localStorage

These run concurrently. The `useFavorites` GET can resolve BEFORE the merge POST completes, fetching only the pre-merge server favorites (which may be empty for a first-time login). It writes these to React state. The auth-provider's merge then completes and writes the correct merged set to localStorage, but `useFavorites`'s React state is already set and won't update — the effect only runs once (when `isLoggedIn` transitions to true).

**Result:** After first login with local favorites, the UI may show no favorites (or only pre-existing server favorites) until the page is manually refreshed, even though localStorage has the correct merged data.

**Evidence:**
- `useFavorites` effect depends on `[isLoggedIn]` — it only fires once when login state changes
- auth-provider sets `setUser(userData)` on line 46, then continues the merge flow
- The React re-render triggered by `setUser` schedules the `useFavorites` effect
- Both the merge fetch and the useFavorites fetch are independent async operations with no coordination

**Suggested Fix:**
Have the auth-provider merge flow signal `useFavorites` to refetch after merge completes. Options:
- (A) Add a `refreshFavorites()` function to the auth context that `useFavorites` exposes, and call it after merge
- (B) Use a state counter/key that `useFavorites` depends on, incremented after merge
- (C) Move the server favorites fetch entirely into the auth-provider's merge flow and pass the result down, instead of having `useFavorites` independently fetch

---

### 3. Concurrent token rotation creates orphaned sessions

**Severity:** Low

**File/Line:** `src/lib/auth.ts:109-163`

**Description:**
If two requests arrive simultaneously with an expired JWT and the same valid refresh token, both execute the rotation flow:
1. Both SELECT the session — both find it valid
2. Both DELETE the old session (second DELETE is a no-op)
3. Both INSERT new sessions with different token hashes
4. Both return different new cookies

The client receives cookies from whichever response arrives last. The session from the "losing" response becomes orphaned in D1.

**Evidence:**
The SELECT (line 110), DELETE (line 145), and INSERT (line 158) are separate statements with no transaction wrapping. D1 runs each statement in its own implicit transaction.

**Impact:** Orphaned session rows accumulate (cleaned up by cron's session expiry cleanup, or by max-sessions enforcement on next login). No security issue — the orphaned session maps to a valid user but the corresponding cookie is never used. The user stays logged in via the winning response's cookies.

**Suggested Fix:**
This is acceptable for the current scale. If it becomes a concern, the rotation could use a D1 batch to make the DELETE+INSERT atomic, or check the DELETE's `changes` count before proceeding with INSERT.

---

### 4. Account deletion can send conflicting Set-Cookie headers

**Severity:** Low

**File/Line:** `src/app/api/user/account/route.ts:12-27`

**Description:**
If the user's JWT is expired when they delete their account, `authenticateRequest` performs token rotation before returning the user. This appends `Set-Cookie` headers for new auth tokens to the `headers` object. Then `clearAuthCookies` (line 24) appends additional `Set-Cookie` headers to clear the same cookies.

The response contains four Set-Cookie headers: two setting new tokens, two clearing them. Per RFC 6265, the browser processes all Set-Cookie headers, and the last one for each cookie name (with matching path/domain) wins. Since `clearAuthCookies` appends after rotation, the clear headers come last and win.

**Evidence:**
`authenticateRequest` calls `setAuthCookies(headers, ...)` on line 172 of auth.ts. Then account route calls `clearAuthCookies(headers, ...)` on line 24. Both append to the same `headers` object.

**Impact:** Functionally correct (clear wins), but wasteful — rotation creates a new session in D1 that's immediately cascade-deleted by `DELETE FROM users`. Four Set-Cookie headers instead of two.

**Suggested Fix:**
Similar to finding #1: add an option to `authenticateRequest` to skip rotation, or check whether the endpoint will clear cookies anyway.

---

### 5. Max-sessions enforcement only deletes one session per login

**Severity:** Low

**File/Line:** `src/app/api/auth/google/callback/route.ts:130-144`

**Description:**
The max-sessions check (MAX_SESSIONS=10) counts sessions and deletes only the oldest ONE if the count exceeds 10. If a user somehow accumulates many sessions (e.g., through concurrent rotation creating orphans, or automated login), only one is cleaned up per new login.

**Evidence:**
Line 136: `if (countRow.count > MAX_SESSIONS)` — deletes `LIMIT 1`. If count is 15, only 1 is deleted, leaving 14 (still over limit).

**Impact:** Sessions have a 90-day expiry and cron cleans up expired ones, so unbounded accumulation is unlikely in practice. But the intent of MAX_SESSIONS is not fully enforced.

**Suggested Fix:**
Change the DELETE to remove all excess sessions:
```sql
DELETE FROM sessions WHERE token_hash IN (
  SELECT token_hash FROM sessions WHERE user_id = ?
  ORDER BY created_at ASC
  LIMIT MAX(0, ? - 10)
)
```
Where the second bind parameter is the current count.
