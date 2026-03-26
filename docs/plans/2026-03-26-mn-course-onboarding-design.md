# MN Course Onboarding Design

**Date:** 2026-03-26
**Status:** Approved

## Goal

Shift from San Diego test courses to live Minnesota courses now that the 2026 season is opening. Onboard ~25 MN courses across 5 platforms, build 2 new adapters (Chronogolf, Eagle Club), and add a `nines` field to support multi-nine courses like Bunker Hills.

## Course List

### Already in catalog (existing adapters)

These CPS Golf and ForeUp courses are already in `courses.json` with working adapters. Need live verification now that MN courses are opening.

| Course | Platform | Notes |
|--------|----------|-------|
| Theodore Wirth | CPS Golf | Opening late March 2026 |
| Gross National | CPS Golf | Opening March 25 |
| Meadowbrook | CPS Golf | Opening March 29 |
| Columbia | CPS Golf | Opening March 25 |
| Hiawatha | CPS Golf | Opening late March |
| Phalen | CPS Golf | St. Paul |
| Highland National | CPS Golf | St. Paul |
| Como Park | CPS Golf | St. Paul |
| Edinburgh USA | CPS Golf | Brooklyn Park |
| Chaska Town Course | CPS Golf | |
| Braemar | ForeUp | Edina |
| Bunker Hills | ForeUp | Needs `scheduleId: "5010"` added |

### New catalog entries (existing adapters)

| Course | Platform | Config source |
|--------|----------|---------------|
| Keller | TeeItUp | tenant: `ramsey-county-golf`, facilityId: `17055` (from research) |
| Inver Wood 18 | TeeItUp | Discover alias, apiBase, facilityId from booking page |
| Inver Wood 9 (Executive) | TeeItUp | Discover from same tenant |
| Bluff Creek | TeeItUp | Older URL format (`teeitup.com/golf/course.wpl?C=55317`) — verify compatibility |
| Pioneer Creek | CPS Golf | subdomain: `pioneercreek`, websiteId: `07ecdaf7-4af5-4b9f-40c3-08dc8bc4f610`, courseIds: `5` |

### New catalog entries (new Chronogolf adapter)

| Course | Platform | Config |
|--------|----------|--------|
| Baker National Championship 18 | Chronogolf | clubId: `8320`, courseId: `9602` |
| Baker National Evergreen 9 | Chronogolf | clubId: `8320`, courseId: `9603` |
| Majestic Oaks | Chronogolf | Discover clubId; 45 holes — may need multiple entries |
| Dwan | Chronogolf | Discover clubId from slug |
| Rush Creek | Chronogolf | Discover clubId from slug |
| Anoka Greenhaven | Chronogolf | Discover clubId from slug |

### New catalog entry (new Eagle Club adapter)

| Course | Platform | Config |
|--------|----------|--------|
| Valleywood | Eagle Club | dbname: `mnvalleywood20250115` |

### Deferred (not in catalog)

| Course | Platform | Reason |
|--------|----------|--------|
| Brookview Regulation | CPS Golf V4 (ProphetServices) | Behind AWS WAF + V4 API differs from V5 |
| Brookview Par-3 | CPS Golf V4 (ProphetServices) | Same as above |
| Ft. Snelling | GolfNow | API not yet investigated |

These are documented in `dev/research/remaining-platforms-investigation.md` for future work.

### San Diego test courses

Remain in catalog but sort below MN courses (see Sort Order below).

## New Adapters

### Chronogolf Adapter

**API base:** `https://www.chronogolf.com`

**Tee time endpoint (unverified, needs live discovery):**
```
GET /marketplace/clubs/{clubId}/teetimes?date=YYYY-MM-DD&course_id={courseId}&affiliation_type_id={typeId}
```

**platformConfig shape:**
```json
{
  "clubId": "8320",
  "courseId": "9602",
  "affiliationTypeId": "..."
}
```

**Key unknowns to resolve during implementation:**
1. **Tee time endpoint** — predicted URL pattern above, but never verified (courses were closed during March research). Courses are open now.
2. **CSRF token** — API uses `x-csrf-token`. May or may not be required for read-only tee time fetches. If required, fetch the widget page first to extract the token.
3. **Cloudflare IP blocking** — If Chronogolf blocks Workers' shared IPs, route through the Lambda fetch proxy (add `chronogolf.com` to `ALLOWED_HOSTS`).

**Known config (from research):**
- Baker National: clubId `8320`, courseIds `9602` (Championship 18), `9603` (Evergreen 9)
- Affiliation types discoverable from `/marketplace/organizations/{clubId}/affiliation_types`
- Other courses: clubId discoverable from `/marketplace/clubs/{slug}` or similar

### Eagle Club Adapter

**API base:** `https://api.eagleclubsystems.online`

**Key endpoint:**
```
POST /api/online/OnlineAppointmentRetrieve
Body: { "dbname": "mnvalleywood20250115", ... }
```

**platformConfig shape:**
```json
{
  "dbname": "mnvalleywood20250115"
}
```

**Key unknowns:**
1. **Exact request body format** — research says "needs further investigation." Reverse-engineer from the Angular app's network traffic.
2. **Response mapping** — `LstAppointment` array needs mapping to `TeeTime[]`. Rate info from `LstRackRate` via `OnlineTheRestRetrieve`.

**Known risk:** The `dbname` contains a date stamp (`20250115`) that may rotate periodically. Document this; don't over-engineer a solution.

## Type Changes

### Add `nines` field to `TeeTime`

```typescript
export interface TeeTime {
  courseId: string;
  time: string;
  price: number | null;
  holes: 9 | 18;
  openSlots: number;
  bookingUrl: string;
  nines?: string; // e.g., "East/West" for multi-nine courses
}
```

**Motivation:** Bunker Hills (27 holes, 3 nines) returns up to 3 tee times per time slot — one per nine combination (East/West, West/North, North/East). Without the `nines` field, users see triplicate times with no way to distinguish them.

**ForeUp source fields:** `teesheet_side_name` (first nine) + `reround_teesheet_side_name` (second nine).

**UI:** Display nines label alongside the tee time for courses that have it. Omit for standard 18-hole courses.

### Add `state` field to course catalog

Add `"state": "MN"` or `"state": "CA"` to each entry in `courses.json`. API routes and UI sort MN courses first, then alphabetically within each state group.

Also add `state` column to the `courses` D1 table (migration required) and `CourseRow` type.

## Bunker Hills Config Update

Add `scheduleId` to existing catalog entry:

```json
{
  "facilityId": "20252",
  "scheduleId": "5010"
}
```

The single schedule covers all three nines. The ForeUp adapter parses `teesheet_side_name` / `reround_teesheet_side_name` to populate the `nines` field.

## Implementation Order

1. **TeeItUp MN config + Pioneer Creek** — lowest risk, immediate wins with live MN data
2. **Bunker Hills fix + `nines` field + `state` sort** — small targeted changes
3. **Eagle Club adapter** — 1 course, simpler API, quick win
4. **Chronogolf adapter** — most courses, most unknowns, benefits from being last (live API discovery)
5. **Live verification** — confirm all existing + new MN courses return data

## Open Items

- **Majestic Oaks course count** — 45 holes, may need multiple catalog entries. Discover during Chronogolf implementation.
- **Bluff Creek TeeItUp URL format** — older `teeitup.com/golf/course.wpl?C=55317` pattern. Verify our adapter's config discovery works with this format.
- **Chronogolf CSRF** — may or may not be required. Resolve during adapter implementation.
- **Eagle Club request body** — exact format for `OnlineAppointmentRetrieve`. Reverse-engineer during implementation.
