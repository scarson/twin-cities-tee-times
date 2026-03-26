# Remaining Courses Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Onboard 3 deferred courses: Brookview (CPS Golf V4), Inver Wood (TeeWire — new adapter), and Ft. Snelling (GolfNow — pending research, placeholder task).

**Architecture:** Brookview uses our existing CPS Golf adapter with a minor V4 auth flow fix. Inver Wood requires a new TeeWire adapter. Ft. Snelling (GolfNow) is TBD pending API research.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers

**Research docs:**
- `dev/research/remaining-platforms-investigation.md` — Brookview/GolfNow sections
- `dev/research/teewire-platform-investigation.md` — full TeeWire API details

**Scope:** Do NOT modify any existing adapter's behavior for currently-working courses. Do NOT add features beyond what's specified. Every new file MUST start with two `// ABOUTME:` comment lines. New course entries MUST include a unique `"index"` field (next available: check `courses.json` for the current max).

---

## Task 1: CPS Golf V4 Auth — Add Transaction Registration

**BEFORE starting work:**
1. Read `dev/testing-pitfalls-coverage-review.md`
2. Read `src/adapters/cps-golf.ts` — understand the V4 vs V5 branching
3. Read `src/adapters/cps-golf.test.ts` — understand existing test patterns
4. Follow TDD: write failing test → implement → verify green

**Depends on:** Nothing

**Files:**
- Modify: `src/adapters/cps-golf.ts`
- Modify: `src/adapters/cps-golf.test.ts`

**What's wrong:** The V4 auth path (`authType === "v4"`) currently skips transaction registration entirely. Brookview's V4 endpoint requires a `transactionId` even with apiKey auth. The fix: always call `registerTransaction` for V4 courses too, and include `transactionId` in the TeeTimes query params.

**Current V4 flow (cps-golf.ts lines 62-67):**
```
if (isV4) → build V4 headers → skip token + transaction → call TeeTimes
```

**Desired V4 flow:**
```
if (isV4) → build V4 headers → call registerTransaction with V4 headers → include transactionId → call TeeTimes
```

**Step 1: Write failing test**

In `src/adapters/cps-golf.test.ts`, in the `describe("v4 auth mode", ...)` block, add:

```typescript
it("registers transaction ID for v4 courses", async () => {
  const registerResponse = new Response(JSON.stringify(true), { status: 200 });
  const fetchSpy = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(registerResponse)  // RegisterTransactionId
    .mockResolvedValueOnce(                   // TeeTimes
      new Response(JSON.stringify(fixture), { status: 200 })
    );

  const results = await adapter.fetchTeeTimes(v4Config, "2026-03-12", v4Env);

  // 2 fetch calls: register + TeeTimes (not 3 — no token call)
  expect(fetchSpy).toHaveBeenCalledTimes(2);

  // First call: RegisterTransactionId
  const [registerUrl, registerInit] = fetchSpy.mock.calls[0];
  expect(registerUrl).toContain("/RegisterTransactionId");
  expect((registerInit as RequestInit).method).toBe("POST");
  expect((registerInit as RequestInit).headers).toHaveProperty("x-apikey", "test-v4-api-key");

  // Second call: TeeTimes with transactionId
  const [ttUrl] = fetchSpy.mock.calls[1];
  expect(ttUrl).toContain("/TeeTimes?");
  expect(ttUrl).toContain("transactionId=");

  expect(results).toHaveLength(3);
});
```

Also update the existing V4 test "skips token and transaction, uses apiKey header directly" — it currently expects 1 fetch call. After this change, V4 will make 2 calls (register + TeeTimes). Update the test name to "skips token but registers transaction for v4 courses" and change `expect(fetchSpy).toHaveBeenCalledTimes(1)` to `2`. Add a `registerResponse` mock before the TeeTimes mock.

Update the existing V4 proxy test similarly — it should expect 2 `proxyFetch` calls.

**Step 2: Run tests to verify they fail**

```bash
npx vitest run src/adapters/cps-golf.test.ts
```

**Step 3: Implement the fix**

In `src/adapters/cps-golf.ts`, change the V4 branch (around line 62-67). Currently:

```typescript
if (isV4) {
  const apiKey = env?.CPS_V4_API_KEY;
  if (!apiKey) {
    throw new Error("Missing CPS_V4_API_KEY secret for v4 auth");
  }
  headers = this.buildV4Headers(config, apiKey, timezone);
}
```

Change to:

```typescript
if (isV4) {
  const apiKey = env?.CPS_V4_API_KEY;
  if (!apiKey) {
    throw new Error("Missing CPS_V4_API_KEY secret for v4 auth");
  }
  headers = this.buildV4Headers(config, apiKey, timezone);
  const transactionId = await this.registerTransaction(
    baseUrl,
    apiKey,
    headers,
    proxy
  );
  params.set("transactionId", transactionId);
}
```

Wait — `registerTransaction` currently takes `(baseUrl, token, headers, proxy)` and uses `token` only in the headers it passes. But V4 headers already include the apiKey. Check: does `registerTransaction` add an `Authorization: Bearer {token}` header? Yes, at line 126 it spreads `...headers` and adds `Content-Type` and `x-requestid`. The V4 headers already have `x-apikey` instead of `Authorization`. So passing the V4 headers should work — the `token` parameter is only used to build `headers` in the V5 path, but here we pass pre-built V4 headers.

Actually, looking more carefully at `registerTransaction` (line 115-143), the second parameter is `token` but it's only used in the headers object passed to it. We're passing our own `headers` which already have the right auth. The `token` param is actually unused when `headers` is already populated. So just pass an empty string for `token`:

No wait — `registerTransaction` doesn't use the `token` param at all! It takes `(baseUrl, token, headers, proxy)` but only uses `baseUrl`, `headers`, and `proxy`. The `token` is dead code in the signature. So we can pass anything.

Actually let me re-read the function. It does `headers: { ...headers, "Content-Type": ... }`. So it uses the `headers` we pass. Good — the V4 headers with `x-apikey` will be spread into the RegisterTransactionId request.

The fix is just moving `registerTransaction` + `params.set("transactionId", ...)` into the V4 branch. Use the same call pattern as V5 but with V4 headers.

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/adapters/cps-golf.test.ts
```

**Step 5: Run full suite**

```bash
npm test && npx tsc --noEmit
```

**Step 6: Commit**

```
fix: add transaction registration to CPS Golf V4 auth flow

Brookview requires transactionId even with V4 apiKey auth.
The other V4 courses (Edinburgh, Oak Glen, Victory Links, Gem Lake)
also accept it — registerTransaction returns true for all of them.
```

**BEFORE marking this task complete:**
1. Verify the existing V4 tests still pass (updated expectations)
2. Verify V5 tests are untouched and still pass
3. Run `npm test && npx tsc --noEmit` and confirm green

---

## Task 2: Add Brookview Courses to Catalog

**BEFORE starting work:**
1. Task 1 must be complete (V4 auth needs transaction registration for Brookview)
2. Read `src/config/courses.json` — understand the entry format
3. Read `src/config/areas.ts` — verify "Golden Valley" is mapped

**Depends on:** Task 1

**Files:**
- Modify: `src/config/courses.json`
- Modify: `src/config/areas.ts` (only if Golden Valley is missing — it was added in PR 42)

**Step 1: Add Brookview Regulation course**

Add to `courses.json` before the SD test courses. Use the next available `index` value (check current max with `grep '"index"' src/config/courses.json | sort -t: -k2 -n | tail -1`).

```json
{
  "index": NEXT_INDEX,
  "id": "brookview-regulation",
  "name": "Brookview Regulation",
  "city": "Golden Valley",
  "state": "MN",
  "address": "200 Brookview Pkwy, Golden Valley, MN 55426",
  "platform": "cps_golf",
  "platformConfig": {
    "subdomain": "brookview",
    "websiteId": "DISCOVER_VIA_GETALLOPTIONS",
    "courseIds": "1,2",
    "authType": "v4"
  },
  "bookingUrl": "https://brookview.cps.golf/onlineresweb"
}
```

**Important:** The `websiteId` needs to be discovered. Use WebFetch to call:
```
GET https://brookview.cps.golf/onlineresweb/Home/Configuration
```
Extract the `websiteId` from the response JSON. Then also call:
```
GET https://brookview.cps.golf/onlineres/onlineapi/api/v1/onlinereservation/GetAllOptions/brookview
```
with headers `x-apikey: 8ea2914e-cac2-48a7-a3e5-e0f41350bf3a` and `x-componentid: 1` to confirm courseIds. The research found:
- courseId 1 = Brookview Front 9
- courseId 2 = Brookview Back 9
- courseId 3 = Par 3

**Step 2: Add Brookview Par 3 course**

```json
{
  "index": NEXT_INDEX + 1,
  "id": "brookview-par3",
  "name": "Brookview Par-3",
  "city": "Golden Valley",
  "state": "MN",
  "address": "200 Brookview Pkwy, Golden Valley, MN 55426",
  "platform": "cps_golf",
  "platformConfig": {
    "subdomain": "brookview",
    "websiteId": "SAME_AS_REGULATION",
    "courseIds": "3",
    "authType": "v4"
  },
  "bookingUrl": "https://brookview.cps.golf/onlineresweb"
}
```

**Step 3: Verify Golden Valley is in area mappings**

Check `src/config/areas.ts` — Golden Valley should already be mapped to "South Metro" from PR 42. If not, add it.

**Step 4: Regenerate seed SQL and run tests**

```bash
npx tsx scripts/seed.ts
npm test && npx tsc --noEmit
```

**Step 5: Commit**

```
feat: add Brookview Regulation and Par-3 to catalog (CPS Golf V4)
```

**BEFORE marking this task complete:**
1. Verify `websiteId` was discovered (not a placeholder)
2. Verify `npm test` passes
3. Verify Golden Valley is mapped in areas.ts

---

## Task 3: TeeWire Adapter

**BEFORE starting work:**
1. Read `dev/research/teewire-platform-investigation.md` — full API details
2. Read `src/adapters/foreup.ts` and `src/adapters/foreup.test.ts` — adapter pattern to follow
3. Read `src/adapters/foreup.smoke.test.ts` — smoke test pattern
4. Read `dev/testing-pitfalls-coverage-review.md`
5. Follow TDD: write failing test → implement → verify green

**Depends on:** Nothing (independent of Tasks 1-2)

**Files:**
- Create: `src/adapters/teewire.ts`
- Create: `src/adapters/teewire.test.ts`
- Create: `src/test/fixtures/teewire-tee-times.json`
- Modify: `src/adapters/index.ts` (register adapter)
- Modify: `src/adapters/index.test.ts` (add lookup test)
- Modify: `src/adapters/teewire.smoke.test.ts` (if a stub exists — otherwise check; there may not be one since TeeWire wasn't originally planned)

**Adapter requirements:**
- `platformId` MUST be `"teewire"`
- MUST use `AbortSignal.timeout(10000)` on fetch calls
- MUST set `User-Agent: TwinCitiesTeeTimes/1.0` header (Cloudflare blocks requests without UA)
- MUST throw on HTTP errors (non-2xx)
- MUST throw on missing required config fields (`tenant`, `calendarId`)
- MUST parse price from formatted string `"$51.00"` → `51.00`
- MUST select the walking green fee rate (find the rate where `rate_title` contains "Walking" and `holes` matches the calendar type)
- Tests MUST cover: platformId, parsing, price parsing, error handling, missing config, empty response

**API details (from research):**

```
GET https://teewire.app/{tenant}/online/application/web/api/golf-api.php?action=tee-times&calendar_id={calendarId}&date={YYYY-MM-DD}
Headers: User-Agent: TwinCitiesTeeTimes/1.0
```

Response shape:
```json
{
  "success": true,
  "data": {
    "tee_times": [
      {
        "time": "09:00:00",
        "date": "2026-04-09",
        "availability": { "available_spots": 2 },
        "pricing": {
          "rates": [
            { "rate_title": "18 Holes Walking", "holes": 18, "price": "$51.00" },
            { "rate_title": "18 Holes Riding", "holes": 18, "price": "$77.00" }
          ]
        }
      }
    ]
  }
}
```

**platformConfig shape:**
```typescript
{
  tenant: string;     // e.g., "inverwood"
  calendarId: string; // e.g., "3"
}
```

**Step 1: Create test fixture**

Create `src/test/fixtures/teewire-tee-times.json` with 3 representative tee times. Include variety: different times, different available_spots, one with only 9-hole rates.

```json
{
  "success": true,
  "data": {
    "tee_times": [
      {
        "slot_id": 1,
        "time": "09:00:00",
        "date": "2026-04-15",
        "time_us_format": "9:00am",
        "availability": {
          "available_spots": 4,
          "max_spots": 4,
          "reserved_spots": 0
        },
        "pricing": {
          "rates": [
            { "rate_id": 33, "rate_title": "18 Holes Walking", "holes": 18, "price": "$51.00" },
            { "rate_id": 35, "rate_title": "18 Holes Riding", "holes": 18, "price": "$77.00" },
            { "rate_id": 36, "rate_title": "9 Holes Walking", "holes": 9, "price": "$28.00" },
            { "rate_id": 37, "rate_title": "9 Holes Riding", "holes": 9, "price": "$44.00" }
          ]
        },
        "available_holes": [9, 18]
      },
      {
        "slot_id": 2,
        "time": "09:10:00",
        "date": "2026-04-15",
        "time_us_format": "9:10am",
        "availability": {
          "available_spots": 2,
          "max_spots": 4,
          "reserved_spots": 2
        },
        "pricing": {
          "rates": [
            { "rate_id": 33, "rate_title": "18 Holes Walking", "holes": 18, "price": "$51.00" },
            { "rate_id": 35, "rate_title": "18 Holes Riding", "holes": 18, "price": "$77.00" }
          ]
        },
        "available_holes": [18]
      },
      {
        "slot_id": 3,
        "time": "14:30:00",
        "date": "2026-04-15",
        "time_us_format": "2:30pm",
        "availability": {
          "available_spots": 1,
          "max_spots": 4,
          "reserved_spots": 3
        },
        "pricing": {
          "rates": [
            { "rate_id": 36, "rate_title": "9 Holes Walking", "holes": 9, "price": "$28.00" },
            { "rate_id": 37, "rate_title": "9 Holes Riding", "holes": 9, "price": "$44.00" }
          ]
        },
        "available_holes": [9]
      }
    ]
  }
}
```

**Step 2: Write failing tests**

Create `src/adapters/teewire.test.ts`. Required test cases:

```typescript
it("has the correct platformId") // "teewire"
it("parses tee times from API response") // full TeeTime shape for first result
it("selects walking rate price") // $51.00 → 51, not riding $77
it("determines holes from walking rate") // 18 for first slot, 9 for third
it("builds the correct API URL") // contains tenant, calendarId, date
it("sets User-Agent header") // spy on fetch, check UA
it("throws on HTTP error") // mock 500
it("throws on network error") // mock rejection
it("throws when tenant is missing") // missing config
it("throws when calendarId is missing") // missing config
it("returns empty array when no tee times") // empty tee_times array
it("parses price from formatted string") // "$51.00" → 51
```

**Step 3: Run tests to verify they fail**

```bash
npx vitest run src/adapters/teewire.test.ts
```

**Step 4: Implement the adapter**

Create `src/adapters/teewire.ts`:

- Parse each tee time from `data.tee_times`
- For price: find the rate where `rate_title` includes `"Walking"`, take the first match. Parse `"$51.00"` → `51.00` using `parseFloat(price.replace(/[^0-9.]/g, ""))`.
- For holes: use the walking rate's `holes` field (9 or 18)
- For time: convert `"09:00:00"` to ISO `"2026-04-15T09:00:00"` using the `date` parameter
- For openSlots: use `availability.available_spots`
- Filter out slots with `available_spots === 0`

**Step 5: Run tests to verify they pass**

```bash
npx vitest run src/adapters/teewire.test.ts
```

**Step 6: Register adapter**

In `src/adapters/index.ts`:
```typescript
import { TeeWireAdapter } from "./teewire";
// add new TeeWireAdapter() to the adapters array
```

In `src/adapters/index.test.ts`:
```typescript
it("returns TeeWireAdapter for teewire platform", () => {
  const adapter = getAdapter("teewire");
  expect(adapter).toBeDefined();
  expect(adapter!.platformId).toBe("teewire");
});
```

**Step 7: Run all tests**

```bash
npm test && npx tsc --noEmit
```

**Step 8: Commit**

```
feat: add TeeWire adapter for Inver Wood Golf Course
```

**BEFORE marking this task complete:**
1. Review tests against `dev/testing-pitfalls-coverage-review.md`
2. Verify: error paths tested? Missing config tested? Price parsing edge cases?
3. Run `npm test && npx tsc --noEmit` and confirm green

---

## Task 4: Add Inver Wood Courses to Catalog

**BEFORE starting work:**
1. Task 3 must be complete (TeeWire adapter needed)
2. Read `src/config/courses.json` — entry format
3. Verify "Inver Grove Heights" is in `src/config/areas.ts` (should be "East Metro" from PR 42)

**Depends on:** Task 3

**Files:**
- Modify: `src/config/courses.json`

**Step 1: Add Inver Wood Championship 18**

```json
{
  "index": NEXT_INDEX,
  "id": "inver-wood-18",
  "name": "Inver Wood Championship",
  "city": "Inver Grove Heights",
  "state": "MN",
  "address": "1850 70th St E, Inver Grove Heights, MN 55077",
  "platform": "teewire",
  "platformConfig": {
    "tenant": "inverwood",
    "calendarId": "3"
  },
  "bookingUrl": "https://teewire.app/inverwood/index.php?controller=FrontV2&action=load&cid=3&view=list"
}
```

**Step 2: Add Inver Wood Executive 9**

```json
{
  "index": NEXT_INDEX + 1,
  "id": "inver-wood-9",
  "name": "Inver Wood Executive",
  "city": "Inver Grove Heights",
  "state": "MN",
  "address": "1850 70th St E, Inver Grove Heights, MN 55077",
  "platform": "teewire",
  "platformConfig": {
    "tenant": "inverwood",
    "calendarId": "16"
  },
  "bookingUrl": "https://teewire.app/inverwood/index.php?controller=FrontV2&action=load&cid=16&view=list"
}
```

**Step 3: Regenerate seed SQL and run tests**

```bash
npx tsx scripts/seed.ts
npm test && npx tsc --noEmit
```

**Step 4: Commit**

```
feat: add Inver Wood Championship and Executive to catalog (TeeWire)
```

---

## Task 5: GolfNow Adapter (Ft. Snelling) — PLACEHOLDER

**Status:** Pending API research. The GolfNow research agent is still running. This task will be updated with specific implementation details once research completes.

**If research finds a usable API:**
- Build GolfNow adapter following the same pattern as TeeWire (Task 3)
- Add Ft. Snelling to catalog
- `platformId`: `"golfnow"`, facility ID: `18122`

**If research finds the API is blocked/requires auth we can't provide:**
- Document findings in `dev/research/remaining-platforms-investigation.md`
- Add Ft. Snelling to catalog with `"disabled": 1` as a placeholder
- Defer to a future session

---

## Task 6: Update Research Documentation

**Depends on:** All previous tasks complete

**Files:**
- Modify: `dev/research/remaining-platforms-investigation.md`

**What to do:**
- Update the Brookview section: change status from "Deferred" to "Implemented". Note that `brookview.cps.golf` works with V4 apiKey auth (no WAF issue via this route). Remove the "Feasibility" concerns about ProphetServices WAF.
- Update the TeeWire section: change status from "Deferred" to "Implemented".
- Update the GolfNow section based on research findings.
- Update the Platform Comparison Summary table to reflect new adapter status.

**Commit:**

```
docs: update platform research with Brookview and TeeWire implementation status
```

---

## Review Checkpoints

**After Tasks 1-2 (CPS Golf V4 fix + Brookview catalog):**
```
You MUST carefully review the batch of work from multiple perspectives
and revise/refine as appropriate. Repeat this review loop (minimum three
rounds) until you're confident there aren't any more issues.
```

**After Tasks 3-4 (TeeWire adapter + Inver Wood catalog):**
```
Same review loop as above.
```

---

## Parallelization Notes

- **Tasks 1-2** (CPS Golf V4 fix + Brookview) are sequential (Task 2 depends on Task 1)
- **Tasks 3-4** (TeeWire adapter + Inver Wood) are sequential (Task 4 depends on Task 3)
- **Tasks 1-2 and Tasks 3-4 are independent** — can run in parallel
- **Task 5** (GolfNow) is independent but pending research
- **Task 6** (docs) runs last after everything else
