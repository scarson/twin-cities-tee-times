# San Diego Test Courses — Platform Research

**Date:** 2026-03-08
**Purpose:** Father-in-law's suggestion to use San Diego courses for live API testing while MN courses are closed (Nov–Apr). These SD courses let us verify our adapters against real tee time data.

## Platform Summary

| Course | City | Holes | Platform | Booking URL / ID | Notes |
|---|---|---|---|---|---|
| Encinitas Ranch | Encinitas | 18 | **CPS Golf** | `jcgsc5.cps.golf/onlineresweb` (public) | JC Golf managed; also `jcgres5` (resident), `jcplayer5` (JC Player) |
| Twin Oaks | San Marcos | 18 | **CPS Golf** | Via JC Golf booking dropdown | Gift cards at `w.cps.golf/TwinOaksWebstore`; JC Golf managed |
| Rancho Bernardo Inn | San Diego | 18 | **CPS Golf** (likely) | Via JC Golf booking dropdown | Also listed on Chronogolf; JC Golf managed — likely CPS underneath |
| Oceanside Muni | Oceanside | 18 | **ForeUp** | `foreupsoftware.com/index.php/booking/index/19162/1202` | City of Oceanside |
| Goat Hill Park | Oceanside | 18 (short) | **ForeUp** | `foreupsoftware.com/index.php/booking/20906/6161` | Footer: "Powered by foreUP" |
| Balboa Park | San Diego | 18 | **ForeUp** | `foreupsoftware.com/index.php/booking/19348/1470` | City of San Diego |
| Torrey Pines (N+S) | La Jolla | 36 | **ForeUp** | `foreupsoftware.com/index.php/booking/19347` | City of San Diego; advance res via phone/online portal |
| Lomas Santa Fe | Solana Beach | 18 (exec) | **TeeItUp** | `lomas-santa-fe-executive-golf-course.book.teeitup.com` | American Golf Corp; kenna.io backend confirmed in console |
| Coronado | Coronado | 18 | **TeeItUp** | `coronado-gc-3-14-be.book.teeitup.com` (advance), `coronado-resident.book.teeitup.com` (resident) | $25/person advance booking fee |

## Platform Coverage vs. Twin Cities Adapters

| TC Platform | Phase | SD Test Courses | Coverage |
|---|---|---|---|
| **CPS Golf** | Phase 1 | Encinitas Ranch, Twin Oaks, (Rancho Bernardo Inn) | Yes — can test CPS adapter with live data |
| **ForeUp** | Phase 1 | Oceanside, Goat Hill, Balboa Park, Torrey Pines | Yes — 4 courses with live data! |
| **TeeItUp** | Phase 2 | Lomas Santa Fe, Coronado | Yes — can test TeeItUp adapter with live data |
| **Eagle Club Systems** | Phase 2 | (none found) | No SD equivalent |
| **Chronogolf** | Phase 3 | Rancho Bernardo Inn (if not CPS) | Maybe — needs verification |

**4 of 5 TC platforms have SD test courses.** Only Eagle Club Systems (1 course: Valleywood) lacks an SD equivalent. Eagle Club is Phase 2 anyway.

## Key Findings

### CPS Golf (JC Golf)
- JC Golf manages ~15 courses across Southern California, all using CPS Golf for tee times
- The CPS subdomain pattern differs from TC courses: `jcgsc5.cps.golf` vs `minneapolistheodorewirth.cps.golf`
- The "5" suffix may indicate a CPS version or region — the API endpoint structure should be the same
- API keys need to be discovered per-course via `GetAllOptions` endpoint (same as TC)

### ForeUp
- City of San Diego runs 3 courses (Torrey Pines, Balboa Park, Mission Bay) all on ForeUp
- These are high-traffic public courses with constant availability — ideal for testing
- ForeUp facility IDs discovered: Torrey Pines (19347), Balboa Park (19348/1470), Oceanside (19162/1202), Goat Hill (20906/6161)

### TeeItUp
- Both Lomas Santa Fe and Coronado use the `.book.teeitup.com` domain
- Backend is kenna.io (confirmed in browser console logs)
- The `x-be-alias` header pattern should be discoverable from the booking page config (same as TC's Keller)

### Rancho Bernardo Inn
- Managed by JC Golf (in their booking dropdown)
- Also listed on `chronogolf.com/club/rancho-bernardo-inn-golf-resort-spa`
- Likely CPS Golf under the hood (same as other JC Golf courses), with Chronogolf as aggregator
- Good test case for disambiguating primary platform vs aggregator listing

## Testing Strategy

During Phase 1 development (before MN courses open ~April):
1. **CPS Golf adapter:** Test against Encinitas Ranch (`jcgsc5.cps.golf`) — discover API key via `GetAllOptions`, verify tee time response format, record fixture
2. **ForeUp adapter:** Test against Balboa Park (facility 19348, schedule 1470) or Goat Hill (20906/6161) — verify response format, record fixture
3. **TeeItUp adapter (Phase 2 prep):** Test against Lomas Santa Fe — discover `x-be-alias` from page config, verify tee time endpoint

This removes the "winter testing gap" risk from the design doc for the first 3 platforms.
