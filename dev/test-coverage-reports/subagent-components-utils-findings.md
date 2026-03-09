# Components & Utils Test Coverage Report

Generated: 2026-03-09

---

## File: `src/components/tee-time-list.tsx`

### Test file: `src/components/tee-time-list.test.ts`

#### Function: `isStale(fetchedAt: string): boolean` (line 89–91, exported)

| Code Path | Line | Test Status | Severity |
|-----------|------|-------------|----------|
| Returns false when diff <= 75min | 90 | Covered (tests "just now" + "74 min ago") | — |
| Returns true when diff > 75min | 90 | Covered (tests "76 min ago" + "3 hours ago") | — |
| Threshold constant equals 75 min | 87 | Covered (explicit assertion) | — |

#### Function: `staleAge(fetchedAt: string): string` (line 93–98, NOT exported)

| Code Path | Line | Test Status | Severity |
|-----------|------|-------------|----------|
| hours < 24 → returns `"Xh old"` | 95 | GAP | correctness |
| hours >= 24 → returns `"Xd old"` | 97 | GAP | correctness |
| hours = 0 (just crossed stale threshold) → returns `"0h old"` | 95 | GAP | correctness |
| Boundary: hours = 23 → `"23h old"` | 95 | GAP | nice-to-have |
| Boundary: hours = 24 → `"1d old"` | 97 | GAP | nice-to-have |

Note: `staleAge` is not exported, so testing it requires either exporting it or testing through the component render.

#### Function: `formatTime(time: string): string` (line 100–106, NOT exported)

| Code Path | Line | Test Status | Severity |
|-----------|------|-------------|----------|
| AM time (hour < 12, e.g. "09:30") → `"9:30 AM"` | 103–105 | GAP | correctness |
| PM time (hour >= 12, e.g. "14:00") → `"2:00 PM"` | 103–105 | GAP | correctness |
| Noon (hour = 12) → `"12:00 PM"` | 103–104 | GAP | correctness |
| Midnight (hour = 0) → `"12:00 AM"` | 104 | GAP | correctness |
| hour = 13 → `"1:00 PM"` (first hour > 12 branch) | 104 | GAP | nice-to-have |

Note: `formatTime` is not exported, so testing it requires either exporting it or testing through the component render.

#### Component: `TeeTimeList` (line 23–85, exported)

| Code Path | Line | Test Status | Severity |
|-----------|------|-------------|----------|
| `loading=true` → renders "Loading tee times..." | 24–28 | GAP | correctness |
| `teeTimes.length === 0` → renders empty state | 30–40 | GAP | correctness |
| Renders tee time rows with correct data | 42–84 | GAP | correctness |
| Singular "spot" when `open_slots === 1` | 65 | GAP | correctness |
| Plural "spots" when `open_slots !== 1` | 65 | GAP | correctness |
| Price shown when `tt.price !== null` | 67 | GAP | correctness |
| Price hidden when `tt.price === null` | 67 | GAP | correctness |
| Stale badge shown when `isStale(fetched_at)` is true | 68–70 | GAP | correctness |
| Stale badge hidden when `isStale(fetched_at)` is false | 68 | GAP | nice-to-have |
| Booking URL rendered with correct `href`, `target="_blank"`, and `rel` | 73–76 | GAP | correctness |
| Course link rendered with `href="/courses/{id}"` | 54–55 | GAP | nice-to-have |

---

## File: `src/components/course-header.tsx`

### Test file: NONE

#### Function: `timeAgo(isoString: string): string` (line 110–118, NOT exported)

| Code Path | Line | Test Status | Severity |
|-----------|------|-------------|----------|
| minutes < 1 → `"just now"` | 113 | GAP | correctness |
| minutes >= 1 and < 60 → `"Xm ago"` | 114 | GAP | correctness |
| hours >= 1 and < 24 → `"Xh ago"` | 116 | GAP | correctness |
| hours >= 24 → `"Xd ago"` | 117 | GAP | correctness |
| Boundary: minutes = 0 → `"just now"` | 113 | GAP | nice-to-have |
| Boundary: minutes = 1 → `"1m ago"` | 114 | GAP | nice-to-have |
| Boundary: minutes = 59 → `"59m ago"` | 114 | GAP | nice-to-have |
| Boundary: hours = 1 (minutes = 60) → `"1h ago"` | 116 | GAP | nice-to-have |
| Boundary: hours = 23 → `"23h ago"` | 116 | GAP | nice-to-have |
| Boundary: hours = 24 → `"1d ago"` | 117 | GAP | nice-to-have |

#### Component: `CourseHeader` (line 20–108, exported)

| Code Path | Line | Test Status | Severity |
|-----------|------|-------------|----------|
| `refreshing=true` → shows "Updating..." | 58–59 | GAP | correctness |
| `last_polled` is non-null + not cooling down → shows "Last updated" + Refresh button | 60–73 | GAP | correctness |
| `last_polled` is null → shows "Refresh now" button | 75–82 | GAP | correctness |
| Cooling down → hides inline Refresh link | 63 | GAP | correctness |
| handleRefresh: calls POST for each date in `dates` | 37–43 | GAP | correctness |
| handleRefresh: bails out when `refreshDisabled` | 34 | GAP | correctness |
| handleRefresh: sets 30s cooldown timer after success | 45–46 | GAP | correctness |
| handleRefresh: calls `onRefreshed` callback | 44 | GAP | correctness |
| handleToggle: toggles favorite state | 26–29 | GAP | correctness |
| Favorite button: renders "★ Favorite" when favorited | 95 | GAP | nice-to-have |
| Favorite button: renders "☆ Favorite" when not favorited | 95 | GAP | nice-to-have |

---

## File: `src/components/date-picker.tsx`

### Test file: NONE

#### Function: `toDateStr(d: Date): string` (line 12–14, NOT exported)

| Code Path | Line | Test Status | Severity |
|-----------|------|-------------|----------|
| Converts Date to "YYYY-MM-DD" string | 13 | GAP | correctness |
| Edge: midnight UTC vs local timezone discrepancy (Date.toISOString is UTC) | 13 | GAP | correctness |

#### Function: `fromDateStr(s: string): string` (line 16–18, NOT exported)

| Code Path | Line | Test Status | Severity |
|-----------|------|-------------|----------|
| Parses "YYYY-MM-DD" to local-midnight Date | 17 | GAP | correctness |

#### Function: `buildQuickDays()` (line 20–33, NOT exported)

| Code Path | Line | Test Status | Severity |
|-----------|------|-------------|----------|
| Returns 7 entries | 23 | GAP | correctness |
| First entry has dayName = "Today" | 28 | GAP | correctness |
| Remaining entries use day-of-week names | 28 | GAP | correctness |
| Each entry's `value` is a valid date string | 27 | GAP | correctness |
| Each entry's `dayNum` matches the calendar day | 29 | GAP | nice-to-have |

#### Function: `datesInRange(start, end): string[]` (line 35–44, NOT exported)

| Code Path | Line | Test Status | Severity |
|-----------|------|-------------|----------|
| Returns inclusive range of dates from start to end | 39–43 | GAP | correctness |
| Single-day range (start === end) → returns `[start]` | 39 | GAP | correctness |
| start > end → returns empty array | 39 | GAP | correctness |
| Multi-day range (e.g. 3 days) | 39–43 | GAP | nice-to-have |

#### Function: `formatShortDate(dateStr: string): string` (line 46–49, NOT exported)

| Code Path | Line | Test Status | Severity |
|-----------|------|-------------|----------|
| Formats date string as "Mon DD" style (e.g. "Mar 9") | 48 | GAP | correctness |

---

## File: `src/components/time-filter.tsx`

### Test file: NONE

#### Component: `TimeFilter` (line 19–43, exported)

| Code Path | Line | Test Status | Severity |
|-----------|------|-------------|----------|
| Highlights the active preset matching startTime/endTime | 20–22 | GAP | correctness |
| Falls back to "any" when no preset matches | 21 | GAP | correctness |
| Calls onChange with correct start/end when preset clicked | 29–30 | GAP | correctness |
| Renders all 5 preset buttons | 26 | GAP | nice-to-have |

---

## File: `src/components/nav.tsx`

### Test file: NONE

#### Component: `Nav` (line 4–31, exported)

| Code Path | Line | Test Status | Severity |
|-----------|------|-------------|----------|
| Renders nav with link to "/" | 8 | GAP | nice-to-have |
| Renders logo images | 9–26 | GAP | nice-to-have |

Note: Pure presentation component, no logic branches.

---

## File: `src/types/index.ts`

Type definitions only. No runtime code paths to test.

---

## What's Well-Covered

- **`isStale` function** has thorough tests covering both sides of the 75-minute threshold, including boundary-adjacent values (74min, 76min) and the threshold constant itself.
- **Test infrastructure** is in place with vitest, proper timer management (`vi.useRealTimers` in afterEach), and the test file follows project conventions (ABOUTME comments, co-located with source).
- **The most critical pure function** (`isStale`) that determines user-visible staleness indicators is the one function that IS tested.

---

## Summary of All Gaps by Severity

### Security-Critical: 0

### Correctness: 42

| File | Function/Component | Gap Count |
|------|--------------------|-----------|
| tee-time-list.tsx | `staleAge` | 3 |
| tee-time-list.tsx | `formatTime` | 4 |
| tee-time-list.tsx | `TeeTimeList` component | 9 |
| course-header.tsx | `timeAgo` | 4 |
| course-header.tsx | `CourseHeader` component | 8 |
| date-picker.tsx | `toDateStr` | 2 |
| date-picker.tsx | `fromDateStr` | 1 |
| date-picker.tsx | `buildQuickDays` | 4 |
| date-picker.tsx | `datesInRange` | 3 |
| date-picker.tsx | `formatShortDate` | 1 |
| time-filter.tsx | `TimeFilter` component | 3 |

### Nice-to-Have: 16

| File | Function/Component | Gap Count |
|------|--------------------|-----------|
| tee-time-list.tsx | `staleAge` | 2 |
| tee-time-list.tsx | `formatTime` | 1 |
| tee-time-list.tsx | `TeeTimeList` component | 2 |
| course-header.tsx | `timeAgo` | 6 |
| course-header.tsx | `CourseHeader` component | 2 |
| date-picker.tsx | `buildQuickDays` | 1 |
| date-picker.tsx | `datesInRange` | 1 |
| time-filter.tsx | `TimeFilter` component | 1 |
| nav.tsx | `Nav` component | 2 |

**Total: 0 security-critical, 42 correctness, 16 nice-to-have = 58 gaps**

---

## Key Observations

1. **Pure functions are untested because they're not exported.** `staleAge`, `formatTime`, `timeAgo`, `toDateStr`, `fromDateStr`, `buildQuickDays`, `datesInRange`, and `formatShortDate` are all module-private. The lowest-friction path to testing them is to export them (they have no side effects and are purely computational). Alternatively, they could be extracted to a shared utils module.

2. **`toDateStr` has a timezone bug risk.** It uses `Date.toISOString()` which returns UTC. A user at 11pm CDT on March 9 would get a Date whose UTC representation is March 10. This could cause the date string to be one day ahead of what the user sees. This is the highest-priority correctness finding in the set.

3. **`formatTime` has no tests for the midnight edge case.** The ternary `hour === 0 ? 12 : hour > 12 ? hour - 12 : hour` is correct but non-obvious, and the midnight (hour=0 → 12 AM) and noon (hour=12 → 12 PM) cases are classic boundary conditions that should be explicitly verified.

4. **Component rendering is entirely untested.** None of the React components (`TeeTimeList`, `CourseHeader`, `DatePicker`, `TimeFilter`) have render tests. The conditional display logic (price shown/hidden, stale badge, singular/plural "spots", loading/empty states) is all untested. These are correctness gaps because they affect what users see.

5. **`timeAgo` and `staleAge` are near-identical functions** in different files (course-header.tsx and tee-time-list.tsx). Both format a duration from an ISO timestamp into human-readable text. This is a code duplication opportunity — extracting to a shared util would make testing easier and eliminate redundancy.
