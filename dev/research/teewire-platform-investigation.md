# TeeWire Platform Investigation

Investigated 2026-03-25 for Inver Wood Golf Course.

## Overview

TeeWire is a golf booking platform. Inver Wood Golf Course (Inver Grove Heights, MN) uses it at `https://teewire.app/inverwood`. The site is a server-rendered PHP app (not a JS SPA framework) with Bootstrap + Tailwind CSS. It's hosted behind Cloudflare.

**Verdict: Fully usable from Cloudflare Workers.** Public JSON API, no auth required, CORS wide open.

## API Details

### Base URL Pattern

```
https://teewire.app/{tenant}/online/application/web/api/golf-api.php
```

For Inver Wood, tenant = `inverwood`.

### Tee Times Endpoint

```
GET https://teewire.app/inverwood/online/application/web/api/golf-api.php?action=tee-times&calendar_id={id}&date={YYYY-MM-DD}
```

Optional parameter: `players={N}` (works without it — returns all available tee times regardless).

### Course Info Endpoint

```
GET https://teewire.app/inverwood/online/application/web/api/golf-api.php?action=course&calendar_id={id}
```

## Calendar IDs (Inver Wood)

Inver Wood has two courses, each with its own `calendar_id`:

| Course | calendar_id | calendar_type |
|--------|------------|---------------|
| 18 Hole Championship Course | 3 | `18_hole_course` |
| Executive 9 Hole Course | 16 | `9_hole_course` |

## Auth Requirements

- **No authentication needed.** The API works with just a `User-Agent` header.
- No API keys, no session cookies, no CSRF tokens required.
- A non-browser user-agent like `TwinCitiesTeeTimes/1.0` works fine.
- Requests with **no** `User-Agent` header get blocked by Cloudflare's bot challenge (`Cf-Mitigated: challenge`, 403).

**Minimum required:** Any `User-Agent` header value. No cookies, no Referer, no Origin needed.

## CORS

The API returns `Access-Control-Allow-Origin: *` — fully open CORS. Callable from any origin, including Cloudflare Workers.

## Response Format

### Tee Times Response

```json
{
  "success": true,
  "data": {
    "tee_times": [
      {
        "slot_id": 1,
        "time": "09:00:00",
        "date": "2026-04-09",
        "timestamp": 1775743200,
        "time_us_format": "9:00am",
        "availability": {
          "available_spots": 2,
          "max_spots": 4,
          "reserved_spots": 2,
          "blocked_spots": 0,
          "held_spots": 0
        },
        "pricing": {
          "rates": [
            {
              "rate_id": 33,
              "rate_title": "18 Holes Walking",
              "holes": 18,
              "price": "$51.00",
              "description": "18 Holes Walking"
            },
            {
              "rate_id": 35,
              "rate_title": "18 Holes Riding",
              "holes": 18,
              "price": "$77.00",
              "description": "18 Holes Riding"
            },
            {
              "rate_id": 36,
              "rate_title": "9 Holes Walking",
              "holes": 9,
              "price": "$28.00",
              "description": "9 Holes Walking"
            },
            {
              "rate_id": 37,
              "rate_title": "9 Holes Riding",
              "holes": 9,
              "price": "$44.00",
              "description": "9 Holes Riding"
            }
          ]
        },
        "course_info": {
          "slot_length": 10
        },
        "golfer_type_flags": {
          "free_golfer": false,
          "free_cart_fee": false
        },
        "override_type": "seasonal_wave",
        "available_holes": [9, 18],
        "cross_nine_blocked": false,
        "cross_nine_detail": null
      }
    ],
    "date": "2026-04-09",
    "total_available": 1,
    "course_settings": {
      "calendar_type": "18_hole_course",
      "9_hole_course_only": 0,
      "enable_18_hole": 0,
      "turn_time_18": 120,
      "turn_time_tolerance": 20,
      "nine_hole_play_duration": 120,
      "no_single_empty_booking": 1
    },
    "golfer_type_rules": {
      "booking_window": 14,
      "limit_booking_per_day": 0
    },
    "max_booking_date": "2026-04-09",
    "current_bookings_today": 0,
    "limit_booking_per_day": 0
  }
}
```

### Field Mapping to Our Data Model

| Our field | TeeWire field | Notes |
|-----------|--------------|-------|
| time | `time` or `time_us_format` | `time` = "09:00:00", `time_us_format` = "9:00am" |
| price | `pricing.rates[].price` | Multiple rates per slot (walking/riding x 9/18). Price is a formatted string like "$51.00" |
| holes | `pricing.rates[].holes` or `available_holes` | 9 or 18. `available_holes` array shows which are bookable |
| available_spots | `availability.available_spots` | Direct field |

### Key Observations

- **Pricing is per-slot, multi-rate.** Each tee time slot can have multiple rate options (walking vs riding, 9 vs 18 holes). Our data model stores one price per tee time, so we'd need to pick one (walking green fee is the standard).
- **The 18-hole calendar (cid=3) returns rates for both 9 and 18 holes.** The `available_holes` array shows what's bookable for that slot.
- **Price is a formatted string** ("$51.00") — needs parsing to extract the numeric value.
- **Date format is ISO 8601** (YYYY-MM-DD) — easy to work with.
- **Booking window is 14 days** per `golfer_type_rules.booking_window`.

### Course Info Response

```json
{
  "success": true,
  "data": {
    "id": 3,
    "facility": "Inver Wood Golf Course",
    "calendar_address": "1850 70th Street, Inver Grove Heights, MN 55077",
    "phone": "651-450-4320",
    "logo": "https://teewire.app/inverwood/teesheet/application/web/upload/calendars/original/1771304588.jpg",
    "title": "18 Hole Championship Course",
    "description": "<p>18 Hole Course</p>",
    "settings": { ... }
  }
}
```

## Anti-Scraping / Bot Protection

- **Cloudflare is in front** but configured lightly — it only blocks requests with NO `User-Agent` header.
- Any `User-Agent` string (even non-browser) passes through fine.
- No rate-limiting headers observed (`X-RateLimit-*` etc.).
- No WAF challenge for API endpoints when `User-Agent` is present.
- The main HTML page (`/inverwood/`) also passes with a browser-like UA, but the API endpoint is even more permissive.

## Recommended platformConfig Shape

```json
{
  "platformId": "teewire",
  "tenant": "inverwood",
  "calendarIds": {
    "18": 3,
    "9": 16
  }
}
```

Or, if we model each calendar as a separate course entry (like we do with other multi-course facilities):

```json
// For 18-hole championship course
{
  "platformId": "teewire",
  "tenant": "inverwood",
  "calendarId": 3
}

// For 9-hole executive course
{
  "platformId": "teewire",
  "tenant": "inverwood",
  "calendarId": 16
}
```

The API URL would be constructed as:
```
https://teewire.app/{tenant}/online/application/web/api/golf-api.php?action=tee-times&calendar_id={calendarId}&date={YYYY-MM-DD}
```

## Booking URL

For linking users to book:
```
https://teewire.app/inverwood/index.php?controller=FrontV2&action=load&cid={calendarId}&view=list
```

## Concerns

1. **Seasonal availability.** Inver Wood appears to open around early April. Empty responses are expected during off-season — same pattern as other MN courses.
2. **Rate limiting unknown.** No rate limit headers observed. Should be respectful with polling frequency.
3. **Price parsing.** Prices come as formatted strings ("$51.00") rather than numbers. Minor parsing needed.
4. **Multi-rate slots.** Need a strategy for which rate to display (walking green fee is standard for our app).
5. **Platform is newer/less common.** Less documentation available. API could change without notice. But the structure is clean and well-designed.
