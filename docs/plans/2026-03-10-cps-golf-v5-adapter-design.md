# CPS Golf Adapter v5 Update

**Goal:** Update the CPS Golf adapter from the deprecated v4 API (static `x-apikey`) to the v5 API (OAuth2 Bearer token + transaction ID).

**Architecture:** Inline 3-step auth per `fetchTeeTimes` call. No caching, no shared state. Each call does: get token → register transaction → query tee times.

**Context:** CPS Golf migrated from static `x-apikey` auth to an OAuth2 `client_credentials` flow with short-lived Bearer tokens and per-session transaction IDs. Discovered via HAR capture from `jcgsc5.cps.golf` (JC Golf SD portal) on 2026-03-10.

## Auth Flow (3 sequential fetches)

### Step 1: Get Bearer Token

```
POST https://{subdomain}.cps.golf/identityapi/myconnect/token/short
Content-Type: application/x-www-form-urlencoded

client_id=onlinereswebshortlived
```

Returns:
```json
{"access_token": "eyJ...", "expires_in": 600, "token_type": "Bearer", "scope": "onlinereservation references"}
```

The `client_id` is a public credential embedded in CPS's SPA (`env.js`). Not a secret.

### Step 2: Register Transaction ID

```
POST https://{subdomain}.cps.golf/onlineres/onlineapi/api/v1/onlinereservation/RegisterTransactionId
Content-Type: application/json
Authorization: Bearer {token}
{standard CPS headers}

{"transactionId": "<crypto.randomUUID()>"}
```

Returns bare `true` (boolean literal).

### Step 3: Query Tee Times

```
GET https://{subdomain}.cps.golf/onlineres/onlineapi/api/v1/onlinereservation/TeeTimes
  ?searchDate={formatted date}
  &courseIds={courseIds}
  &transactionId={uuid from step 2}
  &holes=0&numberOfPlayer=0&searchTimeType=0
  &teeOffTimeMin=0&teeOffTimeMax=23&isChangeTeeOffTime=true
  &teeSheetSearchView=5&classCode=R&defaultOnlineRate=N
  &isUseCapacityPricing=false&memberStoreId=1&searchType=1
Authorization: Bearer {token}
{standard CPS headers}
```

Query params are identical to v4 except `transactionId` is added. The `formatCpsDate` method (producing "Wed Apr 15 2026" format) is unchanged.

## Standard CPS Headers (shared by steps 2 and 3)

```
Authorization: Bearer {token}
client-id: onlineresweb
x-websiteid: {config.websiteId}
x-siteid: {config.siteId}
x-terminalid: {config.terminalId}
x-componentid: 1
x-moduleid: 7
x-productid: 1
x-ismobile: false
x-timezone-offset: {derived from config.timezone}
x-timezoneid: {config.timezone}
x-requestid: {crypto.randomUUID()}
```

## Response Format (v5)

The response is wrapped: `{transactionId, isSuccess, content}`.

**`content` is polymorphic:**
- Tee times available: `content` is an **array** of tee time objects
- No availability: `content` is an **object** with `messageKey: "NO_TEETIMES"`
- Distinguish with `Array.isArray(content)`

### Tee time object (v5)

```json
{
  "startTime": "2026-03-11T16:30:00",
  "holes": 18,
  "maxPlayer": 1,
  "courseName": "Encinitas Ranch",
  "courseId": 6,
  "shItemPrices": [
    {"shItemCode": "GreenFee18", "price": 44.0, "itemDesc": "Twilight M-Th"},
    {"shItemCode": "FullCart18", "price": 16.0, "itemDesc": "Cart 18 Public"}
  ]
}
```

### Field mapping (v4 → v5 → TeeTime)

| v4 field | v5 field | TeeTime output | Notes |
|----------|----------|----------------|-------|
| `TeeDateTime` | `startTime` | `time` | |
| `Holes` | `holes` | `holes` | `=== 9 ? 9 : 18` |
| `NumberOfOpenSlots` | `maxPlayer` | `openSlots` | Filter out `maxPlayer <= 0` |
| `GreenFee` | `shItemPrices[].price` | `price` | Find `shItemCode.startsWith("GreenFee")` → `.price`. Null if not found. |

## Config Changes

### platformConfig fields

| Field | Status | Notes |
|-------|--------|-------|
| `subdomain` | **Required** (validated by adapter) | Needed for token URL + API URL |
| `courseIds` | Keep | Unchanged |
| `websiteId` | Keep (optional in adapter code) | API will reject if missing |
| `siteId` | Keep (optional in adapter code) | API will reject if missing |
| `terminalId` | Keep (optional in adapter code) | API will reject if missing |
| `apiKey` | **Remove** | No longer used by v5 |
| `timezone` | **Add** (optional, defaults to `"America/Chicago"`) | IANA timezone name |

Only `subdomain` is validated as required by the adapter. Other fields are conditionally included in headers; the CPS API will reject requests with missing required headers, which provides a clear enough error.

### Timezone offset derivation

Compute `x-timezone-offset` from the `timezone` config value using the Intl API:
```ts
const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
const local = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
const offsetMinutes = (utc.getTime() - local.getTime()) / 60000;
```
DST-aware, no external dependencies, compatible with Cloudflare Workers.

The `formatCpsDate` method also uses the config timezone (instead of hardcoded `America/Chicago`) for consistency, though the noon-UTC trick prevents date boundary issues for all US timezones.

## Code Structure

Private methods for readability:
- `getToken(subdomain)` → Bearer token string
- `registerTransaction(baseUrl, token, headers)` → transaction ID (UUID)
- `buildHeaders(config, token)` → shared header object
- `fetchTeeTimes(config, date)` → orchestrates the 3-step flow

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `subdomain` missing | Throw "Missing subdomain in platformConfig" |
| Token fetch fails (network/HTTP) | Throw "CPS Golf token request failed: {details}" |
| RegisterTransactionId fails or returns non-true | Throw "CPS Golf transaction registration failed" |
| TeeTimes HTTP error | Throw "CPS Golf API returned HTTP {status}" |
| `isSuccess: true` + non-array content (NO_TEETIMES) | Return `[]` |
| No GreenFee in `shItemPrices` | `price = null` |
| `maxPlayer <= 0` | Filter out (don't include in results) |

## Test Strategy

### Fixture
Replace the v4 fixture (`cps-golf-tee-times.json`) with a trimmed v5 response extracted from the JC Golf HAR (Rancho Bernardo Inn data, trimmed to 3-4 representative tee times).

### Test helper
```ts
function mockCpsFlow(teeTimesResponse: unknown) {
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(/* token response */)
    .mockResolvedValueOnce(/* register response: true */)
    .mockResolvedValueOnce(new Response(JSON.stringify(teeTimesResponse)));
}
```

### Test cases
- Parses tee times from v5 response
- Extracts green fee from shItemPrices
- Handles 9-hole tee times
- Handles null/missing green fee (empty shItemPrices)
- Filters out maxPlayer <= 0
- Builds correct URLs and headers (no x-apikey, has Authorization Bearer)
- Handles NO_TEETIMES response (object content, not array)
- Handles empty content array
- Throws on token fetch failure
- Throws on RegisterTransactionId failure
- Throws on TeeTimes HTTP error
- Throws on network error
- Throws on missing subdomain

### courses.json changes
- Remove `apiKey` from Theodore Wirth config
- Add `timezone: "America/Los_Angeles"` to SD CPS courses (Encinitas Ranch, Twin Oaks, RBI)
- TC courses omit `timezone` (defaults to `America/Chicago`)

## Migration Safety

All CPS courses are currently `is_active: 0` or have broken configs (T. Wirth's v4 apiKey no longer works). No production traffic at risk. T. Wirth is also missing `siteId`/`terminalId` — these will be discovered via GetAllOptions when activating courses in spring.
