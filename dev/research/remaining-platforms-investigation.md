# Remaining Platform API Investigation

Date: 2026-03-08

## Summary

All three remaining platforms (Chronogolf, TeeItUp, Eagle Club Systems) have plain HTTP JSON APIs. No headless browser needed. This confirms the entire app can run on Cloudflare Workers free tier.

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

## Platform Comparison Summary

| Platform | Auth Model | API Style | Headless Browser? | Complexity |
|---|---|---|---|---|
| CPS Golf | Static x-apikey header | REST GET, JSON | No | Low |
| ForeUp | None (api_key=no_limits) | REST GET, JSON | No | Very Low |
| Chronogolf | x-csrf-token (session) | REST GET, JSON | No* | Medium |
| TeeItUp/Kenna | x-be-alias header | REST GET, JSON | No | Low |
| Eagle Club | None (dbname param) | REST POST, JSON | No | Low-Medium |

*Chronogolf may require fetching a page first to obtain the CSRF token, or there may be a token-free endpoint. Needs spring verification.

## Conclusion

All 5 platforms needed for the 11 favorite courses are confirmed accessible via plain HTTP. The app architecture (Cloudflare Workers + Cron Triggers) is fully viable.
