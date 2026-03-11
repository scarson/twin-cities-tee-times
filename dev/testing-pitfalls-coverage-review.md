# Testing Pitfalls Coverage Review

**Date:** 2026-03-11
**Scope:** All 55 checklist items in `dev/testing-pitfalls.md` reviewed against the 24 test files and all source code in the project.

---

## Executive Summary

| Status | Count | % |
|--------|-------|---|
| COVERED | 14 | 25% |
| PARTIAL | 13 | 24% |
| UNCOVERED | 27 | 49% |
| N/A | 1 | 2% |
| **Total** | **55** | |

The codebase has strong coverage in adapter error handling, timezone-aware date formatting, auth route protection, localStorage resilience, and CI/build verification. The largest gaps are in **page-level component tests** (no test files exist for `page.tsx` or `courses/[id]/page.tsx`), **API route tests** (no tests for `courses/route`, `courses/[id]/route`, `tee-times/route`, or `refresh/route`), **database layer tests** (no `db.ts` test file), and **security enforcement** (no CSRF, no concurrent rate-limit test).

---

## Section 1: Silent Failure & Error Swallowing

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1.1 | Adapter failures distinguishable from empty results | **COVERED** | All 3 adapters throw on errors. CPS Golf: "throws on token fetch failure", "throws on tee times HTTP error", "throws on network error". ForeUp: "throws on fetch error", "throws on non-200 response". TeeItUp: "throws on non-200 response", "throws on network error". |
| 1.2 | Error states, not blank pages | **UNCOVERED** | No test files exist for `page.tsx` or `courses/[id]/page.tsx`. Catch blocks log errors but don't set visible error state for the user. |
| 1.3 | Partial failure in multi-fetch flows | **UNCOVERED** | Both pages use `Promise.all`. No test verifies previously-loaded tee times survive a partial failure. |
| 1.4 | Double-fault in error handlers | **PARTIAL** | `pollCourse` catch calls `logPoll` which could throw. Structurally contained by outer try/catch in cron-handler and refresh route, but no test injects a `logPoll` failure to exercise this path. |
| 1.5 | Error propagation across layers | **PARTIAL** | `poller.test.ts` covers `pollCourse` → `"error"` return. Refresh route's HTTP 500 response on error is untested (no route test file). No D1 error injection test. |

## Section 2: Timezone & Date Handling

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 2.1 | UTC vs local time in date formatting | **COVERED** | `toDateStr` uses `toLocaleDateString("en-CA", { timeZone: "America/Chicago" })`. `format.test.ts` "returns Central Time date, not UTC, near midnight" tests at 04:30 UTC (11:30 PM CDT). Pages use `todayCT()`. |
| 2.2 | Roundtrip consistency | **PARTIAL** | `fromDateStr` anchors at noon UTC, `toDateStr` uses CT-aware formatting. Both halves tested individually but no explicit `toDateStr(fromDateStr(s)) === s` roundtrip assertion, no DST-boundary test. Implementation is correct by design (noon UTC anchor). |
| 2.3 | DST transition dates | **COVERED** | `datesInRange` uses `setUTCDate(getUTCDate() + 1)` — UTC arithmetic eliminates DST edge cases entirely. Month boundary tested in `date-picker.test.ts`. |
| 2.4 | Server-side date defaults | **PARTIAL** | Refresh route uses `toLocaleDateString("en-CA", { timeZone: "America/Chicago" })` — fixed from `toISOString()`. No test file for the route, so the fix is untested. |
| 2.5 | Client-server date agreement | **UNCOVERED** | No test verifies client `todayCT()` and cron handler date agree at any given hour. Both use the same `America/Chicago` pattern, but no cross-layer assertion exists. |
| 2.6 | Date string format consistency | **COVERED** | CPS adapter date format tested with URL pattern assertions. `en-CA` locale produces deterministic ISO 8601 format. |

## Section 3: Configuration Validation

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 3.1 | Missing required config fields | **COVERED** | All adapters throw on missing required config: CPS "throws when subdomain is missing", ForeUp "throws for courses with missing scheduleId", TeeItUp throws on missing alias/apiBase/facilityId. |
| 3.2 | `platform_config` JSON validation | **UNCOVERED** | No test exercises `JSON.parse(course.platform_config)` through `pollCourse` with malformed JSON, `null`, or empty object. Adapter-level validation is covered (3.1), but the `pollCourse` → `JSON.parse` → adapter path is untested. |
| 3.3 | Misconfigured vs inactive courses | **UNCOVERED** | No test distinguishes "misconfigured active course" from "intentionally inactive." A misconfigured course produces `"error"` poll logs but is indistinguishable from transient failures. No test verifies misconfigured courses don't get auto-deactivated by the 30-day rule. |

## Section 4: Data Lifecycle & Unbounded Growth

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 4.1 | Table growth bounds | **PARTIAL** | Cleanup SQL exists in `cron-handler.ts`: `DELETE FROM poll_log WHERE polled_at < datetime('now', '-7 days')`. The test suite checks for `DELETE FROM sessions` cleanup but never asserts `poll_log` cleanup is issued. A regression removing the cleanup would not be caught. |
| 4.2 | Query performance with large tables | **UNCOVERED** | `ROW_NUMBER()` queries now include a `WHERE polled_at > datetime('now', '-24 hours')` filter (bug fix). No route-level tests exist for `courses/route.ts` or `courses/[id]/route.ts`, so the filter is untested. No performance test. |
| 4.3 | Delete-then-insert atomicity | **UNCOVERED** | `upsertTeeTimes` uses `db.batch()`. No `db.ts` test file exists. `poller.test.ts` mocks `upsertTeeTimes` entirely, so D1 batch behavior is never exercised. No test for insert-fails-after-delete path. |

## Section 5: Cron & Background Processing

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 5.1 | Error isolation between iterations | **PARTIAL** | `cron-handler.test.ts` "continues probing other inactive courses after one throws" covers inactive course loop. Active course loop isolation is not explicitly tested (same pattern exists in source but no test). |
| 5.2 | Overlapping cron executions | **UNCOVERED** | No guard in source (no locking, no in-progress flag). No test simulating concurrent `runCronPoll` calls. |
| 5.3 | Dead poll detection | **COVERED** | `poller.test.ts` "always polls today and tomorrow" asserts `shouldPollDate(0, 0) === true` and `shouldPollDate(1, 0) === true`. Frequency thresholds for offsets 2-7 also tested. Intentional behavior documented. |
| 5.4 | Worker timeout resilience | **UNCOVERED** | No test simulates approaching Worker CPU limit. No timeout handling in source. With ~80 planned courses, execution time could exceed the limit. |
| 5.5 | `ctx.waitUntil()` error visibility | **UNCOVERED** | If initial DB query (`SELECT * FROM courses`) throws in `runCronPoll`, the exception propagates into `ctx.waitUntil()` where the runtime swallows it silently. No top-level try/catch in the cron handler. No test. |

## Section 6: External API Resilience

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 6.1 | Rate limiting / 429 handling | **UNCOVERED** | All adapters treat 429 identically to any non-200 response (throw generic HTTP error). No adapter test simulates a 429 specifically. No backoff or retry logic exists. |
| 6.2 | Malformed response handling | **PARTIAL** | Adapters throw on `response.json()` parse failure (correct behavior), but no test feeds truncated JSON. No test for valid JSON with unexpected shape (e.g., `{"error": "maintenance"}` instead of expected array/object). |
| 6.3 | Timeout behavior | **UNCOVERED** | No adapter sets a `fetch` timeout (`AbortSignal`). No test simulates a slow/hanging external API. Both a source gap and a test gap. |
| 6.4 | Response validation | **PARTIAL** | `db.ts` has a `time.includes("T")` guard for the split. But no test feeds `upsertTeeTimes` a tee time with missing/malformed `time`. Adapter-level field validation (null `time`, null `teetime`) untested. |

## Section 7: Client-Side State Management

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 7.1 | Stale data on route param change | **UNCOVERED** | Course page uses `useParams()` with `id` in `useCallback` deps (correct implementation). No test file exists for the page. |
| 7.2 | Component cleanup on unmount | **PARTIAL** | `CourseHeader` has `useEffect` cleanup clearing the cooldown timer. No test asserts the cleanup fires on unmount. |
| 7.3 | Type safety on API responses | **PARTIAL** | Course page state is now typed (the `any` was removed). Home page `teeTimes` state has no type annotation. No page-level tests exist. |
| 7.4 | `localStorage` resilience | **PARTIAL** | `favorites.test.ts` covers malformed JSON and legacy schema migration. Missing: `localStorage` unavailability test (private browsing / `getItem` throws). |
| 7.5 | Optimistic state + server divergence | **COVERED** | `use-favorites.test.ts` "toggleFavorite rolls back and shows toast on failure" — optimistic add, mocked 500, asserts rollback and error toast. |

## Section 8: Database & D1 Specifics

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 8.1 | Parameterized queries only | **PARTIAL** | `rate-limit.ts` interpolation is documented as intentional (SQLite datetime modifiers can't be parameterized). Test asserts the specific constant. No broader audit of `db.ts` SQL (no test file for `db.ts`). |
| 8.2 | D1 batch partial failure | **UNCOVERED** | No `db.ts` test file. `poller.test.ts` mocks `upsertTeeTimes`. No test for delete-succeeds-insert-fails. |
| 8.3 | Constraint cascade awareness | **UNCOVERED** | Schema uses `ON DELETE CASCADE` on `user_favorites` and `booking_clicks`. Convention says "never hard-delete courses" but no test enforces this. |
| 8.4 | Migration version checks | **N/A** | No version-tracking mechanism exists in this codebase. No startup check, no version constant. |

## Section 9: Security

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 9.1 | Rate limit bypass (concurrent) | **UNCOVERED** | `checkRefreshAllowed` uses check-then-insert pattern. All tests are serialized. No test for concurrent requests bypassing cooldown. |
| 9.2 | Auth bypass on API routes | **COVERED** | Every authenticated route has "returns 401 when not authenticated" test. `verifyJWT` tests cover no-cookie, expired, malformed, wrong-secret. |
| 9.3 | CSRF on mutation endpoints | **UNCOVERED** | No origin validation or CSRF token on any POST/DELETE route. No test. Refresh endpoint callable from any origin. |
| 9.4 | Cookie security attributes | **PARTIAL** | `cookieOptions()` in `auth.ts` sets Secure/HttpOnly/SameSite correctly. OAuth cookie tests check `HttpOnly`. Session cookie attribute values are not asserted in any test. |
| 9.5 | JWT validation thoroughness | **PARTIAL** | Tests cover: valid, expired, wrong-secret, garbage. `jose` library enforces algorithm binding by default. No explicit `alg: "none"` test. No issuer claim in implementation or test. |

## Section 10: Validation & Data Quality

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 10.1 | Whitespace-only strings | **UNCOVERED** | No route uses `.trim()` before required-field checks. Date regex incidentally rejects `"   "` but no test for it. |
| 10.2 | Date parameter validation | **PARTIAL** | `/api/tee-times` and `/api/courses/[id]/refresh` validate date with `/^\d{4}-\d{2}-\d{2}$/` and return 400. No test files exist for either route. Source is correct but untested. |
| 10.3 | Numeric ID validation | **UNCOVERED** | Course IDs are string slugs, not numeric. No format validation on `[id]` param before D1 query. No route tests. |

## Section 11: Build & Deploy

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 11.1 | Type-check coverage | **COVERED** | `tsconfig.json` strict mode. CI runs `npx tsc --noEmit` on every push/PR. `worker.ts` excluded intentionally (documented). |
| 11.2 | OpenNext compatibility | **COVERED** | CI runs `npx @opennextjs/cloudflare build` on every push/PR. Deploy workflow also runs the build. |
| 11.3 | Environment binding availability | **COVERED** | No `process.env` usage in `src/`. All routes use `getCloudflareContext()`. CI build would catch Workers-incompatible APIs. |

---

## Top Coverage Gaps (Prioritized)

### Tier 1: Missing test files (structural gaps)

These represent entire modules with zero test coverage. Any regression in these files is invisible.

| Missing test file | What it covers |
|-------------------|----------------|
| `src/lib/db.ts` | `upsertTeeTimes`, `logPoll` — all D1 write operations |
| `src/app/api/courses/route.ts` | Course listing API |
| `src/app/api/courses/[id]/route.ts` | Course detail API |
| `src/app/api/courses/[id]/refresh/route.ts` | User-triggered refresh |
| `src/app/api/tee-times/route.ts` | Main tee times query API |
| `src/app/page.tsx` | Home page (error handling, fetch logic) |
| `src/app/courses/[id]/page.tsx` | Course detail page |

### Tier 2: Security gaps

| Item | Risk |
|------|------|
| 9.3 CSRF on mutation endpoints | Refresh endpoint callable from any origin. No mitigation exists in source or tests. |
| 9.1 Rate limit bypass | Check-then-insert pattern allows concurrent bypass. Untested and unmitigated. |
| 9.4 Cookie security attributes | Session cookie attributes correct in source but not asserted in tests. |

### Tier 3: Resilience gaps

| Item | Risk |
|------|------|
| 6.3 Adapter timeout | No `AbortSignal` on fetch calls. A hanging external API could exhaust Worker CPU limit. |
| 5.5 `ctx.waitUntil()` error visibility | Top-level cron errors silently swallowed by Workers runtime. |
| 5.2 Overlapping cron executions | No guard against concurrent cron runs. Risk grows with course catalog size. |
| 4.3 D1 batch atomicity | Delete-then-insert could leave zero tee times on partial batch failure. |

### Tier 4: Correctness gaps (lower risk due to correct source)

| Item | Risk |
|------|------|
| 2.4 Refresh route default date | Source is correct (CT-aware) but has no regression test. |
| 4.1 poll_log cleanup | Cleanup SQL exists but no test asserts it runs. |
| 7.2 Component cleanup on unmount | Fix exists but no regression test. |
| 10.2 Date parameter validation | Source validates correctly but no route tests exist. |

---

## Appendix: Bug Hunt Findings (2026-03-11)

Three targeted bug hunts were run on code written or significantly rewritten since the last hunts (2026-03-09). Scoped to: auth system, cron/adapter changes (two-tier polling, CPS Golf v5, TeeItUp), and new client-side features.

### Hunt 1: Auth System (Holistic)

| # | Severity | Location | Description |
|---|----------|----------|-------------|
| A1 | **Medium** | `callback/route.ts:85-86,198-199` | Error details (including potential SQL/stack traces) leaked in redirect URL query params |
| A2 | **Low** | `callback/route.ts:36-40` | OAuth cookies not cleared when user cancels at Google consent screen |
| A3 | **Medium** | `auth.ts:117-122` | Token rotation race: losing concurrent request gets 401 with no client-side retry |
| A4 | **Low** | `account/route.ts:23-27` | Account deletion emits both set-token and clear-token cookies (functionally harmless, relies on browser ordering) |
| A5 | **Medium** | `auth-provider.tsx:55` | Server favorites never synced to localStorage on new-device sign-in (returning user sees no favorites) |
| A6 | **Low** | Schema + `auth.ts` | No periodic cleanup of expired sessions (only cleaned on use or login cap) |

### Hunt 2: Cron Handler & Adapters (Multipass)

| # | Severity | Location | Description |
|---|----------|----------|-------------|
| C1 | **High** | `courses.json:181` | Bunker Hills missing `scheduleId` — every poll throws, generates error noise, will eventually auto-deactivate |
| C2 | **Medium** | `poller.ts:76-79` | `logPoll` failure in catch block propagates up, skipping remaining dates for that course |
| C3 | **Medium** | `cron-handler.ts:92-117` | Per-course try/catch wraps ALL dates — one failure on any date skips remaining dates for that course |
| C4 | **Medium** | `cron-handler.ts:105-108` | `last_had_tee_times` update failure inside date loop skips remaining dates with misleading error message |
| C5 | **Low** | `poller.ts:25` | Comment says "Days 5-7" but code covers offsets 4-6 |
| C6 | **Low** | `db.ts` / `worker.ts` | Concurrent cron runs could briefly cause missing tee time data |
| C7 | **Low** | `cron-handler.ts:136` | `inactiveProbeCount` counts error probes, slightly misleading |

### Hunt 3: Client-Side Features (Exploratory)

| # | Severity | Location | Description |
|---|----------|----------|-------------|
| F1 | **Medium** | `page.tsx:85-88` | Favorites-only with 0 favorites fetches ALL courses instead of showing empty list |
| F2 | **Medium** | `auth-provider.tsx:102-105` | Sign-out leaves server favorites in localStorage — next sign-in merges previous user's favorites into new account |
| F3 | **Low** | `use-favorites.ts:19` | Brief visual flicker of unfavorited state on mount (hydration safety tradeoff) |
| F4 | **Low** | `auth-provider.tsx:122-130` | Context value object recreated every render, causing unnecessary consumer re-renders |
| F5 | **Low** | `page.tsx:133-136` | Share-accept toast count may be stale if user favorited courses while dialog was open |

### Cross-Hunt Themes

**Error granularity in cron handler (C2, C3, C4):** The most impactful cluster. The try/catch in the active course loop wraps all 7 dates, so any single failure — in `pollCourse`, `logPoll`, or `last_had_tee_times` update — aborts remaining dates. Moving the try/catch inside the date loop would make each date independent.

**Cross-account favorite leakage (A5, F2):** Related bugs. Server favorites are synced to localStorage on login but not cleared on logout. Combined with the merge-on-login flow, this creates a path where user A's favorites leak into user B's account on a shared device.

**Information disclosure (A1):** The OAuth callback appends raw error strings (potentially including D1 error details) to the redirect URL, making them visible in browser history, referrer headers, and analytics.
