# Google OAuth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add optional Google OAuth login with cross-device favorites sync, booking click tracking, and account deletion.

**Architecture:** JWT access tokens (15 min) + refresh tokens (90 days) in HTTP-only cookies. `authenticateRequest()` utility handles all auth for route handlers. Existing localStorage favorites remain for anonymous users; new `useFavorites()` hook adds server-backed mode for logged-in users. AuthProvider React context manages login state and post-login merge flow.

**Tech Stack:** Arctic (OAuth), jose (JWT), D1 (user data), React Context (auth state), Vitest (testing)

**Design Doc:** `docs/plans/2026-03-09-google-auth-design.md` — the authoritative specification. READ IT before starting any task.

---

## Critical Context for All Tasks

Every subagent MUST read and follow these conventions. Failure to do so will result in inconsistent code that needs to be rewritten.

### File Conventions

- **ABOUTME comments:** Every source file MUST start with two lines: `// ABOUTME: ...` describing what the file does. No exceptions.
- **Import alias:** Use `@/` for `src/` imports (e.g., `import { foo } from "@/lib/bar"`). Never use relative paths like `../../lib/bar`.
- **Tests live alongside source:** `src/lib/auth.test.ts` next to `src/lib/auth.ts`. NOT in a separate `tests/` directory.

### API Route Handler Pattern

Every route handler in this codebase follows this exact pattern. Do not deviate:

```typescript
// ABOUTME: Brief description of what this route does.
// ABOUTME: Additional context about the route's purpose.
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest, NextResponse } from "next/server";

export async function METHOD(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }  // only if route has params
) {
  const { env } = await getCloudflareContext();
  const db = env.DB;

  try {
    // ... business logic ...
    return NextResponse.json({ data });
  } catch (err) {
    console.error("Descriptive context:", err);
    return NextResponse.json({ error: "User-friendly message" }, { status: 500 });
  }
}
```

### Authenticated Route Handler Pattern

Routes requiring auth call `authenticateRequest` at the top and merge returned headers into their response:

```typescript
import { authenticateRequest } from "@/lib/auth";

export async function METHOD(request: NextRequest) {
  const { env } = await getCloudflareContext();
  const db = env.DB;
  const { user, headers } = await authenticateRequest(request, db, env.JWT_SECRET);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });

  try {
    // ... business logic using user.userId ...
    const response = NextResponse.json({ data });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  } catch (err) {
    console.error("Context:", err);
    const response = NextResponse.json({ error: "..." }, { status: 500 });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  }
}
```

### D1 Query Patterns

```typescript
// Single row
const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<UserRow>();

// Multiple rows
const { results } = await db.prepare("SELECT * FROM courses WHERE is_active = 1").all<CourseRow>();

// Insert/Update/Delete
await db.prepare("INSERT INTO users (id, google_id, email, name, created_at) VALUES (?, ?, ?, ?, ?)")
  .bind(id, googleId, email, name, now).run();

// Batch (atomic transaction)
await db.batch([stmt1, stmt2, stmt3]);
```

### Test Patterns

```typescript
// ABOUTME: Tests for [module].
// ABOUTME: Covers [what scenarios].
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createMockD1, createMockEnv } from "@/test/d1-mock";

// Mock getCloudflareContext for route tests:
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

beforeEach(() => {
  vi.restoreAllMocks();

  // Wire up fresh D1 mock for each test:
  const { db, mockFirst, mockAll, mockRun } = createMockD1();
  const env = createMockEnv(db);
  vi.mocked(getCloudflareContext).mockResolvedValue({ env, ctx: {} } as any);
  // Then use mockFirst/mockAll/mockRun to set up query results per test
});
```

### D1 Mock Helper

Route tests need to mock D1. Use the shared helper at `src/test/d1-mock.ts` (created in Task 1):

```typescript
import { createMockD1, createMockEnv } from "@/test/d1-mock";

const { db, mockFirst, mockAll, mockRun } = createMockD1();
const env = createMockEnv(db);

// Queue results for sequential queries (resolved in call order):
mockFirst.mockResolvedValueOnce({ id: "user-1", email: "a@b.com" }); // first .first() call
mockFirst.mockResolvedValueOnce(null); // second .first() call
```

### Cookie Names (EXACT — do not change)

| Cookie | Purpose |
|--------|---------|
| `tct-session` | JWT access token |
| `tct-refresh` | Refresh token (plaintext UUID) |
| `tct-oauth-state` | CSRF state + returnTo during OAuth flow |
| `tct-oauth-verifier` | PKCE code verifier during OAuth flow |

### Environment Bindings

Access via `getCloudflareContext()`, NEVER via `process.env`:
- `env.DB` — D1 database
- `env.GOOGLE_CLIENT_ID` — OAuth client ID
- `env.GOOGLE_CLIENT_SECRET` — OAuth client secret
- `env.JWT_SECRET` — HMAC-SHA256 signing key

### Dependency Graph

```
Task 1 (foundation)
  └─► Task 2 (auth library)
        ├─► Task 3 (OAuth initiate)
        │     └─► Task 4 (OAuth callback)
        ├─► Task 5 (logout, me, account-delete)
        ├─► Task 6 (favorites API)
        ├─► Task 7 (booking clicks)
        └─► Task 8 (cron cleanup) ◄── also depends on Task 1 only
Task 9 (toast) ◄── no dependencies, can run anytime
Task 10 (AuthProvider) ◄── depends on Tasks 5, 6, 9
Task 11 (useFavorites hook) ◄── depends on Tasks 6, 10
Task 12 (nav bar) ◄── depends on Task 10
Task 13 (component migrations) ◄── depends on Tasks 11, 12
Task 14 (docs + verification) ◄── depends on all
```

**Parallelizable after Task 2:** Tasks 3-9 are independent of each other (Task 4 needs Task 3's pattern but not its code). Good candidates for parallel subagents.

---

## Phase 1: Foundation

### Task 1: Dependencies, Migration, Config, Test Helpers

**Goal:** Install libraries, create the D1 migration, update env types, and create shared test utilities.

**Files:**
- Modify: `package.json` (via npm install)
- Create: `migrations/0002_auth_schema.sql`
- Modify: `env.d.ts`
- Create: `src/test/d1-mock.ts`
- Create: `src/types/auth.ts`

**Step 1: Install dependencies**

```bash
npm install arctic jose
npm install -D @testing-library/react jsdom
```

Arctic is the OAuth library. jose is for JWT. testing-library and jsdom are for React hook/component tests later.

**Step 2: Create the migration file**

Create `migrations/0002_auth_schema.sql`:

```sql
-- users: Registered users via Google OAuth
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- sessions: Refresh token sessions for logged-in users
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- user_favorites: Server-backed favorites for logged-in users
CREATE TABLE user_favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, course_id)
);

-- user_settings: Key-value user preferences (created now, populated later)
CREATE TABLE user_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- booking_clicks: Tracks when logged-in users click booking links
CREATE TABLE booking_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  clicked_at TEXT NOT NULL,
  UNIQUE(user_id, course_id, date, time)
);
CREATE INDEX idx_booking_clicks_user_clicked ON booking_clicks(user_id, clicked_at);
```

**Step 3: Apply migration locally and verify**

```bash
npx wrangler d1 execute tee-times-db --local --file=migrations/0002_auth_schema.sql
npx wrangler d1 execute tee-times-db --local --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

Expected: Output includes `booking_clicks`, `sessions`, `user_favorites`, `user_settings`, `users` alongside existing tables.

**Step 4: Update `env.d.ts`**

Add the three secret bindings to the existing `CloudflareEnv` interface:

```typescript
interface CloudflareEnv {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  JWT_SECRET: string;
}
```

**Step 5: Create auth type definitions**

Create `src/types/auth.ts`:

```typescript
// ABOUTME: TypeScript interfaces for auth-related D1 row types.
// ABOUTME: Used by auth library and route handlers for type-safe D1 queries.

/** User row from D1 */
export interface UserRow {
  id: string;
  google_id: string;
  email: string;
  name: string;
  created_at: string;
}

/** Session row from D1 */
export interface SessionRow {
  token_hash: string;
  user_id: string;
  expires_at: string;
  created_at: string;
}

/** User favorite row from D1 (joined with courses for API responses) */
export interface UserFavoriteRow {
  user_id: string;
  course_id: string;
  created_at: string;
}

/** Booking click row from D1 */
export interface BookingClickRow {
  id: number;
  user_id: string;
  course_id: string;
  date: string;
  time: string;
  clicked_at: string;
}
```

Re-export from the types barrel file — add to bottom of `src/types/index.ts`:

```typescript
export type { UserRow, SessionRow, UserFavoriteRow, BookingClickRow } from "./auth";
```

**Step 6: Create shared D1 mock helper**

Create `src/test/d1-mock.ts`:

```typescript
// ABOUTME: Shared D1 mock factory for route handler tests.
// ABOUTME: Creates chainable prepare/bind/first/all/run mocks matching D1's API.
import { vi } from "vitest";

/**
 * Creates a mock D1Database with chainable query methods.
 *
 * Usage:
 *   const { db, mockFirst, mockAll, mockRun } = createMockD1();
 *   mockFirst.mockResolvedValueOnce({ id: "123", name: "Test" }); // next .first() returns this
 *   mockAll.mockResolvedValueOnce({ results: [row1, row2] });     // next .all() returns this
 *
 * For tests needing multiple sequential queries with different results,
 * use mockResolvedValueOnce() multiple times — they resolve in order.
 */
export function createMockD1() {
  const mockFirst = vi.fn().mockResolvedValue(null);
  const mockAll = vi.fn().mockResolvedValue({ results: [] });
  const mockRun = vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } });

  const boundStatement = { first: mockFirst, all: mockAll, run: mockRun };
  const statement = { bind: vi.fn().mockReturnValue(boundStatement), ...boundStatement };
  const db = {
    prepare: vi.fn().mockReturnValue(statement),
    batch: vi.fn().mockResolvedValue([]),
  };

  return { db, statement, mockFirst, mockAll, mockRun } as {
    db: any;
    statement: typeof statement;
    mockFirst: typeof mockFirst;
    mockAll: typeof mockAll;
    mockRun: typeof mockRun;
  };
}

/**
 * Creates a mock CloudflareEnv with the given D1 mock and test secrets.
 */
export function createMockEnv(db: any) {
  return {
    DB: db,
    GOOGLE_CLIENT_ID: "test-google-client-id",
    GOOGLE_CLIENT_SECRET: "test-google-client-secret",
    JWT_SECRET: "test-jwt-secret-that-is-at-least-32-chars-long",
  };
}
```

**Step 7: Update vitest config to include `.tsx` test files**

The current `vitest.config.ts` has `include: ["src/**/*.test.ts"]` which only matches `.ts` files. React component tests (Tasks 9, 10, 11) use `.test.tsx`. Update the include pattern:

```typescript
include: ["src/**/*.test.{ts,tsx}"],
```

**Step 8: Run type-check to verify**

```bash
npx tsc --noEmit
```

Expected: No new errors. (Existing worker.ts exclusion still applies.)

**Step 9: Commit**

```bash
git add migrations/0002_auth_schema.sql env.d.ts src/types/auth.ts src/types/index.ts src/test/d1-mock.ts package.json package-lock.json vitest.config.ts
git commit -m "feat: add auth schema migration, types, test helpers, and dependencies"
```

---

## Phase 2: Auth Core

### Task 2: Auth Library — JWT, Hashing, Cookies, authenticateRequest

**Goal:** Create `src/lib/auth.ts` with all auth utility functions, and comprehensive tests.

**READ FIRST:** `docs/plans/2026-03-09-google-auth-design.md` sections "Token Refresh" and "Library API Reference".

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/lib/auth.test.ts`
- Read: `src/test/d1-mock.ts` (for mock patterns)

**Dependencies:** Task 1

**Step 1: Write tests for pure auth functions**

Create `src/lib/auth.test.ts` with tests for SHA-256 hashing, JWT creation/verification, and cookie helpers. These are pure functions that don't need D1 mocks.

Test cases:
- `sha256("hello")` returns a consistent 64-character hex string
- `createJWT({ userId, email }, secret)` returns a string with 3 dot-separated parts
- `verifyJWT(validToken, secret)` returns `{ userId, email }`
- `verifyJWT(expiredToken, secret)` returns null
- `verifyJWT(wrongSignatureToken, secret)` returns null
- `verifyJWT("garbage", secret)` returns null
- `validateReturnTo("/courses/braemar")` returns `"/courses/braemar"`
- `validateReturnTo("/")` returns `"/"`
- `validateReturnTo("//evil.com")` returns `"/"`
- `validateReturnTo("https://evil.com")` returns `"/"`
- `validateReturnTo("/path\\with\\backslash")` returns `"/"`
- `validateReturnTo(null)` returns `"/"`
- `validateReturnTo("")` returns `"/"`

**Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/auth.test.ts
```

Expected: FAIL (module not found).

**Step 3: Implement pure auth functions**

Create `src/lib/auth.ts`:

```typescript
// ABOUTME: Auth utility functions for JWT, session management, and request authentication.
// ABOUTME: Central auth module used by all authenticated API route handlers.
import { SignJWT, jwtVerify, decodeJwt } from "jose";

// ── Pure helpers ──────────────────────────────────────────────

/** SHA-256 hash a string, return hex. Used to hash refresh tokens before storing in D1. */
export async function sha256(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Sign a JWT with { userId, email } claims. Expires in 15 minutes. */
export async function createJWT(
  payload: { userId: string; email: string },
  secret: string
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("15m")
    .setIssuedAt()
    .sign(key);
}

/** Verify a JWT and return claims, or null if invalid/expired. */
export async function verifyJWT(
  token: string,
  secret: string
): Promise<{ userId: string; email: string } | null> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key);
    if (typeof payload.userId !== "string" || typeof payload.email !== "string") {
      return null;
    }
    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}

/** Re-export decodeJwt for use in OAuth callback (decodes Google's ID token without verification). */
export { decodeJwt };

/** Validate a returnTo URL to prevent open redirects. Must start with / but not //. No backslashes. */
export function validateReturnTo(returnTo: string | null): string {
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//") || returnTo.includes("\\")) {
    return "/";
  }
  return returnTo;
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/auth.test.ts
```

Expected: All pure function tests PASS.

**Step 5: Write tests for authenticateRequest**

Add to `src/lib/auth.test.ts` a new `describe("authenticateRequest", ...)` block. These tests need D1 mocks because refresh token rotation queries the `sessions` table.

Test cases (6 scenarios from design doc):
- Valid JWT → returns `{ user: { userId, email }, headers: emptyHeaders }`
- Expired JWT + valid refresh token in D1 → rotates tokens, returns user + `Set-Cookie` headers
- Expired JWT + expired refresh token in D1 → returns `{ user: null }`, headers clear cookies
- Expired JWT + missing `tct-refresh` cookie → returns `{ user: null }`
- No `tct-session` cookie at all → returns `{ user: null }`
- Malformed `tct-session` cookie → returns `{ user: null }`

For the "expired JWT" test: create a JWT with very short expiry, then use `vi.useFakeTimers()` to advance past it. Alternatively, create a JWT manually with a past `exp` claim — but jose won't sign an already-expired token. The cleanest approach:

```typescript
// Create a valid JWT, then advance time past expiry
vi.useFakeTimers();
const jwt = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
vi.advanceTimersByTime(16 * 60 * 1000); // 16 minutes past 15-min expiry
const result = await verifyJWT(jwt, secret);
expect(result).toBeNull();
vi.useRealTimers();
```

**Step 6: Implement authenticateRequest**

Add to `src/lib/auth.ts`:

```typescript
import { NextRequest } from "next/server";
import type { SessionRow } from "@/types";

const COOKIE_SESSION = "tct-session";
const COOKIE_REFRESH = "tct-refresh";
const REFRESH_EXPIRY_DAYS = 90;

/**
 * Authenticate an incoming request via JWT cookie.
 * If the JWT is expired but a valid refresh token exists, rotates both tokens.
 * Callers MUST merge the returned headers into their response (they may contain Set-Cookie).
 */
export async function authenticateRequest(
  request: NextRequest,
  db: D1Database,
  jwtSecret: string
): Promise<{ user: { userId: string; email: string } | null; headers: Headers }> {
  const headers = new Headers();
  const sessionCookie = request.cookies.get(COOKIE_SESSION)?.value;
  const refreshCookie = request.cookies.get(COOKIE_REFRESH)?.value;
  const isSecure = request.url.startsWith("https://");

  // No session cookie at all
  if (!sessionCookie) {
    return { user: null, headers };
  }

  // Try to verify the JWT
  const user = await verifyJWT(sessionCookie, jwtSecret);
  if (user) {
    return { user, headers };
  }

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
      await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    }
    clearAuthCookies(headers, isSecure);
    return { user: null, headers };
  }

  // Refresh token valid — rotate tokens
  const userId = session.user_id;
  // Look up user email for new JWT
  const userRow = await db
    .prepare("SELECT email FROM users WHERE id = ?")
    .bind(userId)
    .first<{ email: string }>();

  if (!userRow) {
    // User was deleted — clean up session
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    clearAuthCookies(headers, isSecure);
    return { user: null, headers };
  }

  // Delete old session
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();

  // Create new session
  const newRefreshToken = crypto.randomUUID();
  const newTokenHash = await sha256(newRefreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  await db
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(newTokenHash, userId, expiresAt, now)
    .run();

  // Sign new JWT
  const newJwt = await createJWT({ userId, email: userRow.email }, jwtSecret);

  // Set new cookies
  setAuthCookies(headers, newJwt, newRefreshToken, isSecure);

  return { user: { userId, email: userRow.email }, headers };
}

// ── Cookie helpers (not exported — internal to this module) ──

function cookieOptions(isSecure: boolean): string {
  return `HttpOnly; SameSite=Lax; Path=/${isSecure ? "; Secure" : ""}`;
}

export function setAuthCookies(
  headers: Headers,
  jwt: string,
  refreshToken: string,
  isSecure: boolean
): void {
  const opts = cookieOptions(isSecure);
  headers.append("Set-Cookie", `${COOKIE_SESSION}=${jwt}; Max-Age=900; ${opts}`);
  headers.append(
    "Set-Cookie",
    `${COOKIE_REFRESH}=${refreshToken}; Max-Age=${REFRESH_EXPIRY_DAYS * 24 * 60 * 60}; ${opts}`
  );
}

export function clearAuthCookies(headers: Headers, isSecure: boolean): void {
  const opts = cookieOptions(isSecure);
  headers.append("Set-Cookie", `${COOKIE_SESSION}=; Max-Age=0; ${opts}`);
  headers.append("Set-Cookie", `${COOKIE_REFRESH}=; Max-Age=0; ${opts}`);
}
```

**Step 7: Run all auth tests**

```bash
npx vitest run src/lib/auth.test.ts
```

Expected: All tests PASS.

**Step 8: Run type-check**

```bash
npx tsc --noEmit
```

**Step 9: Commit**

```bash
git add src/lib/auth.ts src/lib/auth.test.ts
git commit -m "feat: add auth library with JWT, session management, and authenticateRequest"
```

---

## Phase 3: API Routes

> Tasks 3-8 are independent of each other (all depend on Task 2 only). They can be implemented in parallel by subagents.

### Task 3: OAuth Initiation Route — `GET /api/auth/google`

**Goal:** Create the route that redirects users to Google's consent screen.

**READ FIRST:** Design doc section "Sign In" steps 1-4, and "Library API Reference > Arctic".

**Files:**
- Create: `src/app/api/auth/google/route.ts`
- Create: `src/app/api/auth/google/route.test.ts`
- Read: `src/lib/auth.ts` (for cookie helpers)

**Dependencies:** Task 2

**Step 1: Write tests**

Test cases:
- Returns a redirect response (status 302 or 307) to a URL containing `accounts.google.com`
- Sets `tct-oauth-state` cookie (HttpOnly, 10-min Max-Age)
- Sets `tct-oauth-verifier` cookie (HttpOnly, 10-min Max-Age)
- `?returnTo=/courses/braemar` → state cookie contains `/courses/braemar`
- Missing `returnTo` → state cookie contains `/`
- `returnTo=//evil.com` → rejected, state cookie contains `/`
- `returnTo=https://evil.com` → rejected, state cookie contains `/`
- `returnTo=/path\with\backslash` → rejected, state cookie contains `/`
- Empty `returnTo` → state cookie contains `/`

Note: You'll need to mock Arctic's `Google` class. Mock it at the module level:
```typescript
vi.mock("arctic", () => ({
  Google: vi.fn().mockImplementation(() => ({
    createAuthorizationURL: vi.fn().mockReturnValue(new URL("https://accounts.google.com/o/oauth2/auth?mock=true")),
  })),
  generateCodeVerifier: vi.fn().mockReturnValue("mock-code-verifier"),
}));
```

**Step 2: Run tests to verify they fail**

**Step 3: Implement the route**

Create `src/app/api/auth/google/route.ts`:

The route must:
1. Extract `returnTo` from query params, validate it (starts with `/`, not `//`, no `\`), default to `/`
2. Generate CSRF state via `crypto.randomUUID()`
3. Generate PKCE code verifier via Arctic's `generateCodeVerifier()`
4. Create `Google` instance with `env.GOOGLE_CLIENT_ID`, `env.GOOGLE_CLIENT_SECRET`, and redirect URI (constructed from request URL origin + `/api/auth/google/callback`)
5. Generate auth URL with scopes `["openid", "email", "profile"]`
6. Set `tct-oauth-state` cookie with JSON `{ state, returnTo }`, 10-min expiry, HttpOnly
7. Set `tct-oauth-verifier` cookie with code verifier, 10-min expiry, HttpOnly
8. Return `NextResponse.redirect(authUrl)`

**returnTo validation:** Import `validateReturnTo` from `@/lib/auth` — it's already defined there (created in Task 2). Do NOT redefine it locally. Usage:
```typescript
import { validateReturnTo } from "@/lib/auth";
const returnTo = validateReturnTo(request.nextUrl.searchParams.get("returnTo"));
```

**Step 4: Run tests to verify they pass**

**Step 5: Run type-check**

**Step 6: Commit**

```bash
git add src/app/api/auth/google/
git commit -m "feat: add OAuth initiation route (GET /api/auth/google)"
```

---

### Task 4: OAuth Callback Route — `GET /api/auth/google/callback`

**Goal:** Handle Google's OAuth callback, create/update user, create session, redirect.

**READ FIRST:** Design doc section "Sign In" steps 5-13, and "Account Deletion" for CASCADE context.

**Files:**
- Create: `src/app/api/auth/google/callback/route.ts`
- Create: `src/app/api/auth/google/callback/route.test.ts`
- Read: `src/lib/auth.ts` (for sha256, createJWT, setAuthCookies, decodeJwt)

**Dependencies:** Task 2 (and follows Task 3's patterns)

**Step 1: Write tests**

Test cases:
- **Happy path:** Valid code + valid state → creates user in D1, creates session, sets `tct-session` and `tct-refresh` cookies, clears OAuth cookies, redirects to `returnTo?justSignedIn=true`
- **User cancels:** Google returns `?error=access_denied` → redirects to returnTo without session cookies
- **State mismatch:** State param doesn't match cookie → redirects to `/?error=auth_failed`
- **Missing cookies:** OAuth state/verifier cookies expired → redirects to `/?error=auth_failed`
- **Returning user:** Same `google_id` already exists → updates email/name, creates new session (doesn't create duplicate user)
- **Max sessions:** User has 10 sessions → 11th login deletes oldest by `created_at`

Mock Arctic's `Google` class to control `validateAuthorizationCode` behavior:
```typescript
const mockValidateAuth = vi.fn();
vi.mock("arctic", () => ({
  Google: vi.fn().mockImplementation(() => ({
    validateAuthorizationCode: mockValidateAuth,
  })),
}));

// In happy path test:
mockValidateAuth.mockResolvedValueOnce({
  idToken: () => "mock.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwibmFtZSI6IlRlc3QgVXNlciJ9.mock",
});
```

Note: The ID token from the mock needs to be decodable by `decodeJwt()`. Create a real JWT-shaped string with base64-encoded payload: `btoa(JSON.stringify({ sub: "google-123", email: "test@example.com", name: "Test User" }))`.

**Step 2: Run tests to verify they fail**

**Step 3: Implement the callback handler**

This is the most complex handler. Key implementation steps in order:

1. Check for `?error` param → redirect to returnTo (from state cookie or `/`)
2. Read `tct-oauth-state` and `tct-oauth-verifier` cookies
3. If either cookie missing → redirect to `/?error=auth_failed`
4. Parse state cookie JSON to get `{ state, returnTo }`
5. Compare `state` from cookie to `?state` query param. Mismatch → redirect to `/?error=auth_failed`
6. Create `Google` instance, call `validateAuthorizationCode(code, codeVerifier)`. On error → redirect to `returnTo?error=auth_failed`
7. Decode ID token via `decodeJwt(tokens.idToken())` → get `sub`, `email`, `name`
8. Upsert user: `INSERT INTO users ... ON CONFLICT(google_id) DO UPDATE SET email=excluded.email, name=excluded.name`
9. Get the user's ID (either from the insert or a subsequent SELECT)
10. Create refresh token (`crypto.randomUUID()`), hash it, insert session
11. Count user's sessions; if > 10, delete oldest
12. Sign JWT via `createJWT({ userId, email }, jwtSecret)`
13. Build redirect URL: `new URL(returnTo, request.url)` then `url.searchParams.set("justSignedIn", "true")`
14. Set auth cookies via `setAuthCookies(headers, jwt, refreshToken, isSecure)`
15. Clear OAuth cookies (set Max-Age=0)
16. Return `NextResponse.redirect(redirectUrl, { headers })`

**Critical:** The upsert in step 8 — D1/SQLite syntax:
```sql
INSERT INTO users (id, google_id, email, name, created_at) VALUES (?, ?, ?, ?, ?)
ON CONFLICT(google_id) DO UPDATE SET email = excluded.email, name = excluded.name
```

After the upsert, query for the user to get their ID:
```sql
SELECT id FROM users WHERE google_id = ?
```

**Step 4: Run tests to verify they pass**

**Step 5: Run type-check**

**Step 6: Commit**

```bash
git add src/app/api/auth/google/callback/
git commit -m "feat: add OAuth callback route with user upsert and session creation"
```

---

### Task 5: Session Routes — Logout, Me, Account Delete

**Goal:** Create three simple auth-related routes that all use `authenticateRequest`.

**Files:**
- Create: `src/app/api/auth/logout/route.ts`
- Create: `src/app/api/auth/me/route.ts`
- Create: `src/app/api/user/account/route.ts`
- Create: `src/app/api/auth/logout/route.test.ts`
- Create: `src/app/api/auth/me/route.test.ts`
- Create: `src/app/api/user/account/route.test.ts`
- Read: `src/lib/auth.ts`, `src/test/d1-mock.ts`

**Dependencies:** Task 2

**Step 1: Write tests for all three routes**

**`POST /api/auth/logout` tests:**
- Valid JWT → deletes session row by refresh token hash, clears cookies, returns 200 `{ ok: true }`
- Expired JWT + valid refresh cookie → deletes session by hash, clears cookies, returns 200
- No auth → clears cookies anyway, returns 200 (best-effort, never 401)

**`GET /api/auth/me` tests:**
- Valid JWT → queries `users` table for name → returns `{ userId, email, name }` with 200
- Expired JWT + valid refresh → transparent refresh via authenticateRequest, returns user info with refreshed cookies
- No auth → 401
- Valid JWT but user deleted from D1 (SELECT returns null) → 401

**`DELETE /api/user/account` tests:**
- Valid JWT → deletes user row (CASCADE), clears cookies, returns `{ ok: true, clearLocalStorage: true }` with 200
- No auth → 401

**Step 2: Run tests to verify they fail**

**Step 3: Implement the three routes**

`POST /api/auth/logout` — Best-effort handler. Do NOT use `authenticateRequest` — it could trigger token rotation (new cookies) right before we clear them, which is wasteful and confusing. Instead:
- Read the `tct-refresh` cookie directly from `request.cookies`
- If present, hash it via `sha256()` and `DELETE FROM sessions WHERE token_hash = ?`
- Clear auth cookies via `clearAuthCookies()`
- Always return 200 `{ ok: true }` (never 401, even if no cookies found)

`GET /api/auth/me`:
- Call `authenticateRequest`, return 401 if no user
- Query `SELECT name FROM users WHERE id = ?` — return 401 if user not found
- Return `{ userId, email, name }` with merged headers

`DELETE /api/user/account`:
- Call `authenticateRequest`, return 401 if no user
- `DELETE FROM users WHERE id = ?` (CASCADE handles the rest)
- Clear auth cookies
- Return `{ ok: true, clearLocalStorage: true }`

**Step 4: Run tests to verify they pass**

**Step 5: Run type-check**

**Step 6: Commit**

```bash
git add src/app/api/auth/logout/ src/app/api/auth/me/ src/app/api/user/account/
git commit -m "feat: add logout, me, and account deletion routes"
```

---

### Task 6: Favorites API Routes

**Goal:** Four favorites endpoints: list, merge, add, delete.

**READ FIRST:** Design doc sections "Favorites Sync" and "API Routes > User Data Routes".

**Files:**
- Create: `src/app/api/user/favorites/route.ts` (GET for list, no POST here)
- Create: `src/app/api/user/favorites/merge/route.ts` (POST)
- Create: `src/app/api/user/favorites/[courseId]/route.ts` (POST add, DELETE remove)
- Create: `src/app/api/user/favorites/route.test.ts`
- Create: `src/app/api/user/favorites/merge/route.test.ts`
- Create: `src/app/api/user/favorites/[courseId]/route.test.ts`

**Dependencies:** Task 2

**Step 1: Write tests**

**`GET /api/user/favorites` tests:**
- Authenticated → returns `{ favorites: [{ courseId, courseName, city }] }` from JOIN query
- Empty favorites → `{ favorites: [] }`
- No auth → 401

**`POST /api/user/favorites/merge` tests:**
- Merges new course IDs → returns `{ merged: N, total: M }`
- All already favorited → `{ merged: 0, total: M }`
- Invalid course IDs (not in courses table) → silently skipped
- Empty `courseIds` array → `{ merged: 0, total: M }`
- No auth → 401

**`POST /api/user/favorites/:courseId` tests:**
- Adds favorite → `{ ok: true }`
- Already favorited → idempotent `{ ok: true }`
- Course doesn't exist → `{ error: "Course not found" }` with 404
- No auth → 401

**`DELETE /api/user/favorites/:courseId` tests:**
- Removes favorite → `{ ok: true }`
- Not favorited → idempotent `{ ok: true }`
- No auth → 401

**Step 2: Run tests to verify they fail**

**Step 3: Implement the routes**

`GET /api/user/favorites`:
```sql
SELECT uf.course_id AS courseId, c.name AS courseName, c.city
FROM user_favorites uf
JOIN courses c ON c.id = uf.course_id
WHERE uf.user_id = ?
ORDER BY uf.created_at DESC
```
Return: `{ favorites: results }`

`POST /api/user/favorites/merge`:
- Parse body: `{ courseIds: string[] }`
- Count existing favorites: `SELECT COUNT(*) ... WHERE user_id = ?`
- For each courseId: verify course exists via `SELECT id FROM courses WHERE id = ?`, then `INSERT OR IGNORE INTO user_favorites (user_id, course_id, created_at) VALUES (?, ?, ?)`
- Count favorites after: get new total
- `merged = newTotal - oldTotal`
- Return: `{ merged, total: newTotal }`

`POST /api/user/favorites/:courseId`:
- Check course exists: `SELECT id FROM courses WHERE id = ?`
- If not → 404 `{ error: "Course not found" }`
- `INSERT OR IGNORE INTO user_favorites (user_id, course_id, created_at) VALUES (?, ?, ?)`
- Return: `{ ok: true }`

`DELETE /api/user/favorites/:courseId`:
- `DELETE FROM user_favorites WHERE user_id = ? AND course_id = ?`
- Return: `{ ok: true }` (idempotent, no error if not found)

**Step 4: Run tests to verify they pass**

**Step 5: Run type-check**

**Step 6: Commit**

```bash
git add src/app/api/user/favorites/
git commit -m "feat: add favorites API routes (list, merge, add, delete)"
```

---

### Task 7: Booking Clicks Route

**Goal:** Fire-and-forget endpoint for tracking booking link clicks.

**Files:**
- Create: `src/app/api/user/booking-clicks/route.ts`
- Create: `src/app/api/user/booking-clicks/route.test.ts`

**Dependencies:** Task 2

**Step 1: Write tests**

- Records click → `{ ok: true }`
- Duplicate click (same user, course, date, time) → idempotent `{ ok: true }`
- Missing `courseId` → `{ error: "..." }` with 400
- Missing `date` → 400
- Missing `time` → 400
- No auth → 401

**Step 2: Run tests to verify they fail**

**Step 3: Implement**

```sql
INSERT OR IGNORE INTO booking_clicks (user_id, course_id, date, time, clicked_at)
VALUES (?, ?, ?, ?, ?)
```

Validate all three fields present. Return `{ ok: true }`.

**Step 4: Run tests, type-check, commit**

```bash
git add src/app/api/user/booking-clicks/
git commit -m "feat: add booking clicks tracking route"
```

---

### Task 8: Session Cleanup in Cron Handler

**Goal:** Add expired session cleanup alongside existing `poll_log` pruning in the cron handler.

**Files:**
- Modify: `src/lib/cron-handler.ts`
- Modify: `src/lib/cron-handler.test.ts`

**Dependencies:** Task 1 (just needs the sessions table to exist)

**Step 1: Write tests**

Add to existing `src/lib/cron-handler.test.ts`:
- Expired sessions are deleted by cron (mock D1 to verify the DELETE query runs)
- The cleanup doesn't error when `sessions` table is empty

**Step 2: Run tests to verify they fail**

**Step 3: Implement**

Add one line to the cron handler, alongside the existing `poll_log` cleanup:
```typescript
await db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
```

Place it near the existing `DELETE FROM poll_log WHERE polled_at < datetime('now', '-7 days')` call.

**Step 4: Run all cron tests**

```bash
npx vitest run src/lib/cron-handler.test.ts
```

**Step 5: Commit**

```bash
git add src/lib/cron-handler.ts src/lib/cron-handler.test.ts
git commit -m "feat: add expired session cleanup to cron handler"
```

---

## Phase 4: Client-Side

### Task 9: Toast Component

**Goal:** Lightweight toast notification component for merge and error messages.

**Files:**
- Create: `src/components/toast.tsx`
- Create: `src/components/toast.test.tsx`

**Dependencies:** None (can run in parallel with all other tasks)

**Step 1: Write tests**

Use `// @vitest-environment jsdom` at the top of the test file.

Test cases:
- Renders message text when shown
- Auto-dismisses after 5 seconds (use `vi.useFakeTimers()`)
- Does not render when no message

```typescript
// @vitest-environment jsdom
// ABOUTME: Tests for the Toast notification component.
// ABOUTME: Verifies rendering, auto-dismiss timing, and hidden state.
```

You'll need `@testing-library/react` for `render` and `screen`:
```typescript
import { render, screen } from "@testing-library/react";
```

**Step 2: Run tests to verify they fail**

**Step 3: Implement the Toast component**

Create a simple toast with React state. It should accept `message: string | null` and `onDismiss: () => void` props. When `message` is non-null, it renders. Auto-dismisses after 5000ms via `setTimeout` (clean up on unmount with `useEffect` return).

Styling: fixed position bottom-center, dark background (`bg-gray-800 text-white`), rounded, shadow, small text. Use Tailwind classes consistent with the codebase's style (see `src/components/` for class patterns).

**Step 4: Run tests, type-check, commit**

```bash
git add src/components/toast.tsx src/components/toast.test.tsx
git commit -m "feat: add Toast notification component"
```

---

### Task 10: AuthProvider Context

**Goal:** React context that manages login state, post-login merge, and exposes auth actions.

**READ FIRST:** Design doc sections "Auth State Detection" and "Post-Login Merge Trigger".

**Files:**
- Create: `src/components/auth-provider.tsx`
- Create: `src/components/auth-provider.test.tsx`
- Modify: `src/app/layout.tsx` (wrap children with AuthProvider)
- Read: `src/lib/favorites.ts` (for getFavorites, setFavorites to use during merge)

**Dependencies:** Tasks 5 (uses /me, /logout), 6 (uses /favorites/merge, /favorites), 9 (uses Toast)

**Step 1: Write tests**

Use `// @vitest-environment jsdom` at the top.

Test cases:
- On mount: calls `GET /api/auth/me`, exposes loading state
- Successful `/me` → sets `user` in context, `isLoggedIn = true`
- Failed `/me` (401) → sets `user = null`, `isLoggedIn = false`
- `signOut()` → calls `POST /api/auth/logout`, clears context
- `deleteAccount()` → calls `DELETE /api/user/account`, clears localStorage via `setFavorites([])`, clears context
- Detects `?justSignedIn=true` + localStorage has favorites → calls merge API, fetches favorites, shows toast
- Detects `?justSignedIn=true` + empty localStorage → skips merge, no toast
- Strips `?justSignedIn=true` from URL via `history.replaceState()`

Mock `fetch` globally for these tests. Mock `src/lib/favorites` for localStorage access.

**Step 2: Run tests to verify they fail**

**Step 3: Implement AuthProvider**

```typescript
"use client";
// ABOUTME: React context provider for authentication state.
// ABOUTME: Manages login detection, post-login merge, sign-out, and account deletion.
```

Key implementation details:
- Create `AuthContext` with `React.createContext`
- On mount (`useEffect`): fetch `/api/auth/me`, set user/loading state
- After `/me` succeeds, check for `?justSignedIn=true` in `window.location.search`
- If present AND `getFavorites().length > 0`:
  - POST `/api/user/favorites/merge` with `{ courseIds: getFavorites() }`
  - GET `/api/user/favorites` to get full list
  - Map server response to localStorage format: `setFavorites(favorites.map(f => ({ id: f.courseId, name: f.courseName })))`
  - If `merged > 0`, show toast: `"Synced ${merged} favorites from this device"`
- Strip ONLY the `justSignedIn` param (preserve any other query params):
  ```typescript
  const url = new URL(window.location.href);
  url.searchParams.delete("justSignedIn");
  history.replaceState({}, "", url.pathname + url.search);
  ```
- Expose: `user`, `isLoggedIn`, `isLoading`, `signOut()`, `deleteAccount()`
- `signOut()`: POST `/api/auth/logout`, set user to null
- `deleteAccount()`: DELETE `/api/user/account`, call `setFavorites([])`, set user to null, `window.location.href = "/"`

Export `useAuth()` hook: `const context = useContext(AuthContext); return context;`

**Toast integration:** AuthProvider owns toast state. Add `const [toastMessage, setToastMessage] = useState<string | null>(null)` to the provider. Render `<Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />` alongside `{children}` in the provider's return JSX. Call `setToastMessage("Synced N favorites from this device")` after a successful merge with `merged > 0`. The `useFavorites` hook also needs toast access for error messages — export a `showToast(message: string)` function via the auth context (or create a separate ToastContext if preferred, but keeping it in AuthProvider is simpler since there are only two toast messages in the app).

**Step 4: Update layout.tsx**

Wrap `{children}` with `<AuthProvider>` in `src/app/layout.tsx`. The AuthProvider must be inside the `<body>` tag.

**Important:** `layout.tsx` is currently a server component. Since AuthProvider is a client component, it can be used in a server component layout — React handles the boundary. Just import and wrap.

**Step 5: Run tests, type-check, commit**

```bash
git add src/components/auth-provider.tsx src/components/auth-provider.test.tsx src/app/layout.tsx
git commit -m "feat: add AuthProvider context with post-login merge and auth actions"
```

---

### Task 11: useFavorites Hook

**Goal:** React hook that abstracts localStorage vs server-backed favorites based on login state.

**READ FIRST:** Design doc section "Favorites Module Refactor".

**Files:**
- Create: `src/hooks/use-favorites.ts`
- Create: `src/hooks/use-favorites.test.ts`
- Read: `src/lib/favorites.ts` (for localStorage functions)
- Read: `src/components/auth-provider.tsx` (for useAuth)

**Dependencies:** Tasks 6 (favorites API), 10 (AuthProvider/useAuth)

**Step 1: Write tests**

Use `// @vitest-environment jsdom`.

Test cases:
- **Anonymous mode:** When `useAuth()` returns `isLoggedIn: false`, hook delegates to localStorage functions. No fetch calls.
- **Logged-in mode:** When `useAuth()` returns `isLoggedIn: true`:
  - On mount: reads localStorage for instant data, fetches `GET /api/user/favorites` in background, updates state + localStorage with server response
  - `toggleFavorite(id, name)` when not favorited: optimistic add to state + localStorage, fires `POST /api/user/favorites/:id`, keeps change on success
  - `toggleFavorite(id, name)` when already favorited: optimistic remove, fires `DELETE /api/user/favorites/:id`, keeps change on success
  - `toggleFavorite` failure: rolls back state + localStorage to previous value, shows error toast "Couldn't save — try again" via `showToast` from auth context
- `isFavorite(id)`: returns true/false based on current state

Mock `useAuth` by mocking the auth-provider module:
```typescript
vi.mock("@/components/auth-provider", () => ({
  useAuth: vi.fn(),
}));
```

**Step 2: Run tests to verify they fail**

**Step 3: Implement useFavorites**

```typescript
"use client";
// ABOUTME: React hook for favorites management that works in both anonymous and logged-in modes.
// ABOUTME: Anonymous mode uses localStorage directly; logged-in mode syncs with server API.
```

The hook should:
1. Call `useAuth()` to get `isLoggedIn`
2. Maintain `favorites: string[]` and `favoriteDetails: FavoriteEntry[]` in state
3. Initialize from localStorage on first render (both modes)
4. In logged-in mode: useEffect to fetch `GET /api/user/favorites`, replace local state + localStorage
5. `toggleFavorite`: in anonymous mode, call localStorage functions directly and update state; in logged-in mode, do optimistic update + API call + rollback on failure + call `showToast("Couldn't save — try again")` from auth context on failure
6. `isFavorite`: check `favorites.includes(courseId)`

**Important:** Import from `@/lib/favorites` for `getFavorites`, `getFavoriteDetails`, `setFavorites`, `toggleFavorite as localToggleFavorite`, `isFavorite as localIsFavorite`. Rename to avoid conflicts with the hook's own methods.

**Step 4: Run tests, type-check, commit**

```bash
git add src/hooks/use-favorites.ts src/hooks/use-favorites.test.ts
git commit -m "feat: add useFavorites hook with anonymous and server-backed modes"
```

---

### Task 12: Nav Bar Auth UI

**Goal:** Add sign-in link (anonymous) or user dropdown (logged-in) to the nav bar.

**Files:**
- Modify: `src/components/nav.tsx`
- Read: `src/components/auth-provider.tsx` (for useAuth)

**Dependencies:** Task 10 (AuthProvider/useAuth)

**Step 1: Read the current nav.tsx**

Currently a server component with just logo/wordmark. Will need to become a client component (or extract the auth UI into a separate client component imported by the server nav).

**Recommended approach:** Create a `NavAuthArea` client component (`src/components/nav-auth-area.tsx`) that uses `useAuth()`, and import it into `nav.tsx`. This keeps `nav.tsx` as a server component where possible.

**Step 2: Implement NavAuthArea**

```typescript
"use client";
// ABOUTME: Auth UI area for the nav bar showing sign-in or user dropdown.
// ABOUTME: Reads auth state from AuthProvider context.
```

Features:
- Logged out: "Sign in" link pointing to `/api/auth/google` (include `?returnTo=${currentPath}` via `usePathname()`)
- Logged in: Circle with first letter of user's name, click opens dropdown
- Dropdown: "Sign out" button (calls `signOut()`), "Delete account" button (shows confirmation, then calls `deleteAccount()`)
- Confirmation dialog for account deletion: simple conditional render (not a modal library). Text: "Delete your account? Your favorites and booking history will be permanently removed." with "Cancel" and "Delete" buttons.
- Dropdown closes when clicking outside (use `useRef` + `useEffect` click handler)

**Styling:** Match existing nav bar patterns. The nav uses `bg-[#1a2425]` dark theme with white text. Use `text-white hover:underline` for the sign-in link. User circle: small `w-8 h-8 rounded-full bg-white text-gray-900 flex items-center justify-center text-sm font-medium`.

**Step 3: Import NavAuthArea in nav.tsx**

Add `<NavAuthArea />` to the right side of the nav bar (after the existing logo/wordmark content).

**Step 4: Run type-check, visually verify with `npm run dev`**

**Step 5: Commit**

```bash
git add src/components/nav-auth-area.tsx src/components/nav.tsx
git commit -m "feat: add auth UI to nav bar with sign-in link and user dropdown"
```

---

### Task 13: Component Migrations + Booking Click Integration

**Goal:** Migrate existing components from direct localStorage calls to `useFavorites()` hook, and add booking click tracking.

**READ FIRST:** Design doc sections "Migration path for existing components" and "Booking Click Tracking".

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/courses/[id]/page.tsx`
- Modify: `src/components/course-header.tsx`
- Modify: `src/components/tee-time-list.tsx` (or wherever the "Book" link lives)

**Dependencies:** Tasks 11 (useFavorites), 12 (nav bar), 7 (booking clicks API)

**Step 1: Read the files to migrate**

Read each file to understand the current favorites usage:
- `page.tsx`: calls `getFavorites()`, `getFavoriteDetails()`, `setFavorites()` directly
- `courses/[id]/page.tsx`: may import favorites functions
- `course-header.tsx`: calls `toggleFavorite()`, `isFavorite()`

**Step 2: Migrate page.tsx**

Replace direct localStorage calls with `useFavorites()` hook:
- Remove imports from `@/lib/favorites`
- Add `import { useFavorites } from "@/hooks/use-favorites"`
- Replace `getFavorites()` with `favorites` from the hook
- Replace `getFavoriteDetails()` with `favoriteDetails` from the hook
- Replace `setFavorites(...)` with the hook's toggle/state management
- Handle `isLoading` state from the hook

**Step 3: Migrate courses/[id]/page.tsx**

Same pattern — replace direct localStorage calls with the hook.

**Step 4: Migrate course-header.tsx**

Replace `toggleFavorite(id, name)` and `isFavorite(id)` calls with the hook's versions. Key changes:
- **Remove the local `useState` for `favorited`** — the hook manages favorites state. Use `isFavorite(course.id)` from the hook instead.
- **Remove `setFavorited(!favorited)`** — the hook's `toggleFavorite` updates state internally.
- The hook's `toggleFavorite` is async (returns `Promise<void>`) while the current one is sync — update the click handler to be async.

**Step 5: Add booking click tracking**

The "Book" link is in `src/components/tee-time-list.tsx` — it's an `<a>` tag with `target="_blank"`. Add an `onClick` handler that fires `sendBeacon` before the browser navigates. Do NOT prevent default or change the `<a>` to a `<button>` — the link must continue to work as-is:

```tsx
<a
  href={tt.booking_url}
  target="_blank"
  rel="noopener noreferrer"
  onClick={() => {
    if (isLoggedIn) {
      navigator.sendBeacon(
        "/api/user/booking-clicks",
        new Blob([JSON.stringify({ courseId: tt.course_id, date: tt.date, time: tt.time })], { type: "application/json" })
      );
    }
  }}
  className="..."
>
  Book
</a>
```

Get `isLoggedIn` from `useAuth()` at the top of the `TeeTimeList` component. Import `useAuth` from `@/components/auth-provider`.

**Important:** `sendBeacon` sends cookies for same-origin requests, so the JWT cookie will be included automatically. No special handling needed.

**Step 6: Run existing tests**

```bash
npm test
```

Verify no regressions. The favorites.test.ts tests should still pass since the underlying module is unchanged.

**Step 7: Run type-check and lint**

```bash
npx tsc --noEmit && npm run lint
```

**Step 8: Commit**

```bash
git add src/app/page.tsx src/app/courses/ src/components/course-header.tsx src/components/tee-time-list.tsx
git commit -m "feat: migrate components to useFavorites hook and add booking click tracking"
```

---

## Phase 5: Finalize

### Task 14: CLAUDE.md Updates + Final Verification

**Goal:** Update project documentation and run full verification.

**READ FIRST:** Design doc section "Appendix: CLAUDE.md Updates After Implementation".

**Files:**
- Modify: `CLAUDE.md`

**Dependencies:** All previous tasks

**Step 1: Update CLAUDE.md**

Add these items per the design doc appendix:
- **Gotcha: Never hard-delete courses** — CASCADE would destroy `booking_clicks` history. Use `is_active = 0`.
- **Gotcha: Auth uses `authenticateRequest()` utility, not Next.js middleware** — middleware can't reliably access D1 on OpenNext/CF Workers.
- **Convention: `.dev.vars`** for local secrets. Already gitignored.
- **Convention: Cookie prefix `tct-`** for all app cookies.
- Update `env.d.ts` reference in Conventions to note secret bindings.
- Update **Project Layout** to include new files/directories.
- Update **Tech Stack** to add `arctic` (OAuth) and `jose` (JWT).

**Step 2: Run full verification**

```bash
npx tsc --noEmit    # Type-check
npm test            # All tests
npm run lint        # ESLint
npm run build       # Production build
```

All four must pass.

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with auth conventions and project layout"
```

**Step 4: Run `npm run preview` for local smoke test**

Verify the app loads, favorites work in anonymous mode, and the sign-in link appears in the nav.

---

## Subagent Risk Summary

These are the areas most likely to cause subagent failures. Review carefully during code review:

| Risk | Task | Mitigation in this plan |
|------|------|------------------------|
| authenticateRequest gets refresh flow wrong | 2 | Complete implementation provided with all D1 queries |
| OAuth callback misses a step in the 13-step flow | 4 | Step-by-step checklist with SQL and cookie operations |
| Route handler forgets to merge auth headers into response | 3-7 | Authenticated Route Handler Pattern shown in Critical Context |
| D1 mock inconsistencies across test files | All | Shared `src/test/d1-mock.ts` helper |
| Missing ABOUTME comments | All | Reminded in Critical Context + every task |
| Toast/AuthProvider rendered outside client boundary | 10 | Explicit note about `"use client"` directive |
| useFavorites hook returns stale data after mode switch | 11 | Explicit initialization flow: localStorage first, then server fetch |
| returnTo validation misses `//` or `\` vectors | 3 | Explicit validation function with all rejection cases |
| Merge flow triggered by wrong component | 10, 11 | Explicit note: AuthProvider owns merge, hook owns CRUD |
| `process.env` used instead of `getCloudflareContext()` | All | Called out in Critical Context, repeated in relevant tasks |
| Cookie `Secure` flag breaks localhost | 2, 4 | Conditional on `request.url.startsWith("https://")` |
| `?justSignedIn=true` appended with string concat | 4 | Explicit: use `new URL()` to handle existing query params |
| vitest config doesn't discover `.test.tsx` files | 9, 10, 11 | Task 1 updates vitest include to `["src/**/*.test.{ts,tsx}"]` |
| `validateReturnTo` duplicated across files | 3, 4 | Explicitly exported from `auth.ts`, not defined locally |
| Query param strip removes all params | 10 | Explicit URL manipulation to only delete `justSignedIn` |
| Toast state management unclear for AuthProvider | 10, 11 | Explicit: AuthProvider owns toast state, renders Toast component |
