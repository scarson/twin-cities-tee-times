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
2. Client hits `GET /api/auth/google`
3. Server generates authorization URL via Arctic with:
   - CSRF `state` parameter stored in a short-lived HTTP-only cookie
   - PKCE `code_verifier` stored in a short-lived HTTP-only cookie
   - `returnTo` URL stored in the state cookie (page user was on)
4. Server responds with a redirect to Google's consent screen
5. Google redirects to `GET /api/auth/google/callback` with authorization code
6. Server exchanges code for tokens via Arctic
7. Server extracts user info (Google `sub`, email, name) from the ID token
8. Server upserts user in D1 `users` table (keyed on `google_id`; updates email/name on each login)
9. Server creates a session:
   - Generates a random refresh token, stores its SHA-256 hash in `sessions` table (90-day expiry)
   - Signs a JWT with `{ userId, email, exp }` (15-minute expiry) using `JWT_SECRET`
   - Sets both as HTTP-only, Secure, SameSite=Lax cookies (`tct-session` for JWT, `tct-refresh` for refresh token)
10. Server enforces max 10 active sessions per user (evicts oldest if exceeded)
11. Server redirects to `returnTo` URL

### Token Refresh

When a request arrives with an expired JWT but a valid `tct-refresh` cookie:

1. Server hashes the refresh token, looks up the row in `sessions`
2. If found and not expired:
   - Deletes the old session row
   - Generates a new refresh token, stores its hash (rotation)
   - Signs a new JWT
   - Sets both new cookies
   - Proceeds with the original request
3. If not found or expired: clears both cookies, user must sign in again

This happens transparently — the user never sees a login screen unless their refresh token has expired (90 days of inactivity).

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

Expired sessions are cleaned up daily by the cron handler. The cron runs every 5 minutes; a time-of-day check gates cleanup to run only on the first invocation after midnight Central Time. This mirrors the existing `poll_log` pruning pattern.

## Favorites Sync

### Source of Truth

| User state | Source of truth | localStorage role |
|------------|----------------|-------------------|
| Logged out | localStorage | Sole storage |
| Logged in | D1 `user_favorites` | Read cache for fast first paint |

### On Sign-In (First Time or Returning)

1. After OAuth callback completes, before redirecting:
   - Client-side code runs on redirect landing
   - Reads localStorage favorites
   - POSTs to `POST /api/user/favorites/merge` with the list of course IDs
   - Server does `INSERT OR IGNORE` for each — adds courses not already in `user_favorites`, skips duplicates, silently skips course IDs that don't exist in the `courses` table (stale localStorage data)
2. Client fetches `GET /api/user/favorites` to get the merged result
3. Replaces localStorage with the merged set
4. If localStorage contributed courses the server didn't already have, shows a toast: "Synced N favorites from this device" (auto-dismisses after 5 seconds)
5. If no new courses were added, no toast

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

- **Auth flow unit tests:** Test JWT creation/verification, refresh token rotation, session cleanup logic using mocked D1
- **Favorites sync tests:** Test merge logic (union, dedup, invalid course ID handling), optimistic write + rollback
- **Booking clicks tests:** Test INSERT OR IGNORE dedup, sendBeacon payload format
- **API route tests:** Test auth middleware (valid JWT, expired JWT + valid refresh, no auth), favorites CRUD, booking click recording
- **Manual E2E:** Sign in with Google on real deployment, verify favorites sync across devices, verify booking click recording

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Google OAuth credentials misconfigured | Sign-in broken | Test in staging first; app works fully without auth |
| JWT secret leaked or rotated | All users logged out | Secret rotation = all refresh tokens invalid; users just sign in again |
| Arctic or jose incompatible with Workers runtime | Build failure | Both are Fetch/WebCrypto-based; verify in preview build before deploying |
| D1 write failures on favorites | User sees error toast, localStorage rolled back | Graceful degradation; anonymous mode always works |
