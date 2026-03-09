# Booking Platform Investigation

Date: 2026-03-08

## Summary

All investigated platforms can be scraped with plain HTTP requests. No headless browser (Playwright/Puppeteer) needed. This makes free-tier serverless hosting (Cloudflare Workers, Vercel) viable.

## Club Prophet Systems (cps.golf)

Used by Minneapolis Parks courses and others. Angular 13 SPA with a REST API behind it.

### Auth

Static headers per facility — no user login required to view tee times:

| Header | Description |
|---|---|
| `x-apikey` | Per-facility key, embedded in SPA config |
| `client-id` | Always `onlineresweb` |
| `x-websiteid` | Per-facility GUID |
| `x-siteid` | Site identifier (integer) |
| `x-terminalid` | Terminal identifier |
| `x-componentid` | Always `1` |
| `x-moduleid` | Always `7` |
| `x-productid` | Always `1` |
| `x-ismobile` | `false` |
| `x-timezone-offset` | `300` (Central Time) |
| `x-timezoneid` | `America/Chicago` |

### Key Endpoints

Base URL: `https://{subdomain}.cps.golf/onlineres/onlineapi/api/v1/onlinereservation`

| Endpoint | Method | Purpose |
|---|---|---|
| `/GetAllOptions/{subdomain}?version=...&product=3` | GET | Site configuration, rules, API key discovery |
| `/OnlineCourses` | GET | List of courses at this facility |
| `/TeeTimes?searchDate=...&courseIds=...&holes=0&numberOfPlayer=0&searchTimeType=0&teeOffTimeMin=0&teeOffTimeMax=23&isChangeTeeOffTime=true&teeSheetSearchView=5&classCode=R&defaultOnlineRate=N&isUseCapacityPricing=false&memberStoreId=1&searchType=1` | GET | Available tee times |
| `/BookingRuleModels?classcode=R&courseIds=...&searchDate=...` | GET | Booking constraints |
| `/RegisterTransactionId` | POST | Register a transaction (needed for booking, not for viewing) |
| `/TeeSheetNotes?courseIds=...&courseDate=...` | GET | Notes/messages for a given date |
| `/InformationCell?courseIds=...` | GET | Course info cells |

### Rate Limits

5 requests per 1 second per session.

### Confirmed Courses

| Course | Subdomain | API Key | Course IDs |
|---|---|---|---|
| Theodore Wirth Golf Course | `minneapolistheodorewirth` | `8ea2914e-cac2-48a7-a3e5-e0f41350bf3a` | 17 |
| Edinburgh USA Golf Course | `edinburghusa` | (fetch from GetAllOptions) | 2, 1 |
| Como Park Golf Course | `como` | (fetch from GetAllOptions) | TBD |

### Notes

- Date format in query params: `Sun Mar 08 2026` (JS Date toString format)
- Empty tee times response: `{"transactionId":"...","isSuccess":true,"content":{"messageKey":"NO_TEETIMES","messageTemplate":"No tee times available",...}}`
- The `x-apikey` can be discovered by calling `GetAllOptions` (which itself doesn't require the key, only the subdomain)
- Edinburgh USA was previously listed on Chronogolf/Lightspeed but actually uses CPS Golf

## ForeUp (foreupsoftware.com)

### Auth

Fully public API — no authentication needed.

### Key Endpoint

```
GET https://foreupsoftware.com/index.php/api/booking/times
```

Query parameters:

| Param | Description |
|---|---|
| `date` | Date in `YYYY-MM-DD` format |
| `time` | `all` or specific time |
| `holes` | `18`, `9`, or `0` for any |
| `players` | Number of players, `0` for any |
| `booking_class` | `default` |
| `schedule_id` | Per-course/facility identifier |
| `specials_only` | `0` |
| `api_key` | `no_limits` (literal string) |

### Response

JSON array of available tee times. Empty array `[]` when no times available.

### Confirmed Courses

| Course | Booking URL | Schedule ID |
|---|---|---|
| Braemar Golf Course (Edina) | `foreupsoftware.com/index.php/booking/21445/7829` | 7829 (Championship 18); Golf Dome is facility 21475/schedule 7885 |

### Notes

- Braemar's website is "Powered by foreUP Marketing Services"
- The booking page URL pattern: `foreupsoftware.com/index.php/booking/{facility_id}/{schedule_id}#/teetimes`
- ForeUp has a documented API at `foreup.docs.apiary.io` but the public booking endpoint works without any formal API registration

## Chronogolf / Lightspeed

### API

Documented REST API with OAuth 2.0 authentication at `partner-api.docs.chronogolf.com`. Requires registered `client_id`, `client_secret`, and `refresh_token`.

### Status

Edinburgh USA was listed on Chronogolf but actually uses CPS Golf. Need to verify which TC courses genuinely use Chronogolf for booking vs. just having a stale directory listing. The Chronogolf page for Edinburgh showed "Contact the course directly" rather than online booking.

### Courses to Investigate

- Bunker Hills Golf Club (was listed on Chronogolf — may also be CPS Golf)
- Others TBD

## GolfNow

Many TC courses are listed on GolfNow. API exists at `api.gnsvc.com`. Not yet investigated. May be useful as a fallback or supplementary data source.

## Other Systems

### St. Paul Golf (stpaul.golf)

St. Paul municipal courses (Como, Phalen, Highland) book through stpaul.golf. Como Park also appears on CPS Golf at `como.cps.golf` — need to determine if these are the same system or separate.

### Ramsey County (ramseycountymn.gov)

Keller Golf Course books through the Ramsey County parks system. Not yet investigated.

## Next Steps

1. Catalog which booking platform each of the ~80 public courses uses
2. Discover CPS Golf subdomains and API keys for all CPS-based courses
3. Discover ForeUp schedule_ids for all ForeUp-based courses
4. Investigate GolfNow API for courses not on CPS or ForeUp
5. Investigate Ramsey County and other municipal booking systems
