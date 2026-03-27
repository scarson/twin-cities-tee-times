# Teesnap & MemberSports Adapter Design

**Date:** 2026-03-27
**Status:** Approved

## Scope

Two new platform adapters, four new catalog courses, and two platform corrections:

| Course | Platform | Status |
|---|---|---|
| Daytona Golf Club (Dayton) | Teesnap (new adapter) | Active |
| StoneRidge (Stillwater) | Teesnap (new adapter) | Active |
| River Oaks Municipal (Cottage Grove) | MemberSports (new adapter) | Active |
| Emerald Greens Gold (Hastings) | ForeUp (existing adapter) | Active |
| Emerald Greens Silver (Hastings) | ForeUp (existing adapter) | Active |

Platform catalog corrections:
- River Oaks: moved from Teesnap to MemberSports
- Emerald Greens: moved from GolfNow to ForeUp

## Teesnap Adapter

### API

```
GET https://{subdomain}.teesnap.net/customer-api/teetimes-day
  ?course={courseId}&date=YYYY-MM-DD&players=1&holes=18&addons=off
```

- No auth token required
- Browser-like `User-Agent` header required (CDN bot protection)
- Single query returns all slots with both 9-hole and 18-hole pricing
- The `holes` query parameter has no effect on results (tested live)

### Platform Config

```json
{
  "subdomain": "daytonagolfclub",
  "courseId": "1163"
}
```

### Availability Calculation

The API returns all tee time slots including fully booked ones. Open spots must be calculated:

1. Build lookup from top-level `bookings` array: `bookingId -> golfer count` (from `golfers.length`)
2. For each tee time, for each `teeOffSection`: sum golfer counts across all booking IDs
3. Skip sections where `isHeld` is true
4. `openSlots = 4 - totalBookedGolfers`
5. Filter out slots with 0 open spots

### Price Mapping

Each tee time has a `prices[]` array with entries per round type (`NINE_HOLE`, `EIGHTEEN_HOLE`). Emit one TeeTime per slot using the `EIGHTEEN_HOLE` price. Fall back to `NINE_HOLE` if no 18-hole price exists. Use the `price` field (reflects active promotions), not `rackRatePrice`.

### Time Format

`teeTime` field is local ISO without Z suffix (e.g., `2026-03-27T09:30:00`). Maps directly to `TeeTime.time` with no conversion needed.

### Error Handling

`{"errors": "date_not_allowed"}` when course is closed for season -> return empty array, not an error.

## MemberSports Adapter

### API

```
POST https://api.membersports.com/api/v1.0/GolfClubs/onlineBookingTeeTimes
Content-Type: application/json
x-api-key: A9814038-9E19-4683-B171-5A06B39147FC

{
  "golfClubId": 9431,
  "golfCourseId": 11701,
  "configurationTypeId": 0,
  "date": "2026-04-01",
  "golfClubGroupId": 0,
  "groupSheetTypeId": 0,
  "memberProfileId": 0
}
```

- Static `x-api-key` embedded in public Angular frontend (same pattern as CPS Golf)
- No Bearer token needed for read-only tee time queries

### Platform Config

```json
{
  "golfClubId": "9431",
  "golfCourseId": "11701"
}
```

### Time Format

`teeTime` is minutes since midnight (integer). Convert: `hours = Math.floor(t / 60)`, `minutes = t % 60`, emit as `{date}T{HH}:{MM}:00`.

### Price and Holes

- `price`: decimal (e.g., `66.0`), map directly
- `golfCourseNumberOfHoles`: 9 or 18, map directly

### Open Slots

`availableCount` is always 0 in unauthenticated responses. Use `4 - playerCount` as default. Filter out slots where result is <= 0.

### Filtering

Exclude items where:
- `bookingNotAllowed` is true
- `hide` is true
- `items` array is empty

### Error Handling

Empty array response when course is closed -> return empty array.

## Catalog Additions

### Emerald Greens (ForeUp)

Two entries for the 36-hole facility:
- **Emerald Greens (Gold)**: facilityId 19202, scheduleId 1266
- **Emerald Greens (Silver)**: facilityId 19202, scheduleId 1308

Uses existing ForeUp adapter, no new code needed.

## Testing

### Unit Tests (fixture-based)
- Teesnap: availability calculation (full, partial, empty bookings), price mapping (18-hole preferred, 9-hole fallback), closed-course `date_not_allowed` response, held sections skipped
- MemberSports: minutes-to-time conversion, slot filtering (bookingNotAllowed, hide), playerCount-based availability, empty response

### Smoke Tests (live API)
- Teesnap: StoneRidge (active, courseId 1320)
- MemberSports: River Oaks (active, golfClubId 9431, golfCourseId 11701)

## Research References

- `dev/research/teesnap-platform-investigation.md`
- `dev/research/membersports-platform-investigation.md`
