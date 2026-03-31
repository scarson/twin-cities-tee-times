# Testing Pitfalls

Test scenario checklist for reviewing coverage of any feature. Every item on this list exists because it catches bugs that have occurred in real codebases. Items marked with **🔥 Found in bug hunts** were discovered in *this* codebase specifically. Unmarked items are equally important — they represent bugs we haven't made *yet*. Do not deprioritize an item because it lacks a marker.

---

## 1. Silent Failure & Error Swallowing

Silent error swallowing is the #1 bug category in this codebase — multiple independent analyses flagged it. Every error path must be tested explicitly.

- [ ] **Adapter failures must be distinguishable from empty results:** When a platform adapter encounters a network error, HTTP error, or auth failure, it must not return `[]` — the caller cannot distinguish "no tee times today" from "API is down." Test that adapter errors propagate as exceptions or typed error results, not empty arrays. **🔥 Found in bug hunts:** Both CPS Golf and ForeUp adapters returned `[]` on all error paths — network failures, HTTP 4xx/5xx, JSON parse errors. The poller logged these as `"no_data"` making failures invisible.
- [ ] **Error states, not blank pages:** When a `fetch()` call fails, the component must render an error message — never a blank page or empty list that looks like "no results." Test every data-fetching component with a mocked network error and assert that an error element is visible. **🔥 Found in bug hunts:** Home page `catch` block set `setTeeTimes([])`, wiping previously-displayed results on any fetch failure.
- [ ] **Partial failure in multi-fetch flows:** When `Promise.all` fetches multiple resources, test that a failure in one fetch doesn't destroy already-loaded data. A user who has Monday's tee times displayed shouldn't lose them because Tuesday's fetch failed. **🔥 Found in bug hunts:** `Promise.all` failure in home page and course page cleared all tee times.
- [ ] **Double-fault in error handlers:** When a `catch` block itself performs fallible operations (logging to DB, sending metrics), test the path where the error handler also throws. The outer caller must not get an unhandled exception. **🔥 Found in bug hunts:** `pollCourse` catch block called `logPoll` which could also throw, creating an unhandled double-fault in the refresh endpoint.
- [ ] **Error propagation across layers:** When an internal function returns an error, trace it through the API route handler to the HTTP response. Test that the handler doesn't swallow the error and return 200. Inject D1 errors and verify the HTTP status reflects the failure.

## 2. Timezone & Date Handling

This app is Central Time everywhere. Every date operation must be tested for timezone correctness — especially the seam between server-side (CT-aware) and client-side (UTC-defaulting) code.

- [ ] **UTC vs local time in date formatting:** When converting `Date` objects to date strings, test at 11 PM Central Time. `toISOString().split("T")[0]` returns the UTC date, which is tomorrow after ~6-7 PM CT. Any function that formats "today" must use timezone-aware formatting, not `toISOString()`. **🔥 Found in bug hunts:** `toDateStr()` used `toISOString()`, causing "Today" button to show tomorrow's date for ~5 hours every evening. Same pattern in home page and course page initial date state.
- [ ] **Roundtrip consistency:** `toDateStr(fromDateStr(dateString))` must equal `dateString` for all dates, in all target timezones. When one direction uses local time and the other uses UTC, test around midnight and during DST transitions. **🔥 Found in bug hunts:** `fromDateStr` created local-time Dates, `toDateStr` used UTC — roundtrip was fragile near midnight and DST boundaries.
- [ ] **DST transition dates:** Test date arithmetic (`setDate(getDate() + 1)`) across the spring-forward and fall-back DST boundaries. A loop that increments by day using `setDate` on midnight-local Dates can skip or duplicate a day during DST transitions. **🔥 Found in bug hunts:** `datesInRange` in date-picker used `setDate` increments that could produce off-by-one during spring-forward.
- [ ] **Server-side date defaults:** When an API endpoint falls back to a default date (no query parameter), it must use `America/Chicago` timezone — not `new Date().toISOString()`. Test API calls without a date param at 8 PM CT. **🔥 Found in bug hunts:** Refresh endpoint defaulted to UTC date via `toISOString().split("T")[0]`.
- [ ] **Client-server date agreement:** Test that the client's "today" and the cron handler's "today" agree at every hour of the day. A timezone mismatch means the user requests tee times for a different date than the cron handler polled.
- [ ] **Date string format consistency:** When an adapter formats dates for an external API, test that the format matches the API's expectations for single-digit days (padded vs unpadded), month abbreviations, and day-of-week names. **🔥 Found in bug hunts:** `formatCpsDate` used `toLocaleDateString` which is implementation-defined per the ECMAScript spec — output could vary across JS engines.

## 3. Configuration Validation

- [ ] **Missing required config fields:** When an adapter requires platform-specific config (API keys, schedule IDs, facility IDs), test what happens when those fields are absent. The adapter must fail loudly — not silently return empty results forever. **🔥 Found in bug hunts:** 12 of 13 CPS Golf courses had no `apiKey`; Bunker Hills had no `scheduleId`. All silently returned `[]` on every poll, logging `"no_data"` indistinguishably from "no tee times available."
- [ ] **`platform_config` JSON validation:** When `JSON.parse(course.platform_config)` produces an object, test that adapter-required keys are present and have the expected types. A missing key should produce a clear error, not an `undefined` that silently propagates. **🔥 Found in bug hunts:** No validation of parsed `platform_config` — missing keys became `undefined` values passed to API calls.
- [ ] **Misconfigured vs inactive courses:** Test that the system distinguishes between "course is intentionally inactive" (`is_active = 0`) and "course is active but misconfigured." A misconfigured course should produce an actionable error, not burn cron cycles polling an API that will never respond.

## 4. Data Lifecycle & Unbounded Growth

- [ ] **Table growth bounds:** For any table that receives rows on a schedule (poll logs, click tracking), verify that a cleanup mechanism exists and is tested. Simulate weeks of data accumulation and verify that old rows are purged. **🔥 Found in bug hunts:** `poll_log` grew unboundedly — ~25K rows/day with no TTL, cleanup, or purge mechanism. D1 free tier has a 5GB storage limit.
- [ ] **Query performance with large tables:** When a query uses window functions or full-table scans, test with a realistic data volume. A query that's fast with 100 rows may be unusable with 100K rows. **🔥 Found in bug hunts:** `ROW_NUMBER() OVER (PARTITION BY course_id ORDER BY polled_at DESC)` scanned the entire `poll_log` table with no `WHERE` filter on the subquery.
- [ ] **Delete-then-insert atomicity:** When a function deletes existing records then inserts new ones, test the failure path where inserts fail after deletes succeed. If the operation isn't truly atomic, the delete may destroy data that the insert was supposed to replace. **🔥 Found in bug hunts:** `upsertTeeTimes` used `db.batch()` for delete+insert, but D1 batch behavior on partial failure could leave a course with no tee times.

## 5. Cron & Background Processing

- [ ] **Error isolation between iterations:** When a cron handler loops through multiple items, test that a failure on one item doesn't kill the loop for remaining items. Inject a D1 error on the 3rd of 10 courses and verify courses 4-10 still get polled. **🔥 Found in bug hunts:** A D1 error in `logPoll` or `upsertTeeTimes` propagated up through `pollCourse` uncaught, killing the entire cron loop for all remaining courses.
- [ ] **Error isolation within nested loops:** When a loop has an inner loop (e.g., courses × dates), test that a failure in one inner iteration doesn't skip the remaining inner iterations. The try/catch must be *inside* the inner loop, not wrapping it. **🔥 Found in bug hunts:** Active course polling wrapped all 7 dates in one try/catch — a D1 failure on date 2 silently skipped dates 3-7. A `logPoll` throw in the catch block or a `last_had_tee_times` update failure had the same effect.
- [ ] **Overlapping cron executions:** When a cron cycle could take longer than the cron interval, test that two simultaneous executions don't corrupt data. Two executions reading `poll_log` before either writes creates a TOCTOU window where both poll the same courses. **🔥 Found in bug hunts:** No protection against overlapping `runCronPoll` executions. With 80 courses planned, execution time approaches the 5-minute cron interval.
- [ ] **Dead poll detection:** When `shouldPollDate` gates whether to poll, test that its freshness check actually prevents redundant polls. If it always returns `true` for certain offsets, the freshness tracking is dead code for those dates. **🔥 Found in bug hunts:** `shouldPollDate` unconditionally returned `true` for today and tomorrow — `minutesSinceLastPoll` was ignored for these offsets.
- [ ] **Rate limit granularity vs operation scope:** When a rate limit protects a multi-dimensional resource (e.g., course × date), test that operations on one dimension don't block unrelated operations on another. A per-course cooldown that fires during cron polling of March 30 should not block a user's manual refresh for April 6. The rate limit scope must match the scope of the operation it protects. **🔥 Found in bug hunts:** Per-course refresh cooldown blocked user refreshes for dates the cron hadn't polled — the cron's poll for today's date consumed the cooldown, leaving the user unable to fetch data for dates outside the cron's 7-day window.
- [ ] **Worker timeout resilience:** Cloudflare Workers have execution time limits. Test that a cron handler that approaches the limit fails gracefully — partial results are persisted, and the next cycle picks up where it left off.
- [ ] **`ctx.waitUntil()` error visibility:** When `scheduled()` uses `ctx.waitUntil()`, errors inside the promise are swallowed by the runtime. Test that errors are logged before they disappear. A cron handler that silently fails every cycle is worse than one that doesn't exist.

## 6. External API Resilience

- [ ] **Rate limiting behavior:** When an external API returns 429 (rate limited), test that the adapter handles it differently from "no data." A rate-limited response should trigger backoff or retry — not log "no_data" as if the course has no tee times. **🔥 Found in bug hunts:** CPS Golf adapter treated 429 the same as any non-200 response — returned `[]`.
- [ ] **Paginated API responses:** When an external API paginates results, test that the adapter fetches ALL pages — not just page 1. An adapter that returns 24 of 48 results produces no errors and valid-looking data, making the bug invisible without comparing against the source. Test with: responses that span multiple pages, responses that fit exactly one page (boundary), and empty responses. Include a safety cap on page count to prevent infinite loops if the API misbehaves. **🔥 Found in bug hunts:** Chronogolf adapter only fetched page 1 (24 results), silently dropping ~half the tee times. Baker National had 47-48 tee times for a given day — users saw 24 in our app vs all of them on Chronogolf's site.
- [ ] **Malformed response handling:** Test adapters with truncated JSON, unexpected response shapes, and missing fields. An adapter that throws on malformed JSON is better than one that silently returns `[]`. At minimum, the error must be logged.
- [ ] **Timeout behavior:** Test adapter behavior when the external API is slow. A 30-second timeout on one API call can cascade through the cron handler, potentially causing the Worker to hit its execution limit.
- [ ] **Response validation:** When an adapter parses external API responses, test that it validates expected fields exist before accessing them. `tt.time.split("T")` on an undefined `time` field should not produce a silent `undefined` insertion into D1. **🔥 Found in bug hunts:** `upsertTeeTimes` did `tt.time.split("T")[1].substring(0, 5)` — if `tt.time` lacks "T", this produces `undefined`.

## 7. Client-Side State Management

- [ ] **Stale data on route param change:** When a page fetches data based on a route param (e.g., `/courses/[id]`), test that navigating to a different course triggers a new fetch — not a stale render of the previous course's data.
- [ ] **Component cleanup on unmount:** When a component sets a timeout or interval, test that navigating away before it fires doesn't cause state updates on an unmounted component. **🔥 Found in bug hunts:** `CourseHeader` set a 30-second cooldown timeout with no cleanup on unmount.
- [ ] **Type safety on API responses:** When component state is typed as `any`, test that the actual API response shape matches what the component expects. A renamed field produces a silent `undefined`, not a compile error. **🔥 Found in bug hunts:** Course page used `any` for course state and tee times arrays.
- [ ] **`localStorage` resilience:** When a feature reads from `localStorage` (favorites, preferences), test behavior when: (a) `localStorage` is unavailable (private browsing), (b) the stored value is malformed JSON, (c) the stored schema has changed between versions. The app must not crash.
- [ ] **Optimistic state + server divergence:** When the UI optimistically updates state (toggling a favorite, triggering a refresh), test that a failed server call rolls back the optimistic update — not leaves the UI in a state that disagrees with the server.
- [ ] **Empty filter returns all:** When a filter is active but the filter list is empty (e.g., "show favorites only" with zero favorites), test that the result is empty — not unfiltered. An empty `courses` parameter omitted from the API call may return all courses instead of none. **🔥 Found in bug hunts:** Favorites-only mode with 0 favorites skipped setting the `courses` query param, causing the API to return every course's tee times.
- [ ] **Sign-out state cleanup:** When a user signs out, test that server-synced state cached in localStorage is cleared. If it persists, a second user signing in on the same device inherits the previous user's data via any merge-on-login flow. **🔥 Found in bug hunts:** Sign-out left server favorites in localStorage. When user B signed in, user A's favorites were merged into user B's account.
- [ ] **New-device state sync:** When a returning user signs in on a new device (empty localStorage), test that server-side state is synced to the client. If the sync only runs when localStorage has data to merge, a new device with empty localStorage skips the sync entirely. **🔥 Found in bug hunts:** Server favorites were only synced to localStorage during the merge flow, which was gated on having local favorites to send — returning users on new devices saw no favorites.

## 8. Database & D1 Specifics

- [ ] **Parameterized queries only:** Every dynamic value in a SQL query must go through `.bind()`, never string interpolation. Even hardcoded constants should use `.bind()` to prevent copy-paste injection bugs. Test by auditing for template literals in SQL strings. **🔥 Found in bug hunts:** `rate-limit.ts` interpolated `COURSE_COOLDOWN_SECONDS` into SQL via template literal instead of `.bind()`.
- [ ] **D1 batch partial failure:** When using `db.batch()` for multi-statement operations, test the case where an early statement succeeds but a later one fails. Verify the operation is truly atomic — that a failed insert doesn't leave behind a successful delete.
- [ ] **Constraint cascade awareness:** When deleting or deactivating a course, test that cascading foreign keys don't destroy user data (favorites, booking clicks). The schema uses `ON DELETE CASCADE` — a hard delete of a course destroys all associated user data silently.
- [ ] **Migration version checks:** When the application checks schema version at startup or deploy, test that the expected version matches the latest migration. A stale version constant produces spurious warnings.

## 9. Security

- [ ] **Rate limit bypass:** When a rate limit uses check-then-insert (read count, then insert if under limit), test with concurrent requests that all read the same count before any insert. The rate limiter must use an atomic operation. **🔥 Found in bug hunts:** The refresh endpoint's rate limit reads `poll_log` then writes — concurrent requests could bypass the cooldown.
- [ ] **Auth bypass on API routes:** When an API route requires authentication (`authenticateRequest()`), test that unauthenticated requests receive 401 and that the route never falls through to the happy path. Test with: no cookie, expired token, malformed token.
- [ ] **CSRF on mutation endpoints:** When a POST/PUT/DELETE endpoint modifies data, test that it validates the request origin or includes CSRF protection. An unauthenticated POST to `/api/courses/[id]/refresh` shouldn't be callable from any origin.
- [ ] **Cookie security attributes:** Test that session cookies are set with `Secure`, `HttpOnly`, `SameSite=Lax` (or `Strict`). Missing attributes weaken auth security.
- [ ] **JWT validation thoroughness:** Test that JWTs are validated for: algorithm (`alg` claim matches expected), expiration, issuer, and signature. A JWT with `alg: "none"` must be rejected.
- [ ] **Error detail leakage in redirects:** When an OAuth or auth error triggers a redirect, test that internal error details (D1 errors, stack traces, exception messages) are not included in the redirect URL. Error details in URLs appear in browser history, referrer headers, and analytics. Use generic error codes, not `String(err)`. **🔥 Found in bug hunts:** OAuth callback appended raw `String(err)` — including potential SQL error details — as a `detail` query param in the redirect URL.
- [ ] **Token rotation under concurrent requests:** When multiple concurrent requests hit an expired JWT, test that exactly one successfully rotates the token and the others either succeed with the new token or fail gracefully with a retryable error. A `DELETE RETURNING` approach that makes losers see `user: null` must be paired with client-side retry logic. **🔥 Found in bug hunts:** Concurrent requests during JWT refresh: the winner rotated successfully, but the loser got 401 with no client-side retry — the user appeared logged out until page refresh.

## 10. Validation & Data Quality

- [ ] **Whitespace-only strings:** When a field is validated as "required" (course name, date parameter), test that whitespace-only strings (`"   "`) are rejected — not just empty strings (`""`). Use `.trim()` before checking.
- [ ] **Date parameter validation:** When an API accepts a date string parameter, test with: invalid format (`"not-a-date"`), past dates, dates far in the future, and empty string. The API should return 400 with a clear message — not a 500 from a downstream parse failure.
- [ ] **Numeric ID validation:** When a route parameter is a numeric ID (`/courses/[id]`), test with: non-numeric strings, negative numbers, zero, and very large numbers. The route should return 404 or 400 — not a D1 error.

## 11. Test Performance

- [ ] **Never use `shouldAdvanceTime` with fake timers:** `vi.useFakeTimers({ shouldAdvanceTime: true })` still advances time in near-real-time — each pending timer waits for a real event loop tick. With production code that calls `sleep(250)` between iterations, budget-exhaustion tests that create hundreds of polls wait through hundreds of real 250ms delays. Use plain `vi.useFakeTimers()` and flush timers programmatically. **🔥 Found in bug hunts:** `cron-handler.test.ts` took 156 seconds (98% of the entire suite) because `shouldAdvanceTime: true, advanceTimeDelta: 250` caused real-time waiting through ~170 sequential sleep calls per budget-exhaustion test.
- [ ] **Flush fake timers concurrently with async code under test:** When production code awaits `sleep()` internally (not called from test code), tests can't call `vi.advanceTimersByTimeAsync()` after `await`ing the function — the `await` never resolves because the timer never fires. Run a timer-flushing loop concurrently with the promise:
  ```typescript
  async function withTimers<T>(fn: () => Promise<T>): Promise<T> {
    let done = false;
    const promise = fn().finally(() => { done = true; });
    while (!done) {
      await vi.advanceTimersByTimeAsync(250);
    }
    return promise;
  }
  ```
  Then wrap calls: `await withTimers(() => runCronPoll(...))`. This resolves all pending timers instantly via microtasks instead of real-time delays.

## 12. Build & Deploy

- [ ] **Type-check coverage:** Run `npx tsc --noEmit` after every change. TypeScript errors that don't surface in `next dev` (which uses SWC and skips type-checking) can still break the CI build.
- [ ] **OpenNext compatibility:** Test that the production build (`npx @opennextjs/cloudflare build`) succeeds after changes. Features that work in `next dev` may not work on Cloudflare Workers (e.g., `process.env`, Node.js APIs, dynamic imports).
- [ ] **Environment binding availability:** When code accesses Cloudflare bindings (D1, secrets), test that it uses `getCloudflareContext()` — not `process.env`. A binding that works in `wrangler dev` via `process.env` will fail silently in production Workers.
