# Bug Hunt Report — Teesnap & MemberSports Adapters (Multi-Pass)

## Scope
Files analyzed:
- `src/adapters/teesnap.ts`
- `src/adapters/membersports.ts`
- `src/adapters/index.ts`
- `src/config/courses.json` (entries for daytona, stoneridge, river-oaks)
- `src/config/areas.ts`
- `src/test/fixtures/teesnap-tee-times.json`
- `src/test/fixtures/membersports-tee-times.json`

Adjacent files for cross-sibling comparison:
- `src/adapters/eagle-club.ts`, `src/adapters/foreup.ts`, `src/adapters/teeitup.ts`, `src/adapters/chronogolf.ts`, `src/adapters/teewire.ts`, `src/adapters/cps-golf.ts`
- `src/types/index.ts`, `src/lib/poller.ts`

All five passes performed.

## Bugs

### 1. Teesnap: `holes` field defaults to 9 when only 9-hole pricing exists, even if course is 18-hole
**Location:** `src/adapters/teesnap.ts:115`
**Severity:** significant
**Evidence:** The `holes` field is set based on which price was found: `holes: eighteenPrice ? 18 : 9`. This means if the API returns a tee time with only a `NINE_HOLE` price entry (no `EIGHTEEN_HOLE` price), the adapter reports `holes: 9` — even if this is actually an 18-hole tee time that simply doesn't have 18-hole pricing listed. Looking at the fixture data, the last tee time (`08:36:00`) has only a `NINE_HOLE` price and will be reported as `holes: 9`. This may be correct for that specific slot (it might genuinely be a 9-hole-only time), but the logic conflates "which price is available" with "how many holes are being played." The `holes` field on `TeeTime` represents the round type, not the pricing tier. If a course offers 18-hole rounds but only lists 9-hole pricing at certain times, this will misreport.
**Impact:** Users may see tee times labeled as 9-hole when they are actually 18-hole rounds with only 9-hole pricing shown. The severity depends on how Teesnap structures their pricing data — if `NINE_HOLE` price presence always correlates with 9-hole rounds, this is a non-issue. But the assumption is unvalidated.
**Found in:** Pass 1 — Contract Violations

### 2. MemberSports: `golfClubId` and `golfCourseId` are strings in `platformConfig` but parsed as integers
**Location:** `src/adapters/membersports.ts:36-39`
**Severity:** minor
**Evidence:** `CourseConfig.platformConfig` is typed as `Record<string, string>`. The courses.json entries for river-oaks have `"golfClubId": "9431"` and `"golfCourseId": "11701"` (strings). The adapter calls `parseInt(golfClubId, 10)` and `parseInt(golfCourseId, 10)` to convert them. This works correctly today. However, no other adapter in the codebase does string-to-int parsing of platformConfig values — they all use the string values directly (CPS Golf passes `courseIds` as a query param string, ForeUp passes `scheduleId` as a query param string, etc.). The MemberSports adapter is the only one that needs numeric types in the request body, and the parseInt approach works, but it's a minor deviation that could mask issues if someone puts a non-numeric value in the config.
**Impact:** Low — the `Number.isNaN` guard catches invalid values and throws. This is more of a pattern observation than an active bug.
**Found in:** Pass 2 — Cross-Sibling Pattern Violations

### 3. Teesnap: No `address` field in courses.json entries
**Location:** `src/config/courses.json` (indices 27-29: daytona, stoneridge, river-oaks)
**Severity:** minor
**Evidence:** All three new course entries (daytona, stoneridge, river-oaks) are missing the `address` field. Every other course in the catalog has it. The UI in `src/app/courses/page.tsx:122` conditionally renders the address with a Google Maps link (`{course.address && ...}`), so this won't crash — but these courses will be missing the "View on Maps" functionality that every other course has.
**Impact:** Users cannot click through to Google Maps for these three courses. Not a correctness bug in the adapter, but a data completeness gap in the catalog.
**Found in:** Pass 2 — Cross-Sibling Pattern Violations

Zero critical bugs found.

## Pass 3: Failure Mode Reasoning

Examined failure paths in both adapters:

**Teesnap failure handling is solid:**
- HTTP errors throw with status code
- `date_not_allowed` gracefully returns `[]` (correct for seasonal closures)
- Missing `teeTimes` in response throws descriptive error
- The poller (`src/lib/poller.ts:77-84`) catches all thrown errors, logs them, and returns `"error"` status

**MemberSports failure handling is solid:**
- HTTP errors throw with status code
- Non-array response throws descriptive error
- Empty `items` array in a slot is skipped (line 75)
- `bookingNotAllowed` and `hide` flags correctly filter slots

No silent data loss or orphaned state detected in failure paths.

## Pass 4: Concurrency Reasoning

Both adapters are stateless — no shared mutable state, no locks, no caching. Each call to `fetchTeeTimes` makes independent HTTP requests and returns a fresh array. The cron handler polls courses sequentially with `await` between each, so there are no concurrent access concerns within the adapter layer.

No concurrency bugs found.

## Pass 5: Error Propagation

**Teesnap:** All errors properly propagate as thrown exceptions that the poller catches and logs. The `data.errors === "date_not_allowed"` check correctly returns an empty array rather than throwing — this is intentional (seasonal closure is not an error condition).

**MemberSports:** Same pattern — errors propagate correctly. The `parseInt` NaN checks throw before making any API calls. HTTP and response shape errors propagate to the poller.

No swallowed errors or lost error context detected.

## Design Concerns

1. **Teesnap hardcoded foursome maximum (line 99):** `const openSlots = 4 - totalBooked` assumes every tee time has exactly 4 slots. This is standard in golf, but the API might support non-standard group sizes. If Teesnap ever returns a tee time with 5+ booked golfers (e.g., a fivesome or a shotgun start), `openSlots` goes negative and the slot is correctly filtered out by `openSlots <= 0`. So this is safe, but it does mean the adapter cannot represent tee times with more than 4 total slots.

2. **MemberSports hardcoded API key (line 7):** The API key `A9814038-9E19-4683-B171-5A06B39147FC` is hardcoded in source. Every other adapter that requires auth uses either environment variables (`CPS_V4_API_KEY`), public/no-auth keys (`api_key: "no_limits"` for ForeUp), or no auth at all. If MemberSports rotates this key, it requires a code change and deploy rather than a secret rotation. This is a fragility concern, not a bug.

3. **MemberSports ignores `items` beyond index 0 (line 77):** `const item = slot.items[0]` only looks at the first item in each slot. If the API returns multiple items per slot (e.g., different rate tiers or course configurations), only the first is considered. This could miss availability or misrepresent pricing if the first item happens to be `bookingNotAllowed` while a later item is bookable.
