# API Routes Test Coverage Report

**Date:** 2026-03-09
**Scope:** All 4 API route files in `src/app/api/`
**Test files found:** 0

---

## File 1: `src/app/api/courses/route.ts`

### `GET()` (lines 4-24)

| # | Code Path | Line(s) | Test Status | Severity |
|---|-----------|---------|-------------|----------|
| 1 | Happy path: returns all courses with poll info | 8-23 | GAP | correctness |
| 2 | Empty courses table returns empty array | 21-23 | GAP | correctness |
| 3 | LEFT JOIN poll_log: course with no poll history shows null last_polled | 14-21 | GAP | correctness |
| 4 | ROW_NUMBER window function returns only latest poll per course | 19-20 | GAP | correctness |
| 5 | Results ordered by course name | 19 | GAP | nice-to-have |
| 6 | DB query throws error (unhandled — no try/catch) | 8-21 | GAP | correctness |

**Security checklist:**
| Check | Status | Notes |
|-------|--------|-------|
| Unauthenticated access | No auth — public endpoint, acceptable for read-only course list | |
| Input validation | No user input accepted | |
| SQL parameterization | No user input in query — safe | |
| Fail-closed | No error handling; unhandled DB exception bubbles to framework 500 | GAP |

---

## File 2: `src/app/api/courses/[id]/route.ts`

### `GET()` (lines 4-33)

| # | Code Path | Line(s) | Test Status | Severity |
|---|-----------|---------|-------------|----------|
| 1 | Happy path: course found, returns course with poll info | 12-32 | GAP | correctness |
| 2 | Course not found: returns 404 | 28-29 | GAP | correctness |
| 3 | LEFT JOIN poll_log: course with no poll history | 14-22 | GAP | correctness |
| 4 | `id` param is arbitrary string — no format validation | 8 | GAP | security-critical |
| 5 | SQL injection via `id` param (parameterized — safe, but no test proves it) | 25 | GAP | security-critical |
| 6 | DB query throws error (unhandled — no try/catch) | 12-26 | GAP | correctness |

**Security checklist:**
| Check | Status | Notes |
|-------|--------|-------|
| Unauthenticated access | No auth — public read-only, acceptable | |
| Input validation | `id` is unvalidated string from URL path — no format check | GAP |
| SQL parameterization | Uses `?` bind for `id` — safe by construction | Needs test to prove |
| Fail-closed | No error handling; unhandled DB exception bubbles | GAP |

---

## File 3: `src/app/api/courses/[id]/refresh/route.ts`

### `POST()` (lines 6-56)

| # | Code Path | Line(s) | Test Status | Severity |
|---|-----------|---------|-------------|----------|
| 1 | Happy path: course found, no recent poll, pollCourse runs, returns 200 | 53-55 | GAP | correctness |
| 2 | Course not found: returns 404 | 20-22 | GAP | correctness |
| 3 | Date from query param (explicit date provided) | 26-27 | GAP | correctness |
| 4 | Date defaults to today when no param | 27 | GAP | correctness |
| 5 | Invalid date format: returns 400 | 29-34 | GAP | security-critical |
| 6 | Valid format but nonsensical date (e.g. `9999-99-99`) passes regex | 29 | GAP | correctness |
| 7 | Recent poll exists (30s cache): returns "Recently refreshed" | 46-51 | GAP | correctness |
| 8 | No recent poll: proceeds to pollCourse | 53 | GAP | correctness |
| 9 | `id` param is arbitrary string — no format validation | 10 | GAP | security-critical |
| 10 | SQL injection via `id` param (parameterized — safe, but no test proves it) | 17, 43 | GAP | security-critical |
| 11 | SQL injection via `date` param (parameterized — safe, but no test proves it) | 43 | GAP | security-critical |
| 12 | pollCourse throws error (unhandled — no try/catch in route) | 53 | GAP | correctness |
| 13 | Rate-limit bypass: multiple rapid requests before poll_log write completes (TOCTOU) | 37-53 | GAP | security-critical |
| 14 | Date regex allows leading/trailing content via partial match? No — `^...$` anchored, safe | 29 | N/A (safe) | — |

**Security checklist:**
| Check | Status | Notes |
|-------|--------|-------|
| Unauthenticated access | No auth on POST — anyone can trigger upstream API calls | GAP (security-critical) |
| Input validation | `date` regex-validated; `id` unvalidated | Partial |
| SQL parameterization | All user inputs use `?` binds — safe by construction | Needs tests to prove |
| Fail-closed | No error handling around `pollCourse`; upstream adapter failure crashes request | GAP |

---

## File 4: `src/app/api/tee-times/route.ts`

### `GET()` (lines 4-67)

| # | Code Path | Line(s) | Test Status | Severity |
|---|-----------|---------|-------------|----------|
| 1 | Happy path: date provided, no filters, returns tee times | 25-66 | GAP | correctness |
| 2 | Missing date param: returns 400 | 11-16 | GAP | correctness |
| 3 | Invalid date format: returns 400 | 11-16 | GAP | security-critical |
| 4 | `courses` filter: single course ID | 33-37 | GAP | correctness |
| 5 | `courses` filter: multiple comma-separated IDs | 33-37 | GAP | correctness |
| 6 | `courses` filter: empty string after split (`.filter(Boolean)`) | 19 | GAP | correctness |
| 7 | `startTime` filter applied | 39-42 | GAP | correctness |
| 8 | `endTime` filter applied | 44-47 | GAP | correctness |
| 9 | `holes` filter: value "9" | 49-52 | GAP | correctness |
| 10 | `holes` filter: value "18" | 49-52 | GAP | correctness |
| 11 | `holes` filter: invalid value (e.g. "36") — silently ignored | 49 | GAP | correctness |
| 12 | `minSlots` filter applied | 54-57 | GAP | correctness |
| 13 | `minSlots` with non-numeric value — `parseInt` returns NaN, query breaks | 56 | GAP | security-critical |
| 14 | All filters combined | 33-57 | GAP | correctness |
| 15 | No tee times found: returns empty array | 61-66 | GAP | correctness |
| 16 | SQL injection via `courses` param (parameterized — safe, but no test) | 35-36 | GAP | security-critical |
| 17 | SQL injection via `startTime` param (parameterized — safe, but no test) | 41 | GAP | security-critical |
| 18 | SQL injection via `endTime` param (parameterized — safe, but no test) | 46 | GAP | security-critical |
| 19 | SQL injection via `minSlots` param (parameterized — safe, but no test) | 56 | GAP | security-critical |
| 20 | SQL injection via `date` param (parameterized — safe, but no test) | 31 | GAP | security-critical |
| 21 | Dynamic query construction: verify IN clause with 0 courses doesn't produce invalid SQL | 33-37 | GAP | correctness |
| 22 | DB query throws error (unhandled — no try/catch) | 61 | GAP | correctness |
| 23 | `startTime`/`endTime` with malformed values (no validation) | 39-47 | GAP | security-critical |
| 24 | `courses` param with excessively long list (DoS via large IN clause) | 34-36 | GAP | security-critical |

**Security checklist:**
| Check | Status | Notes |
|-------|--------|-------|
| Unauthenticated access | No auth — public read-only, acceptable | |
| Input validation | Only `date` is validated; `startTime`, `endTime`, `minSlots`, `courses` are unvalidated | GAP |
| SQL parameterization | All values use `?` binds — safe by construction | Needs tests |
| Fail-closed | No error handling; DB exceptions bubble to framework | GAP |

---

## What's Well-Covered

- Nothing. There are zero test files for any API route. Coverage is 0%.

---

## Gap Summary by Severity

### Security-Critical: 14 gaps

| # | File | Description |
|---|------|-------------|
| 1 | `courses/[id]/route.ts` | No test proving `id` param is safe against SQL injection |
| 2 | `courses/[id]/route.ts` | No input format validation on `id` path parameter |
| 3 | `courses/[id]/refresh/route.ts` | No auth on POST endpoint — anyone can trigger upstream API calls at will |
| 4 | `courses/[id]/refresh/route.ts` | No test proving `id` param is safe against SQL injection |
| 5 | `courses/[id]/refresh/route.ts` | No input format validation on `id` path parameter |
| 6 | `courses/[id]/refresh/route.ts` | No test proving `date` param is safe against SQL injection |
| 7 | `courses/[id]/refresh/route.ts` | Invalid date format rejection (400) is untested |
| 8 | `courses/[id]/refresh/route.ts` | TOCTOU race condition in 30-second poll cache check |
| 9 | `tee-times/route.ts` | Missing/invalid `date` rejection (400) is untested |
| 10 | `tee-times/route.ts` | No test proving `courses` param is safe against SQL injection |
| 11 | `tee-times/route.ts` | No test proving `startTime` param is safe against SQL injection |
| 12 | `tee-times/route.ts` | No test proving `endTime` param is safe against SQL injection |
| 13 | `tee-times/route.ts` | No test proving `minSlots` param is safe against SQL injection |
| 14 | `tee-times/route.ts` | No test proving `date` param is safe against SQL injection |
| 15 | `tee-times/route.ts` | `startTime`/`endTime` accept arbitrary strings with no format validation |
| 16 | `tee-times/route.ts` | `courses` param with excessively long list could create unbounded IN clause |
| 17 | `tee-times/route.ts` | `minSlots` with non-numeric value passes NaN to query |

### Correctness: 25 gaps

| # | File | Description |
|---|------|-------------|
| 1 | `courses/route.ts` | Happy path (all courses returned) untested |
| 2 | `courses/route.ts` | Empty table behavior untested |
| 3 | `courses/route.ts` | LEFT JOIN with no poll history untested |
| 4 | `courses/route.ts` | ROW_NUMBER returns only latest poll untested |
| 5 | `courses/route.ts` | Unhandled DB exception (no try/catch) |
| 6 | `courses/[id]/route.ts` | Happy path (single course) untested |
| 7 | `courses/[id]/route.ts` | 404 on missing course untested |
| 8 | `courses/[id]/route.ts` | LEFT JOIN with no poll history untested |
| 9 | `courses/[id]/route.ts` | Unhandled DB exception (no try/catch) |
| 10 | `courses/[id]/refresh/route.ts` | Happy path (refresh triggers poll) untested |
| 11 | `courses/[id]/refresh/route.ts` | 404 on missing course untested |
| 12 | `courses/[id]/refresh/route.ts` | Explicit date param path untested |
| 13 | `courses/[id]/refresh/route.ts` | Default-to-today date path untested |
| 14 | `courses/[id]/refresh/route.ts` | Valid-format but nonsensical date (e.g. `9999-99-99`) accepted |
| 15 | `courses/[id]/refresh/route.ts` | 30-second cache hit path untested |
| 16 | `courses/[id]/refresh/route.ts` | pollCourse error propagation (no try/catch) |
| 17 | `tee-times/route.ts` | Happy path (date only, no filters) untested |
| 18 | `tee-times/route.ts` | Single course filter untested |
| 19 | `tee-times/route.ts` | Multiple course filter untested |
| 20 | `tee-times/route.ts` | Empty courses after `.filter(Boolean)` untested |
| 21 | `tee-times/route.ts` | startTime filter untested |
| 22 | `tee-times/route.ts` | endTime filter untested |
| 23 | `tee-times/route.ts` | holes=9 and holes=18 each untested |
| 24 | `tee-times/route.ts` | Invalid holes value silently ignored — untested |
| 25 | `tee-times/route.ts` | minSlots filter untested |
| 26 | `tee-times/route.ts` | All filters combined untested |
| 27 | `tee-times/route.ts` | Empty results untested |
| 28 | `tee-times/route.ts` | Unhandled DB exception (no try/catch) |

### Nice-to-Have: 1 gap

| # | File | Description |
|---|------|-------------|
| 1 | `courses/route.ts` | ORDER BY name behavior untested |

---

## Key Observations

### Cross-Cutting Patterns

1. **Zero test coverage across all API routes.** No route handler has a single test. This is the most fundamental gap — everything below is secondary.

2. **No error handling in any route.** None of the 4 route files have try/catch blocks. If a DB query fails or `pollCourse` throws, the error bubbles unhandled to the framework, which will return a generic 500. This means error messages from D1 or upstream adapters could leak to clients.

3. **No authentication or rate limiting on POST `/refresh`.** This endpoint triggers live upstream API calls to third-party booking platforms. Without auth or meaningful rate limiting (the 30-second TOCTOU cache is bypassable), any client can hammer upstream APIs, potentially getting the app's IP blocked or violating rate limits.

### Input Validation Gaps

4. **`tee-times/route.ts` validates only `date`** — the `startTime`, `endTime`, `minSlots`, and `courses` parameters are passed through with zero validation. While SQL injection is prevented by parameterized queries, `parseInt(minSlots)` on a non-numeric string yields `NaN`, which will produce unexpected query behavior.

5. **`id` path parameters are never validated** in either `courses/[id]` or `courses/[id]/refresh`. While parameterized queries prevent injection, there is no format check to reject obviously invalid IDs early.

6. **Date validation accepts syntactically valid but semantically invalid dates** like `9999-99-99` — the regex `^\d{4}-\d{2}-\d{2}$` checks format but not calendar validity.

### SQL Safety

7. **All SQL queries use parameterized bindings (`?`)** — this is good. No string interpolation of user input into SQL. The dynamic IN clause in `tee-times/route.ts` is constructed safely (placeholder generation from array length, values bound separately). However, none of this is verified by tests.

8. **The `tee-times` dynamic query builder** constructs SQL by concatenation but only interpolates `?` placeholders, never user values. The `courses` IN clause builds placeholders from `courseIds.length`, which is safe — but an unbounded number of course IDs could create an excessively large query.

### Totals

| Severity | Count |
|----------|-------|
| Security-Critical | 17 |
| Correctness | 28 |
| Nice-to-Have | 1 |
| **Total** | **46** |
