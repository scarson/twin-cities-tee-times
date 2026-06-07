# Bug Hunt Report — Exploratory Analysis

## Scope
Deep exploration of the Teesnap adapter (`src/adapters/teesnap.ts`) and MemberSports adapter (`src/adapters/membersports.ts`), following high-risk threads through the adapter registry (`src/adapters/index.ts`), test fixtures, courses.json (indices 44-48), the poller (`src/lib/poller.ts`), types (`src/types/index.ts`), and the eagle-club adapter (sibling reference pattern).

**High-risk entry points chosen and why:**
1. **Teesnap availability calculation (lines 84-100)** — Multi-step data join across bookings and sections, with assumptions about group size. Most complex logic in scope.
2. **MemberSports `minutesToIso` conversion (lines 98-101)** — Math-based time conversion with no input validation; silent corruption if inputs are unexpected.
3. **Teesnap `holes` inference from pricing (lines 103-115)** — Deriving a domain field (`holes`) from a proxy signal (which price exists) rather than an authoritative source.

Also cross-referenced both test fixtures, the adapter registry, and all three courses.json entries for consistency.

## Bugs

No correctness bugs found.

Both adapters are clean implementations that correctly handle their respective API contracts, propagate errors appropriately (throw on HTTP errors, malformed responses, and missing config), and produce well-formed `TeeTime` objects that flow through the poller/DB pipeline without issues.

Specific threads followed to dead ends (no bugs found):

- **Booking lookup correctness (teesnap.ts:77-79, 92-93):** The `golferCounts` map is keyed by `bookingId` and valued by `golfers.length`. Section bookings reference these IDs correctly. The `?? 0` fallback on line 93 handles the case where a section references a booking ID not in the bookings array — this defaults to 0 golfers (safe, avoids NaN propagation).

- **`minutesToIso` edge cases (membersports.ts:98-101):** `Math.floor(minutes / 60)` and `minutes % 60` are correct for all non-negative integers. For the domain of golf tee times (roughly 300-1200 minutes, i.e., 5:00 AM to 8:00 PM), the output is always valid. Negative minutes or minutes >= 1440 would produce nonsensical strings, but these would be filtered out downstream by the time display logic and aren't values a real API would return.

- **`parseInt` with NaN guard (membersports.ts:36-39):** The `parseInt(golfClubId, 10)` + `Number.isNaN` pattern correctly converts string config values to the integers the API expects. The guard catches non-numeric strings. This is the only adapter that needs integer conversion because it's the only one sending a JSON POST body (others pass IDs as URL query params where strings are fine).

- **Adapter registry consistency:** Both `platformId` values (`"teesnap"`, `"membersports"`) match the `platform` fields in courses.json. Both adapters are imported and instantiated in `src/adapters/index.ts`.

- **`data.teeTimes.bookings` nullability (teesnap.ts:78):** The `?? []` fallback handles both `null` and `undefined`, so a response with `teeTimes` present but `bookings` missing won't crash.

- **Price parsing (teesnap.ts:112-113):** `parseFloat(selectedPrice.price)` with `Number.isNaN` guard matches the pattern in eagle-club.ts and other sibling adapters. Falls back to `null` on unparseable prices.

## Design Concerns

### Teesnap: `holes` field derived from pricing presence, not from an authoritative source
**Location:** `src/adapters/teesnap.ts:115`

The `holes` value is set to 18 if an `EIGHTEEN_HOLE` price exists, else 9. This conflates "which pricing tier is listed" with "what round type is offered." If Teesnap ever lists an 18-hole tee time without an `EIGHTEEN_HOLE` price entry (e.g., a promotional slot with only a bundled price, or a data entry omission), it would be misreported as 9 holes. The API response doesn't appear to include an explicit round-type field separate from pricing, so there may be no better option. The safer failure mode would be defaulting to 18 (since most public courses are 18-hole), but the current default of 9 is the more conservative choice that avoids overpromising.

### Teesnap: hardcoded foursome max with multi-section summing
**Location:** `src/adapters/teesnap.ts:89-100`

The code sums booked golfers across ALL non-held sections of a tee time, then subtracts from a hard 4. If a tee time has multiple sections (e.g., front-nine and back-nine starts), each with independent 4-person capacity, this sum could exceed 4 and filter out the slot even though individual sections have availability. The fixture data only shows single-section tee times, so this hasn't manifested. The failure mode (underreporting availability) is the safer direction — users would still see the tee time on the booking site. But it could cause tee times to disappear from the aggregator that are actually bookable.

### MemberSports: only first item per slot examined
**Location:** `src/adapters/membersports.ts:77`

If a slot has multiple items (different course configurations or rate tiers at the same time), only `items[0]` is checked. A slot where `items[0].bookingNotAllowed = true` but `items[1]` is bookable would be filtered out entirely. The API is queried with a specific `golfCourseId`, which likely constrains responses to a single item per slot, but the data structure permits multiple and the code doesn't account for it.
