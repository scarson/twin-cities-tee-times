# Google OAuth & User Preferences — Design Document

**Date:** 2026-03-09
**Status:** Approved
**Depends on:** `docs/plans/2026-03-08-tee-times-app-design.md`

## Purpose

Add optional Google OAuth login so users can persist favorites and preferences across devices. Anonymous usage remains fully functional — auth unlocks cross-device sync, not gated features. Additionally, track booking clicks for logged-in users to enable usage stats.

## Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth provider | Google OAuth only | Simplest, covers target audience |
| OAuth library | Arctic (pilcrowonpaper) | Lightweight (~5KB), Fetch API-based, runtime-agnostic, works on CF Workers |
| JWT library | jose | Web Crypto native, works on CF Workers |
| Session strategy | JWT (15 min) + refresh token (90 days) | Stateless access checks, long-lived sessions without re-login |
| User data storage | D1 tables (users, sessions, user_favorites, user_settings, booking_clicks) | Extends existing D1 infrastructure |
| Favorites sync | Server = source of truth, localStorage = read cache | Fast first paint, server authority |
| Merge strategy | Union merge (additive only) | No data loss, simple, idempotent |

## Authentication Flow

### Sign In

1. User clicks "Sign in with Google" in the nav bar
2. Client navigates to `GET /api/auth/google` (can include `?returnTo=/courses/braemar`)
3. Server generates authorization URL via Arctic with:
   - CSRF `state` parameter stored in a short-lived HTTP-only cookie (`tct-oauth-state`, 10 min expiry)
   - PKCE `code_verifier` stored in a short-lived HTTP-only cookie (`tct-oauth-verifier`, 10 min expiry)
   - `returnTo` URL stored in the state cookie (validated: must be a relative path starting with `/`, defaults to `/`)
4. Server responds with a redirect to Google's consent screen
5. Google redirects to `GET /api/auth/google/callback` with authorization code (or `error` param if user cancelled)
6. Server validates `state` matches the cookie (CSRF protection). On mismatch: redirect to `/?error=auth_failed`
7. Server exchanges code for tokens via Arctic's `validateAuthorizationCode()`. On failure: redirect to `/?error=auth_failed`
8. Server decodes the ID token and extracts user info (Google `sub`, email, name)
9. Server upserts user in D1 `users` table (keyed on `google_id`; updates email/name on each login)
10. Server creates a session:
    - Generates a random refresh token via `crypto.randomUUID()`, stores its SHA-256 hash in `sessions` table (90-day expiry)
    - Signs a JWT with `{ userId, email, exp }` (15-minute expiry) using `JWT_SECRET` via jose's `SignJWT`
    - Sets both as HTTP-only cookies (`tct-session` for JWT, `tct-refresh` for refresh token)
    - Cookie settings: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` only when `request.url` starts with `https://` (allows HTTP on localhost)
11. Server enforces max 10 active sessions per user (deletes oldest by `created_at` if exceeded)
12. Server clears the OAuth state/verifier cookies
13. Server redirects to `returnTo` URL with `?justSignedIn=true` appended

**Error handling:** If the user cancels Google consent or any OAuth step fails, redirect to `returnTo` (or `/`) with no session cookies set. The app continues working as anonymous.

### Token Refresh

When a request arrives with an expired JWT but a valid `tct-refresh` cookie:

1. Server hashes the refresh token, looks up the row in `sessions`
2. If found and not expired:
   - Deletes the old session row
   - Generates a new refresh token, stores its hash (rotation)
   - Signs a new JWT
   - Sets both new cookies
   - Proceeds with the original request
3. If not found or expired: clears both cookies, returns 401

This is implemented as a **utility function** (`authenticateRequest` in `src/lib/auth.ts`), NOT as Next.js middleware. Each authenticated route handler calls it at the top. Reason: Next.js middleware on OpenNext/CF Workers may not have reliable access to D1 via `getCloudflareContext()`, and the refresh flow requires D1 access.

```typescript
// Returns { user, response } where response has updated cookies if tokens were refreshed
// Returns { user: null, response } with 401 if auth fails
async function authenticateRequest(request: NextRequest, db: D1Database, jwtSecret: string):
  Promise<{ user: { userId: string; email: string } | null; headers: Headers }>
```

**Concurrent refresh race condition:** If two tabs both try to refresh simultaneously, the second tab's request will fail (old token already deleted). This is acceptable — the second tab will show the user as logged out until its next page load, when the first tab's new cookie will be available. For this app's usage pattern this is a non-issue.

### Sign Out

`POST /api/auth/logout`:
- Deletes the session row from D1 (by refresh token hash)
- Clears `tct-session` and `tct-refresh` cookies
- Does NOT clear localStorage — user keeps their favorites for anonymous use

### Secrets (Wrangler Secrets)

| Secret | Purpose |
|--------|---------|
| `GOOGLE_CLIENT_ID` | Google Cloud Console OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console OAuth client secret |
| `JWT_SECRET` | 256-bit random key for HMAC-SHA256 JWT signing |

### Google Cloud Console Setup

- Create OAuth 2.0 Client ID (Web application type)
- Authorized redirect URI: `https://teetimes.scarson.io/api/auth/google/callback`
- For local dev: add `http://localhost:3000/api/auth/google/callback`
- Scopes needed: `openid`, `email`, `profile`

## Data Model

### New Tables (migration `0002_auth_schema.sql`)

D1 enforces foreign keys by default (`PRAGMA foreign_keys = on` equivalent). ON DELETE CASCADE works as expected.

#### `users`

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID via `crypto.randomUUID()` |
| google_id | TEXT UNIQUE NOT NULL | Google's `sub` claim — stable user identifier |
| email | TEXT NOT NULL | From Google ID token, updated on each login |
| name | TEXT NOT NULL | Display name from Google, updated on each login |
| created_at | TEXT NOT NULL | ISO 8601 |

#### `sessions`

| Column | Type | Notes |
|--------|------|-------|
| token_hash | TEXT PK | SHA-256 hex of the refresh token sent to client |
| user_id | TEXT NOT NULL | FK → users.id, ON DELETE CASCADE |
| expires_at | TEXT NOT NULL | ISO 8601, 90 days from creation |
| created_at | TEXT NOT NULL | ISO 8601 |

Indexes:
- `sessions(user_id)` — for "delete all sessions" and session count enforcement
- `sessions(expires_at)` — for expired session cleanup

#### `user_favorites`

| Column | Type | Notes |
|--------|------|-------|
| user_id | TEXT NOT NULL | FK → users.id, ON DELETE CASCADE |
| course_id | TEXT NOT NULL | FK → courses.id, ON DELETE CASCADE |
| created_at | TEXT NOT NULL | ISO 8601 |
| PRIMARY KEY(user_id, course_id) | | Prevents duplicate favorites |

Course names come from joining with the `courses` table — no denormalization.

#### `user_settings`

Created now for future use. Not populated by this feature.

| Column | Type | Notes |
|--------|------|-------|
| user_id | TEXT NOT NULL | FK → users.id, ON DELETE CASCADE |
| key | TEXT NOT NULL | e.g. `"default_start_time"`, `"default_view"` |
| value | TEXT NOT NULL | The setting value |
| PRIMARY KEY(user_id, key) | | One value per setting per user |

#### `booking_clicks`

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| user_id | TEXT NOT NULL | FK → users.id, ON DELETE CASCADE |
| course_id | TEXT NOT NULL | FK → courses.id, ON DELETE CASCADE |
| date | TEXT NOT NULL | Tee time date (YYYY-MM-DD) — when they'd play |
| time | TEXT NOT NULL | Tee time (HH:MM) — what time they'd play |
| clicked_at | TEXT NOT NULL | ISO 8601 — when they clicked |
| UNIQUE(user_id, course_id, date, time) | | One click per tee time per user |

Index: `booking_clicks(user_id, clicked_at)` for per-user stats queries.

**Important constraints:**
- Courses must never be hard-deleted (use `is_active = 0` for soft delete). Hard-deleting a course would CASCADE-delete all booking click history for that course.
- Booking click data is never pruned — it's a permanent record for user stats.
- User-facing stats must use language like "booking clicks," not "rounds played." A click means the user opened the booking site, not that they completed a reservation.

### Session Cleanup

Expired sessions are cleaned up by the cron handler, alongside the existing `poll_log` pruning. The cleanup query (`DELETE FROM sessions WHERE expires_at < datetime('now')`) runs on every cron cycle — it's cheap, idempotent, and consistent with how `poll_log` cleanup already works.

## Client-Side Architecture

### Auth State Detection

The JWT is in an HTTP-only cookie — JavaScript cannot read it. The client determines login state via:

1. **`AuthProvider` React context** (`src/components/auth-provider.tsx`) wraps the app in `layout.tsx`
2. On mount, it calls `GET /api/auth/me`
   - 200 → user is logged in, stores `{ userId, email, name }` in context
   - 401 → user is anonymous, stores `null`
3. Exposes: `user` (object or null), `isLoggedIn` (boolean), `isLoading` (boolean), `signOut()` (calls logout API + clears context)
4. The nav bar reads from this context to show "Sign in" vs user info

### Post-Login Merge Trigger

The OAuth callback redirects to `returnTo` with `?justSignedIn=true`. The `AuthProvider` checks for this query param on mount:
- If `?justSignedIn=true` AND localStorage has favorites → runs the merge flow (POST to `/api/user/favorites/merge`, update localStorage, show toast)
- Strips the query param from the URL via `history.replaceState()` after processing

### Favorites Module Refactor

The current `src/lib/favorites.ts` is synchronous and localStorage-only. With auth, favorites have two modes:

**Approach:** Keep `src/lib/favorites.ts` as-is for raw localStorage operations. Add a new `useFavorites()` React hook (`src/hooks/use-favorites.ts`) that:

1. Reads from `AuthProvider` context to determine if user is logged in
2. **Anonymous mode:** Delegates to the existing localStorage functions directly. Synchronous, no API calls.
3. **Logged-in mode:**
   - Exposes `favorites: string[]`, `favoriteDetails: FavoriteEntry[]`, `isLoading: boolean`
   - On mount: reads localStorage for instant data, fetches `GET /api/user/favorites` in background, replaces localStorage + state with server response
   - `toggleFavorite(courseId, courseName)`: writes optimistically to localStorage + state, fires API call, rolls back on failure with error toast
   - `isFavorite(courseId)`: synchronous check against current state

**Migration path for existing components:**
- `src/app/page.tsx`: Replace direct `getFavorites()` / `getFavoriteDetails()` calls with `useFavorites()` hook
- `src/app/courses/[id]/page.tsx`: Same — use `useFavorites()` hook
- `src/components/course-header.tsx`: Toggle favorite via hook instead of direct localStorage call

The existing `src/lib/favorites.ts` module is NOT deleted — it's still used internally by the hook and directly by any server-side code that doesn't have React context.

### Environment Bindings Access

All environment variables (D1, secrets) are accessed via `getCloudflareContext()`:

```typescript
const { env } = await getCloudflareContext();
const db = env.DB;
const clientId = env.GOOGLE_CLIENT_ID;
const jwtSecret = env.JWT_SECRET;
```

Do NOT use `process.env` — it doesn't work on Cloudflare Workers.

## Favorites Sync

### Source of Truth

| User state | Source of truth | localStorage role |
|------------|----------------|-------------------|
| Logged out | localStorage | Sole storage |
| Logged in | D1 `user_favorites` | Read cache for fast first paint |

### On Sign-In (First Time or Returning)

Triggered by the `AuthProvider` detecting `?justSignedIn=true` in the URL:

1. Reads localStorage favorites
2. If localStorage has favorites, POSTs to `POST /api/user/favorites/merge` with the list of course IDs
   - Request body: `{ courseIds: ["braemar", "theodore-wirth-18", ...] }`
   - Server does `INSERT OR IGNORE` for each valid course ID (silently skips IDs not in the `courses` table)
   - Response: `{ merged: number, total: number }` where `merged` is the count of genuinely new favorites added
3. Client fetches `GET /api/user/favorites` to get the full merged result
   - Response: `{ favorites: [{ courseId: "braemar", courseName: "Braemar", city: "Edina" }, ...] }`
4. Replaces localStorage with the merged set
5. If `merged > 0`, shows a toast: "Synced N favorites from this device" (auto-dismisses after 5 seconds)
6. If `merged === 0`, no toast
7. Strips `?justSignedIn=true` from URL via `history.replaceState()`

### On Favorites Change (Logged-In User)

1. Write optimistically to localStorage (instant UI update)
2. Call server API (`POST` or `DELETE /api/user/favorites/:courseId`)
3. On success: done, both are in sync
4. On failure: roll back the localStorage change, show error toast "Couldn't save — try again" (auto-dismisses after 5 seconds)

### On Page Load (Logged-In User)

1. Read localStorage for instant first render
2. Fetch `GET /api/user/favorites` in background
3. Replace localStorage with server data (server wins, no reconciliation logic)
4. If favorites changed, re-render

### On Sign-Out

- Clear session cookies
- Keep localStorage intact — user continues with their favorites as an anonymous user

### Known Limitation

Multiple open tabs won't sync favorites in real time. Low priority for this app's usage pattern.

## Booking Click Tracking

### How It Works

When a logged-in user clicks a "Book" link:

1. The link opens the booking site in a new tab (existing behavior)
2. Before navigation, fire `navigator.sendBeacon()` to `POST /api/user/booking-clicks`
3. Body: `new Blob([JSON.stringify({ courseId, date, time })], { type: 'application/json' })`
4. Server validates JWT from cookie, inserts row with `INSERT OR IGNORE` (deduplicates by UNIQUE constraint)
5. No error handling on the client — this is fire-and-forget analytics, not critical path

### Anonymous Users

Not tracked. Only logged-in users generate booking click events.

### Stats (Future)

**User-facing (future feature):** "You clicked Book at Braemar 12 times this season," "Your most-booked course," etc.

**Admin (Sam):** Ad-hoc D1 queries via `wrangler d1 execute`:
```sql
-- Most clicked courses
SELECT c.name, COUNT(*) as clicks FROM booking_clicks bc
JOIN courses c ON c.id = bc.course_id GROUP BY bc.course_id ORDER BY clicks DESC;

-- Clicks per user
SELECT u.name, COUNT(*) as clicks FROM booking_clicks bc
JOIN users u ON u.id = bc.user_id GROUP BY bc.user_id ORDER BY clicks DESC;
```

## API Routes

### Auth Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/auth/google` | None | Generate Google OAuth URL, redirect |
| GET | `/api/auth/google/callback` | None | Handle OAuth callback, create session |
| POST | `/api/auth/refresh` | Refresh cookie | Exchange refresh token for new JWT + refresh token |
| POST | `/api/auth/logout` | JWT | Delete session, clear cookies |
| GET | `/api/auth/me` | JWT | Return current user info (id, email, name) or 401 |

### User Data Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/user/favorites` | JWT | List user's favorites (joined with courses for names) |
| POST | `/api/user/favorites/merge` | JWT | Union-merge a list of course IDs (idempotent) |
| POST | `/api/user/favorites/:courseId` | JWT | Add a single favorite |
| DELETE | `/api/user/favorites/:courseId` | JWT | Remove a single favorite |
| POST | `/api/user/booking-clicks` | JWT | Record a booking click (fire-and-forget) |

All authenticated routes return 401 if no valid JWT is present. The refresh flow is transparent — middleware checks for expired JWT + valid refresh cookie before returning 401.

## UI Changes

### Nav Bar

The existing nav bar (`src/components/nav.tsx`) gets a sign-in/user area on the right side:

- **Logged out:** "Sign in" text link (not a button — keeps the nav minimal)
- **Logged in:** User's first name or avatar initial in a small circle. Tapping opens a dropdown with "Sign out"

### Toasts

- **Merge toast:** "Synced N favorites from this device" — shown after first-login merge when localStorage contributed favorites. Auto-dismisses after 5 seconds.
- **Error toast:** "Couldn't save — try again" — shown when a favorites API write fails and localStorage is rolled back. Auto-dismisses after 5 seconds.

### No Other UI Changes

The favorites toggle, course detail page star, tee time list, and all existing interactions work exactly as today. The only visible differences are the nav sign-in area and the occasional toast.

## New Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `arctic` | Google OAuth token exchange | ~5KB |
| `jose` | JWT signing/verification (Web Crypto native) | ~10KB |

Both are runtime-agnostic and work on Cloudflare Workers without Node.js polyfills.

## Wrangler Config Changes

`wrangler.jsonc` needs no structural changes. The three secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`) are set via `wrangler secret put`, not in the config file.

For local development, these can be set in a `.dev.vars` file (already gitignored by default).

## `env.d.ts` Changes

Add the three new environment bindings:

```typescript
GOOGLE_CLIENT_ID: string;
GOOGLE_CLIENT_SECRET: string;
JWT_SECRET: string;
```

## Testing Strategy

### Auth Library Tests (`src/lib/auth.test.ts`)

**Happy paths:**
- Create and verify a valid JWT (roundtrip)
- JWT with correct claims (userId, email, exp)
- Hash a refresh token and look it up
- Create a session row with correct expiry (90 days)

**Unhappy paths:**
- Verify an expired JWT → returns null/error
- Verify a JWT with invalid signature → returns null/error
- Verify a JWT with missing claims → returns null/error
- Look up a non-existent refresh token hash → returns null
- Look up an expired refresh token → returns null and clears cookies

### Auth Route Tests

**`GET /api/auth/google`:**
- Redirects to Google's OAuth URL
- Sets state and verifier cookies
- `returnTo` param is stored and validated (rejects absolute URLs, accepts relative paths)
- Missing `returnTo` defaults to `/`

**`GET /api/auth/google/callback`:**
- Happy path: valid code → creates user, creates session, sets cookies, redirects with `?justSignedIn=true`
- User cancels consent (Google returns `error` param) → redirects without session
- State mismatch (CSRF) → redirects without session
- Missing state/verifier cookies (expired) → redirects without session
- Existing user (same google_id) → updates email/name, creates new session
- Max sessions enforcement → 11th login evicts oldest session

**`POST /api/auth/logout`:**
- Deletes session row, clears cookies
- Invalid/missing JWT → still clears cookies (idempotent)

**`GET /api/auth/me`:**
- Valid JWT → returns user info
- Expired JWT + valid refresh → refreshes tokens, returns user info
- No auth → 401
- Valid JWT but user deleted from D1 → 401

### `authenticateRequest` Tests (`src/lib/auth.test.ts`)

- Valid JWT → returns user
- Expired JWT + valid refresh token → rotates tokens, returns user + new cookie headers
- Expired JWT + expired refresh token → returns null, clears cookies
- Expired JWT + missing refresh cookie → returns null
- No JWT cookie at all → returns null
- Malformed JWT cookie → returns null

### Favorites API Tests

**`GET /api/user/favorites`:**
- Returns favorites joined with course names
- Empty favorites → returns empty array
- No auth → 401

**`POST /api/user/favorites/merge`:**
- Merges new course IDs, returns correct `merged` count
- All course IDs already exist → `merged: 0`
- Some course IDs invalid (not in courses table) → silently skipped, valid ones merged
- Empty courseIds array → no-op, `merged: 0`
- No auth → 401

**`POST /api/user/favorites/:courseId`:**
- Adds a favorite → 200
- Course already favorited → idempotent 200
- Course ID doesn't exist in courses table → 404
- No auth → 401

**`DELETE /api/user/favorites/:courseId`:**
- Removes a favorite → 200
- Course not in favorites → idempotent 200
- No auth → 401

### Booking Clicks API Tests

**`POST /api/user/booking-clicks`:**
- Records a click → 200
- Duplicate click (same user, course, date, time) → idempotent 200
- Missing fields → 400
- No auth → 401

### useFavorites Hook Tests

- Anonymous mode: delegates to localStorage
- Logged-in mode: fetches from server on mount, updates localStorage
- Toggle favorite (logged in): optimistic update + server call
- Toggle favorite failure: rolls back localStorage, exposes error state
- Merge on sign-in: detects `?justSignedIn=true`, runs merge, shows toast

### Manual E2E (Not Automated)

- Sign in with Google on real deployment, verify cookies set
- Verify favorites sync across two devices
- Verify booking click recording via D1 query
- Sign out and verify anonymous mode works with localStorage intact

## Library API Reference (for implementers)

### Arctic (Google OAuth)

```typescript
import { Google } from "arctic";

const google = new Google(clientId, clientSecret, redirectURI);

// Step 1: Generate authorization URL
const state = crypto.randomUUID();
const codeVerifier = /* arctic provides */ generateCodeVerifier();
const url = google.createAuthorizationURL(state, codeVerifier, ["openid", "email", "profile"]);

// Step 2: Exchange code for tokens (in callback handler)
const tokens = await google.validateAuthorizationCode(code, codeVerifier);
const idToken = tokens.idToken(); // JWT string — decode to get sub, email, name
```

Note: Check Arctic docs for exact API — method signatures may differ slightly between versions.

### jose (JWT)

```typescript
import { SignJWT, jwtVerify } from "jose";

// Sign
const secret = new TextEncoder().encode(jwtSecret);
const jwt = await new SignJWT({ userId, email })
  .setProtectedHeader({ alg: "HS256" })
  .setExpirationTime("15m")
  .setIssuedAt()
  .sign(secret);

// Verify
const { payload } = await jwtVerify(jwt, secret);
// payload.userId, payload.email, payload.exp
```

### SHA-256 hashing (Web Crypto, no library needed)

```typescript
async function sha256(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}
```

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Google OAuth credentials misconfigured | Sign-in broken | Test in staging first; app works fully without auth |
| JWT secret leaked or rotated | All users logged out | Secret rotation = all refresh tokens invalid; users just sign in again |
| Arctic or jose incompatible with Workers runtime | Build failure | Both are Fetch/WebCrypto-based; verify in preview build before deploying |
| D1 write failures on favorites | User sees error toast, localStorage rolled back | Graceful degradation; anonymous mode always works |
| Open redirect via `returnTo` param | Phishing risk | Validate `returnTo` is a relative path starting with `/`; reject absolute URLs |
| Concurrent refresh token rotation | Second tab gets 401 | Acceptable — tab recovers on next page load when new cookie is available |
| `Secure` cookies on localhost | Auth broken in local dev | Set `Secure` flag only when request URL starts with `https://` |
