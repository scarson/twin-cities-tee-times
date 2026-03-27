# Teesnap Platform API Investigation

**Date:** 2026-03-26
**Status:** Complete - API is public and well-structured

## Overview

Teesnap is a cloud-based golf course management platform (v5.54.5 at time of research). It uses an AngularJS 1.6.3 single-page application that communicates with a REST API. The API requires no authentication for reading tee times.

## Target Courses

| Course | Subdomain | Status | Course ID | Property ID |
|--------|-----------|--------|-----------|-------------|
| Daytona Golf Club | daytonagolfclub.teesnap.net | Closed for season (enabled=false) | 1163 | 1035 |
| River Oaks Muni Golf | riveroaksmunigolf.teesnap.net | **DOES NOT EXIST** - returns "There is no website here" | N/A | N/A |
| StoneRidge Golf Course | stoneridgegc.teesnap.net | Active (used for testing, AZ course) | 1320 | 1145 |

**Important:** River Oaks Muni Golf is not on Teesnap. The subdomain returns a "Unknown Property" error page. Need to verify if they moved to another platform or shut down.

## API Details

### Base URL Pattern

```
https://{subdomain}.teesnap.net/customer-api/{endpoint}
```

The path prefix is always `/customer-api/`.

### Authentication

- **No API key or token required** for reading tee times
- **User-Agent header IS REQUIRED** - requests without a browser-like User-Agent get a 403 from the CDN/WAF
- No cookies, CSRF tokens, or session needed for read-only endpoints
- The AngularJS app sends no special auth headers for tee time queries

### Key Endpoints

#### 1. Tee Times for a Day (PRIMARY - this is what we need)

```
GET /customer-api/teetimes-day?course={courseId}&date={date}&players={players}&holes={holes}&addons={addons}
```

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `course` | integer | Course ID (from `window.property.courses[].id`) |
| `date` | string | Date in `YYYY-MM-DD` format |
| `players` | integer | Number of players (1-4 typically, from `players_array`) |
| `holes` | integer | 9 or 18 (from `holes_array`) |
| `addons` | string | `"on"` (with cart) or `"off"` (without cart) |
| `profileId` | integer? | Optional profile/membership ID (null for public) |

**Response structure:**
```json
{
  "teeTimes": {
    "bookings": [
      {
        "reservationId": 43158431,
        "channel": "MOBILE|THIRD_PARTY|BOOKING_SITE",
        "bookingId": 50848046,
        "golfers": [151531782, 151531783],
        "cartNumbers": [],
        "notes": false,
        "roundType": "EIGHTEEN_HOLE|NINE_HOLE",
        "teeOffSection": "FRONT_NINE|BACK_NINE",
        "addOnIncluded": true,
        "group": false
      }
    ],
    "golfers": [
      {
        "id": 151531782,
        "paidStatus": "...",
        "isRainChecked": false,
        "roundType": "EIGHTEEN_HOLE",
        "checkedIn": false,
        "hasProfileMismatch": false,
        "hasAddOn": true
      }
    ],
    "teeSheetPriceOverrides": [
      {
        "id": 119261,
        "roundTypes": [{"roundType": "EIGHTEEN_HOLE", "price": "55.00"}],
        "channel": "BOOKING_SITE",
        "requiresPrepayment": true,
        "startDate": "2026-03-01",
        "endDate": "2026-03-31",
        "startTime": "13:06",
        "endTime": "16:25",
        "daysOfWeek": ["MONDAY", "TUESDAY", ...],
        "taxInclusive": false
      }
    ],
    "teeTimes": [
      {
        "teeTime": "2026-03-27T09:30:00",
        "prices": [
          {
            "roundType": "NINE_HOLE",
            "rackRatePrice": "45.00",
            "price": "45.00",
            "priceWithAddOn": "45.00",
            "taxInclusive": false
          },
          {
            "roundType": "EIGHTEEN_HOLE",
            "rackRatePrice": "75.00",
            "price": "70.00",
            "priceWithAddOn": "70.00",
            "taxInclusive": false
          }
        ],
        "teeOffSections": [
          {
            "teeOff": "FRONT_NINE",
            "bookings": [50704573, 50831565],
            "isHeld": false
          }
        ],
        "rackRateName": "Winter Rate WE",
        "squeezeTime": false,
        "teeSheetPriceOverrideId": 119260,
        "shotgun": false,
        "teeSheetPriceOverride": {"id": 119260}
      }
    ]
  }
}
```

**Error responses:**
- `{"errors": "date_not_allowed"}` - date outside the course's booking window

#### 2. Available Dates (next dates with tee times)

```
GET /customer-api/teetimes-next?course={courseId}&date={date}&players={players}&holes={holes}&addons={addons}
```

Returns an array of date strings (`YYYY-MM-DD`) that have available tee times after the given date.

**Response:**
```json
["2026-03-28", "2026-03-29", "2026-03-30"]
```

#### 3. Public Profile (pricing profiles)

```
GET /customer-api/public-profile?course={courseId}
```

Returns public pricing profiles (e.g., senior rates, junior rates). Often empty.

**Response:**
```json
{"public_profiles": []}
```

#### 4. Weather

```
GET /customer-api/weather?date={date}
```

#### 5. Teepay Discount

```
GET /customer-api/teepay-discount?course={courseId}&date={date}
```

Returns prepayment discount offers.

### Other endpoints (require authentication)
- `POST /customer-api/reserve` - Book a tee time
- `POST /customer-api/cancel` - Cancel a booking
- `POST /customer-api/login` - User authentication
- `POST /customer-api/register` - Create account

## Calculating Available Spots

The API returns ALL tee time slots for a day, including fully booked ones. Availability must be calculated client-side:

1. Build a lookup: `bookingId -> golfer count` from `teeTimes.bookings[]`
2. For each tee time in `teeTimes.teeTimes[]`:
   - For each `teeOffSection`, sum the golfers across all `bookings`
   - Available spots = `4 - total_booked_golfers` (max 4 per slot)
   - If `isHeld` is true on a section, it's unavailable
   - A tee time is available if ANY section has spots open

The `players` query parameter does NOT pre-filter results. The client filters tee times where `available_spots >= requested_players`.

### Section Options

Courses have a `section_options` field that controls which tee-off sections are available:
- `"front_only"` - Only FRONT_NINE
- `"both_default_eighteen"` - FRONT_NINE and BACK_NINE
- Other values possible

## Property/Course Configuration

The `window.property` object embedded in the HTML page contains all configuration needed:

```javascript
window.property = {
  id: 1035,              // property ID
  tenant_id: 972,        // tenant ID
  key: "daytonagolfclub", // subdomain key
  name: "Daytona Golf Club",
  time_zone: "America/Chicago",
  today_date: "2026-03-26",
  courses: [{
    id: 1163,            // course ID (used in API calls)
    key: "daytonagolfclub",
    name: "Daytona Golf Club",
    enabled: true,       // whether the tee sheet is active
    customer_enabled: true,
    holes: "both_default_eighteen", // "nine", "eighteen", "both_default_eighteen"
    min_players: 1,
    max_players: 4,
    default_players: 4,
    advance: 7,          // days in advance booking is allowed
    holes_array: [9, 18],
    holes_default: 18,
    players_array: [1, 2, 3, 4],
    addons_array: ["on", "off"],
    addons_default: "on",
    section_options: "front_only",
    start_date: "2026-03-26",  // null if no tee times scheduled
    end_date: "2026-04-09",    // null if no tee times scheduled
    cancellable: false,
    infos: [...]         // course info/notices
  }]
};
```

Key fields for our adapter:
- `courses[].id` - required for API calls
- `courses[].enabled` / `courses[].customer_enabled` - whether booking is open
- `courses[].start_date` / `courses[].end_date` - available booking window (null = closed)
- `courses[].holes_array` - valid hole options
- `courses[].advance` - max days ahead

## Adapter Design Notes

### Platform Config

```json
{
  "platformId": "teesnap",
  "platformConfig": {
    "subdomain": "daytonagolfclub",
    "courseId": 1163
  }
}
```

The `courseId` is required for the API call and comes from `window.property.courses[].id`. It could be discovered dynamically by fetching the main page and parsing `window.property`, but hardcoding it in the catalog is simpler and more reliable.

### Request Requirements

- Must include a browser-like `User-Agent` header (CDN-level bot protection)
- No other special headers needed
- Date format: `YYYY-MM-DD`

### Mapping to Our TeeTime Type

```
teeTime     -> teeTimes.teeTimes[].teeTime (ISO datetime without timezone)
price       -> teeTimes.teeTimes[].prices[] (match by roundType)
holes       -> from the `holes` query parameter (9 or 18)
openSlots   -> calculated: 4 - sum(golfers in booking sections)
```

Note: The `teeTime` datetime is in the course's local timezone (no Z suffix). For MN courses this is `America/Chicago`.

### Rate Limiting

No explicit rate limiting was observed. The AngularJS app sets a 10-minute auto-refresh interval (`6e5` ms = 600,000 ms). Reasonable polling at our standard intervals should be fine.

### Anti-Bot Measures

- CDN-level User-Agent check (403 without browser-like UA)
- Google reCAPTCHA on some actions (login, gift card balance check) but NOT on tee time viewing
- No JavaScript challenge or Cloudflare-style bot protection on the API endpoints
- No rate limiting headers observed

### Multi-Course Properties

Some Teesnap properties have multiple courses (e.g., Daytona has a "Simulator" course). The `courses` array in `window.property` lists all of them. Each has its own `id` for API calls.

## Seasonal Considerations

MN courses will be closed during winter. When a course is closed:
- `enabled: false` in `window.property.courses[]`
- `start_date` / `end_date` may be null
- API returns `{"errors": "date_not_allowed"}` for any date query

The adapter should handle this gracefully (return empty tee times, not an error).
