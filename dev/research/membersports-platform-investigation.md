# MemberSports Platform Investigation

**Date:** 2026-03-27
**Status:** Feasible — public REST API, no auth required for tee time reads

## Platform Overview

MemberSports is a cloud-based golf management platform built on:
- **Frontend:** Angular SPA at `app.membersports.com`
- **Backend:** ASP.NET Core (Kestrel) REST API at `api.membersports.com`
- **Real-time:** AWS AppSync GraphQL (used for live scoring, NOT tee times)
- **Swagger docs:** `https://api.membersports.com/swagger/index.html`
- **OpenAPI spec:** `https://api.membersports.com/swagger/v1.0/swagger.json` (3.2 MB)

## Known TC Course

| Course | golfClubId | golfCourseId | configurationTypeId | Booking URL |
|--------|-----------|-------------|-------------------|-------------|
| River Oaks Municipal (Cottage Grove) | 9431 | 11701 | 0 | `app.membersports.com/tee-times/9431/11701/0` |

River Oaks previously used Teesnap (now returns 403) and has a Chronogolf listing. It appears they switched to MemberSports.

## API Details

### Endpoint: Get Online Booking Tee Times

```
POST https://api.membersports.com/api/v1.0/GolfClubs/onlineBookingTeeTimes
```

**Headers:**
```
Content-Type: application/json; charset=utf-8
Accept: application/json
x-api-key: A9814038-9E19-4683-B171-5A06B39147FC
```

The `x-api-key` is a static key embedded in the Angular frontend bundle. No Bearer token is required for this endpoint.

**Request body:**
```json
{
  "configurationTypeId": 0,
  "date": "2026-04-01",
  "golfClubGroupId": 0,
  "golfClubId": 9431,
  "golfCourseId": 11701,
  "groupSheetTypeId": 0,
  "memberProfileId": 0
}
```

- `date` — ISO date string (YYYY-MM-DD)
- `golfClubId` / `golfCourseId` — from the booking URL path segments
- `configurationTypeId` — third URL segment (usually 0; sometimes non-zero for multi-course facilities)
- `golfClubGroupId` — 0 for single-course facilities
- `groupSheetTypeId` — always 0 for public booking
- `memberProfileId` — 0 for unauthenticated/anonymous access

**Response:** Array of `GolfClubGroupTeeTime` objects:
```json
[
  {
    "teeTime": 546,
    "items": [
      {
        "allowSinglesToBookOnline": true,
        "availableCount": 0,
        "bookingNotAllowed": false,
        "bookingNotAllowedReason": null,
        "cartRequirementTypeId": 0,
        "configurationTypeId": 0,
        "golfClubId": 9431,
        "golfCourseId": 11701,
        "golfCourseNumberOfHoles": 18,
        "golfTaxRate": 0.0,
        "hide": false,
        "holesRequirementTypeId": 0,
        "isBackNine": false,
        "minimumNumberOfPlayers": 2,
        "name": "River Oaks Municipal",
        "playerCount": 0,
        "premiumCharge": 0.0,
        "price": 66.0,
        "rotationNumber": 1,
        "teeSheetId": 67696,
        "teeTime": 546,
        "teeTimeId": 14395896
      }
    ]
  }
]
```

### Time Format

`teeTime` is **minutes since midnight**. To convert:
```
hours = Math.floor(teeTime / 60)
minutes = teeTime % 60
```

Example: `546` → `9:06 AM`, `573` → `9:33 AM`

### Data Field Mapping

| Our field | MemberSports field | Notes |
|-----------|--------------------|-------|
| time | `teeTime` | Minutes since midnight; convert to HH:MM |
| price | `price` | Decimal, in dollars |
| holes | `golfCourseNumberOfHoles` | 9 or 18 |
| open_slots | NOT directly available | See notes below |

**Open slots issue:** The `availableCount` field is always 0 in unauthenticated responses. The `playerCount` shows how many players are booked. To determine open slots, we'd need `maxGroupSize` (typically 4), which is only available from the full tee sheet endpoint:

```
GET /api/v1.0/GolfClubs/{golfClubId}/{golfCourseId1}/{golfCourseId2}/types/{configurationTypeId}/teesheet/{date}
```

This endpoint is also publicly accessible (tested) and returns `maxGroupSize` per tee time, but the response is very large (130+ KB) since it includes full booking details with player names. The online booking endpoint is much lighter (40 KB).

**Practical approach:** Use `maxGroupSize = 4` as default (standard for golf). If `playerCount > 0`, open slots = `4 - playerCount`. If a slot appears in the response with `bookingNotAllowed = false` and `playerCount = 0`, it has 4 open slots.

### Endpoint: Club Info

```
GET https://api.membersports.com/api/v1.0/TeeSheets/clubInfo/{golfClubId}
```

Returns timezone, location, and weather info:
```json
{
  "golfClubId": 9431,
  "name": "River Oaks Municipal Golf Course",
  "city": "Cottage Grove",
  "state": "MN",
  "latitude": 44.7899,
  "longitude": -92.8856,
  "tzName": "America/Chicago"
}
```

### Endpoint: Tee Time Range

```
GET /api/v1.0/TeeSheets/golfCourses/{golfCourseId}/teeTimeRange/{teeSheetDate}
```

Returns start/end times for the tee sheet on a given date. Not yet tested for auth requirements.

## Filtering Response Data

When processing the response:
1. Filter out slots where `items` is empty (blocked/unavailable times)
2. Filter out slots where `bookingNotAllowed = true`
3. Filter out slots where `hide = true`
4. The `teeTime` value in both the outer object and inner item should match

## Rate Limiting

No rate limit headers observed (`X-RateLimit-*`, `Retry-After`, etc.). The API runs on bare Kestrel behind what appears to be minimal infrastructure. Be conservative with polling frequency.

## Authentication Notes

- The `x-api-key: A9814038-9E19-4683-B171-5A06B39147FC` is required on all requests
- This key is embedded in the public Angular frontend and is the same for all courses
- No Bearer token needed for read-only tee time and club info endpoints
- The Angular interceptor adds a Bearer token for authenticated actions (booking, account management)

## Swagger / OpenAPI Spec

The full API has hundreds of endpoints across controllers including TeeSheets, GolfClubs, Events, POSService, Members, etc. Key tee-time-related paths:

- `POST /api/v1.0/GolfClubs/onlineBookingTeeTimes` — **primary: public tee time availability**
- `GET /api/v1.0/TeeSheets/clubInfo/{golfClubId}` — club metadata
- `GET /api/v1.0/GolfClubs/{golfClubId}/{golfCourseId1}/{golfCourseId2}/types/{configurationTypeId}/teesheet/{date}` — full tee sheet (includes maxGroupSize but very large response)
- `GET /api/v1.0/TeeSheets/golfCourses/{golfCourseId}/teeTimeRange/{teeSheetDate}` — tee time range for date
- `POST /api/v1.0/TeeSheets/golfClubs/{golfClubId}/courses/{golfCourseId}/types/{configurationTypeId}/dates/{teeSheetDate}/{currentDate}/{currentTime}/profiles/{memberProfileId}/bookingCounts` — booking counts

## Adapter Design Notes

The adapter is straightforward:
1. Single POST request per course per date
2. Parse `teeTime` (minutes since midnight) into time string
3. Map `price`, `golfCourseNumberOfHoles` directly
4. Compute open slots as `4 - playerCount` (or use configurable maxGroupSize)
5. Filter out `bookingNotAllowed` and empty items
6. Booking URL: `https://app.membersports.com/tee-times/{golfClubId}/{golfCourseId}/{configurationTypeId}`

Platform config in courses.json would need: `golfClubId`, `golfCourseId`, `configurationTypeId`
