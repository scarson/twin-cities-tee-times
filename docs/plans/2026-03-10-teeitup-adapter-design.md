# TeeItUp Platform Adapter Design

**Date:** 2026-03-10
**Status:** Approved

## Goal

Add a TeeItUp/Kenna platform adapter to fetch tee times from TeeItUp-powered courses. This covers 8 Twin Cities courses (all Ramsey County courses plus Deer Run, Inver Wood, etc.) and is the third adapter after CPS Golf and ForeUp.

## API Details

**Base URL:** Varies by region (e.g., `https://phx-api-be-east-1b.kenna.io`). Stored per-course in `platformConfig.apiBase`.

**Auth:** Single header `x-be-alias` set to the tenant name (e.g., `ramsey-county-golf`). No tokens or keys.

**Tee times endpoint:**
```
GET /v2/tee-times?date=YYYY-MM-DD&facilityIds={id}
Headers: x-be-alias: {alias}
```

**Config discovery:** The booking page (`{alias}.book.teeitup.com`) embeds config in hidden inputs:
- `id="alias"` → tenant name
- `id="beApiURI"` → API base URL
- Facility IDs from the `beSettings` JSON embedded in the page

## Response Structure

Response is an array of course objects:
```json
[{
  "dayInfo": { "dawn": "...", "sunrise": "...", "sunset": "...", "dusk": "..." },
  "teetimes": [
    {
      "teetime": "2026-03-11T17:50:00.000Z",
      "backNine": false,
      "rates": [{
        "name": "Walking",
        "holes": 18,
        "trade": false,
        "tags": [],
        "greenFeeWalking": 3500,
        "dueOnlineWalking": 0,
        "promotion": { "discount": 0.14, "greenFeeWalking": 2400 }
      }],
      "bookedPlayers": 3,
      "maxPlayers": 1
    }
  ],
  "courseId": "54f14bc00c8ad60378b015c9",
  "totalAvailableTeetimes": 16,
  "fromCache": false
}]
```

Key observations from live data (Lomas Santa Fe, 2026-03-11):
- **Prices are in cents** — `greenFeeWalking: 3500` = $35.00
- **`maxPlayers` = available spots** — not total capacity. Total = `bookedPlayers + maxPlayers`
- **`promotion.greenFeeWalking`** is the effective price when a promo applies
- **`trade: true`** indicates GolfNow resale rates (not direct booking)
- **Times are UTC ISO 8601**

## Field Mapping

| TeeItUp field | Our `TeeTime` field | Transform |
|---|---|---|
| `teetime` | `time` | Use as-is (ISO 8601 UTC) |
| rate `greenFeeWalking` | `price` | `÷ 100`; prefer `promotion.greenFeeWalking` if present |
| rate `holes` | `holes` | Direct (9 or 18) |
| `maxPlayers` | `openSlots` | Direct — already represents available spots |
| course config `bookingUrl` | `bookingUrl` | From `CourseConfig` |
| course config `id` | `courseId` | From `CourseConfig` |

## Rate Selection

Each tee time can have multiple rates. Selection logic:
1. Find the first rate where `trade !== true`
2. Fall back to the first rate if all are trade rates (unlikely)

The API returns only rates applicable to anonymous users, so member-only rates don't appear in practice.

## Filtering

Skip tee times where:
- `maxPlayers <= 0` (fully booked)
- `rates` array is empty

## `platformConfig` Fields

| Field | Example | Purpose |
|---|---|---|
| `alias` | `ramsey-county-golf` | `x-be-alias` request header |
| `apiBase` | `https://phx-api-be-east-1b.kenna.io` | API base URL (varies by region) |
| `facilityId` | `17055` | `facilityIds` query parameter |

All three are required; adapter throws if any is missing.

## SD Test Courses (for live testing)

| Course | Alias | API Base | Facility ID |
|---|---|---|---|
| Lomas Santa Fe | `lomas-santa-fe-executive-golf-course` | `https://phx-api-be-east-1b.kenna.io` | `1241` |
| Coronado | `coronado-gc-3-14-be` | TBD (discover from page) | TBD |

## TC Courses (for production)

| Course | Alias | Facility ID | Notes |
|---|---|---|---|
| Keller | `ramsey-county-golf` | `17055` | Ramsey County tenant |
| Manitou Ridge | `ramsey-county-golf` | `17056` | Same tenant as Keller |
| Others | TBD | TBD | Discover from booking pages |

## Fixture

Save a representative live response from Lomas Santa Fe as `src/test/fixtures/teeitup-lomas-santa-fe.json` for adapter unit tests.
