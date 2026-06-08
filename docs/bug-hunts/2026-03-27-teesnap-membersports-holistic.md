# Bug Hunt Report — Holistic Analysis

## Scope
Analyzed the Teesnap adapter (`src/adapters/teesnap.ts`), MemberSports adapter (`src/adapters/membersports.ts`), adapter registry (`src/adapters/index.ts`), new course catalog entries in `src/config/courses.json`, and `src/config/areas.ts`. Cross-referenced against the `PlatformAdapter`/`TeeTime` interfaces in `src/types/index.ts`, the poller (`src/lib/poller.ts`), cron handler (`src/lib/cron-handler.ts`), DB layer (`src/lib/db.ts`), and sibling adapters (eagle-club, foreup, teeitup) for pattern comparison. Also read both test fixtures.

Approach: loaded every source file into context, then reasoned about correctness, pattern consistency, data flow through the polling pipeline, and edge cases.

## Bugs

No correctness bugs found.

Both adapters correctly implement the `PlatformAdapter` interface, produce well-formed `TeeTime` objects, throw on HTTP errors and malformed responses, validate required config fields, and handle their platform-specific edge cases (Teesnap's `date_not_allowed` seasonal closure, MemberSports' `bookingNotAllowed`/`hide` filtering).

Specific areas verified clean:

- **Teesnap availability calculation**: Golfer counts are correctly derived from `bookings[].golfers.length`, summed across non-held sections, subtracted from 4. Fully-booked and all-held tee times are filtered out.
- **Teesnap pricing**: 18-hole price preferred, 9-hole fallback works. `holes` field correctly reflects which price was selected. `parseFloat` + `isNaN` guard matches sibling adapter pattern.
- **MemberSports minutes-to-ISO conversion**: `minutesToIso()` correctly converts (e.g., 480 → `08:00`, 492 → `08:12`). Output format `YYYY-MM-DDTHH:MM:00` matches the `TeeTime.time` contract.
- **MemberSports string-to-int parsing**: `parseInt(golfClubId, 10)` with `isNaN` guard is correct for `platformConfig` values (which are always strings per the `Record<string, string>` type).
- **Adapter registry**: Both adapters imported and instantiated correctly. `platformId` strings match what's in courses.json.
- **Course catalog entries**: `platformConfig` fields match what each adapter destructures. City values map correctly in `areas.ts` (Dayton→North Metro, Stillwater→East Metro, Cottage Grove→East Metro).
- **Error propagation**: Both adapters throw on HTTP errors (not return `[]`), matching the pattern established by all sibling adapters. The poller catches these and logs them correctly.
- **DB compatibility**: Adapter output flows through `upsertTeeTimes()` which extracts `HH:MM` from the `T`-separated ISO time. Both adapters produce the expected `YYYY-MM-DDTHH:MM:00` format.

## Design Concerns

### Teesnap: hardcoded foursome maximum
**Location:** `src/adapters/teesnap.ts:99`

The availability calculation assumes `4 - totalBooked` as the maximum. Unlike MemberSports (which also hardcodes 4, but documents why in a comment on line 80), the Teesnap adapter doesn't document this assumption. More importantly, if a Teesnap course supports fivesomes or sixsomes, this would undercount availability. This is the same pattern used by MemberSports and is reasonable for the golf domain, but it's worth noting that the Teesnap API response does not appear to include a max-players field, so there's no way to derive the actual limit from the data.

### MemberSports: only first item per slot is examined
**Location:** `src/adapters/membersports.ts:77`

The adapter takes `slot.items[0]` and ignores any additional items. If the API ever returns multiple items per slot (e.g., different course configurations at the same time), only the first would be processed. The fixture data only has one item per slot, so this matches observed API behavior, but it's a fragile assumption if the API surface changes.

### Teesnap: potential double-counting in multi-section tee times
**Location:** `src/adapters/teesnap.ts:89-94`

If the same booking ID appears in multiple tee-off sections of a single tee time, the golfers for that booking would be counted once per section appearance. In practice, a booking should only appear in one section, but the code doesn't guard against this. The impact would be overcounting booked golfers (showing more availability than actually exists would be the opposite — it would show *less* availability, which is the safer failure mode).
