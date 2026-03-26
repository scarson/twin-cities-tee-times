# Remaining Platform API Investigation

Date: 2026-03-08

## Summary

Five platforms investigated for direct HTTP API access. Chronogolf, TeeItUp, and Eagle Club Systems all have plain HTTP JSON APIs. Two additional platforms (CPS Golf V4/ProphetServices, GolfNow) were identified later and deferred.

---

## Chronogolf / Lightspeed (Baker National)

### Auth
Uses a `x-csrf-token` header, but this is session-based (set by the page on load). The API endpoints appear to be accessible from the marketplace widget without user authentication.

### API Base
`https://www.chronogolf.com`

### Key Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/marketplace/organizations/{clubId}` | GET | Club info (name, address, settings, UUID) |
| `/marketplace/clubs/{clubId}/courses` | GET | List of courses at the club |
| `/marketplace/clubs/{clubId}/products` | GET | Products (green fees, cart rentals) with course_ids |
| `/marketplace/organizations/{clubId}/affiliation_types` | GET | Member types and booking ranges |
| `/private_api/clubs/{clubId}/tax` | GET | Tax rates |

### Key Identifiers
- **Baker National Club ID:** 8320
- **Baker National UUID:** `06bd45a0-4611-4169-87d0-40da8081e998`
- **Course IDs:** 9602 (Championship 18), 9603 (Evergreen 9), 22538 (additional)
- **Management Company IDs:** 17211, 18697 (Three Rivers Park District), 18132

### Response Format
Clean JSON. The organizations endpoint returns course info, settings, pricing, and online booking status.

### Notes
- The courses endpoint returned `[]` (empty) — likely because the course is closed for winter. The products endpoint did return green fee and cart rental products with course_id associations.
- Chronogolf has online_booking_enabled: true for Baker National.
- The tee times endpoint itself was not triggered during page load (no dates available in March). Will need to investigate the actual tee time availability endpoint when courses open in spring. It's likely something like `/marketplace/clubs/{clubId}/teetimes?date=YYYY-MM-DD`.
- Chronogolf uses `x-csrf-token` which is generated per session — may need to fetch the widget page first to obtain it, or find a way to call without it.

### Tee Time Endpoint (needs spring verification)
Based on Chronogolf's known API patterns, the tee times endpoint is likely:
```
GET /marketplace/clubs/{clubId}/teetimes?date=YYYY-MM-DD&course_id={courseId}&affiliation_type_id={typeId}
```
This needs to be verified when courses are open.

---

## TeeItUp / Kenna (Keller Golf Course)

### Auth
Requires a single header: `x-be-alias` set to the tenant name (e.g., `ramsey-county-golf`). No other authentication needed.

### API Base
`https://phx-api-be-east-1b.kenna.io`

### Key Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/facilities` | GET | List all facilities for the tenant |
| `/v2/tee-times?date=YYYY-MM-DD&facilityIds={id}` | GET | Available tee times for a date |
| `/course/{courseId}/tee-time/locks?localDate=YYYY-MM-DD` | GET | Locked/held tee times |
| `/shopping-cart/{cartId}` | GET | Shopping cart (for booking flow) |

### Required Headers
```
x-be-alias: {tenant-name}
```

### Config Discovery
The TeeItUp booking page embeds config in hidden input fields:
- `id="alias"` → tenant name (e.g., `ramsey-county-golf`)
- `id="beApiURI"` → API base URL
- `id="golfIdClientId"` → client ID for auth flow

### Key Identifiers
- **Tenant:** `ramsey-county-golf`
- **Keller facility ID:** 17055
- **Keller course ID:** `5e206b54e5948001003c1957`
- **Manitou Ridge facility ID:** 17056 (same tenant)

### Response Format
Clean JSON. Facilities endpoint returns array of facility objects with name, address, timezone, location coordinates, description, policy, and image URL.

Tee times response:
```json
[{
  "dayInfo": {
    "dawn": "2026-03-08T12:09:00.000Z",
    "sunrise": "2026-03-08T12:39:00.000Z",
    "sunset": "2026-03-09T00:06:00.000Z",
    "dusk": "2026-03-09T00:39:00.000Z"
  },
  "teetimes": [],
  "courseId": "5e206b54e5948001003c1957",
  "totalAvailableTeetimes": 0,
  "fromCache": false
}]
```
Empty teetimes array because course is closed for winter, but the structure is clear.

### Notes
- The API is hosted on kenna.io (TeeItUp's backend infrastructure).
- The API base URL may vary by region (`phx-api-be-east-1b.kenna.io`) — should be discovered from the page config rather than hardcoded.
- TeeItUp uses LaunchDarkly for feature flags and Datadog for monitoring.

---

## Eagle Club Systems (Valleywood)

### Auth
Empty `authorization` header sent (no token). The `dbname` parameter in the URL serves as the facility identifier.

### API Base
`https://api.eagleclubsystems.online`

### Key Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/online/OnlineCourseRetrieve` | POST | Course info (name, address, settings) |
| `/api/online/OnlineAppointmentRetrieve` | POST | Available tee times (appointments) |
| `/api/online/OnlineTheRestRetrieve` | POST | Rate structures, additional config |
| `/signalr/negotiate` | GET | SignalR real-time connection setup |

### Request Format
All POST endpoints send JSON with the `dbname` as a parameter. The exact request body format needs further investigation (the page's Angular app constructs these).

### Key Identifiers
- **Valleywood dbname:** `mnvalleywood20250115`
- **Organization ID:** 1
- **Note:** The dbname contains a date stamp (`20250115`) which may change periodically

### Response Format
.NET-style JSON responses with a `BG` (background) object containing status info, plus domain-specific arrays:

**OnlineCourseRetrieve** returns: course name, address, city, state, phone, lat/lng, hole configuration, pricing item IDs.

**OnlineAppointmentRetrieve** returns: `LstAppointment` (available slots), `LstAppointmentAll`, `LstOnlineDateNine`, `LstCarriageNotAllowed`, `LstDayMessage`. Empty because course is closed for winter.

**OnlineTheRestRetrieve** returns: `LstRackRate` (rate structures like "Weekday Daybreak Special", "Weekday Twilight", etc.).

### Notes
- Uses SignalR (WebSocket) for real-time updates — but the initial data load uses standard REST POST endpoints.
- The SignalR connection uses `user=testuser` and `hubName=Test` — appears to be a generic/anonymous connection.
- No authentication required for viewing tee times.
- The `.NET`-style API suggests a C#/ASP.NET backend.
- **Caution:** The `dbname` parameter `mnvalleywood20250115` contains a date. If this rotates (e.g., annually), the config would need updating. Monitor this.

---

## CPS Golf V4 / ProphetServices (Brookview)

**Status: Implemented** — uses `brookview.cps.golf` with V4 apiKey auth.

### Resolution
The initial investigation focused on `secure.east.prophetservices.com` (which is behind AWS WAF). Later discovery found that `brookview.cps.golf` serves the V4 API and works with the same shared V4 apiKey (`CPS_V4_API_KEY` secret) used by Edinburgh USA, Oak Glen, Victory Links, and Gem Lake Hills. No proxy or WAF workaround needed.

### Courses
- Brookview Regulation (courseIds 1,2) — 18-hole
- Brookview Par-3 (courseId 3)
- websiteId: `00000000-0000-0000-0000-000000000000` (zeroed GUID from Configuration endpoint)

### Note
Brookview's V4 endpoint requires transaction registration (unlike some other V4 courses). The CPS Golf adapter was updated to always register transactions for V4 courses.

---

## GolfNow (Ft. Snelling)

**Status: Deferred (API requires affiliate credentials)** — Ft. Snelling added as catalog-only with GolfNow booking link.

### Background
Ft. Snelling Golf Club (Minneapolis Park Board, 9 holes) uses GolfNow as its primary booking platform, unlike the other Mpls Park Board courses which use CPS Golf V5.

### Known Info
- **GolfNow facility ID:** 18122
- **Booking URL:** `https://www.golfnow.com/tee-times/facility/18122-fort-snelling-golf-club-9-holes/search`
- **Course website:** `https://www.minneapolisparks.org/golf/courses/fort_snelling_golf_club/`
- **API base (unverified):** `api.gnsvc.com`

### API Investigation (2026-03-27)
Two APIs exist:
1. **Official Affiliate API** (`api.gnsvc.com/rest`) — full tee time data, but requires registered affiliate credentials (registration at `affiliate.gnsvc.com`). Returns 401 without credentials.
2. **Website API** (`www.golfnow.com/api/...`) — POST endpoints behind Cloudflare bot management (JS challenge). Not usable from server-side code.

A **summaries-only endpoint** works without auth: `GET /api/tee-times/tee-times/facility/{facilityId}/summaries/from/{dateMin}/to/{dateMax}` — returns per-day counts and price ranges, but not individual tee times.

### Resolution
Ft. Snelling added to catalog with `disabled: 1` and `displayNotes` linking to GolfNow. No adapter built. Individual tee times would require affiliate API credentials.

### Notes
- GolfNow is a marketplace/aggregator (NBC Sports). Several other TC courses also list on GolfNow as a secondary channel.
- 6 TC courses appear to use GolfNow as their primary booking system (see `tc-courses-platforms.md`).

---

## TeeWire (Inver Wood)

**Status: Implemented** — adapter built, Inver Wood onboarded.

### Background
Inver Wood Golf Course (Inver Grove Heights, 27 holes) was originally cataloged as TeeItUp but switched to TeeWire. Full API details in `dev/research/teewire-platform-investigation.md`.

### Resolution
TeeWire adapter built. Clean public JSON API, no auth needed (just a User-Agent header). Two courses added: Championship 18 (calendarId 3) and Executive 9 (calendarId 16).
- Bluff Creek Golf Course was also originally listed as TeeItUp but is actually on Chronogolf.

---

## Platform Comparison Summary

| Platform | Auth Model | API Style | Headless Browser? | Complexity | Status |
|---|---|---|---|---|---|
| CPS Golf (V5) | Static x-apikey header | REST GET, JSON | No | Low | Adapter built |
| ForeUp | None (api_key=no_limits) | REST GET, JSON | No | Very Low | Adapter built |
| TeeItUp/Kenna | x-be-alias header | REST GET, JSON | No | Low | Adapter built |
| Chronogolf | x-csrf-token (session) | REST GET, JSON | No* | Medium | Needs adapter |
| Eagle Club | None (dbname param) | REST POST, JSON | No | Low-Medium | Needs adapter |
| CPS Golf (V4) | ASP.NET session + WAF | REST GET, JSON | No** | High | Deferred |
| TeeWire | User-Agent header only | REST GET, JSON | No | Low | Adapter built |
| GolfNow | Affiliate credentials | REST GET/POST, JSON | No* | High | Deferred (credentials) |

*Chronogolf may require fetching a page first to obtain the CSRF token, or there may be a token-free endpoint. Needs spring verification.

**CPS V4 (ProphetServices) is behind AWS WAF. Could work via Lambda proxy, but V4 API differs from V5.

## Conclusion

The 5 original platforms (CPS Golf V5, ForeUp, TeeItUp, Chronogolf, Eagle Club) are confirmed accessible via plain HTTP. CPS Golf V4 (Brookview) and TeeWire (Inver Wood) have been implemented. GolfNow (Ft. Snelling) requires affiliate API credentials — added as catalog-only with booking link.
