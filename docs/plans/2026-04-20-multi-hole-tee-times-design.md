# Multi-hole tee time display — design

**Date:** 2026-04-20
**Status:** Approved, ready for implementation planning

## Problem

Courses like Baker National (Championship tees) and Francis A Gross list some tee times as bookable for either 9 or 18 holes on the course's own booking site. This app silently drops one of the two options. The upstream API either returns a combined string like `"9/18"` in a single record (ForeUp) or returns separate records per hole count (Chronogolf), and the adapter code's `tt.holes === 9 ? 9 : 18` coercion either truncates multi-hole strings to 18 (ForeUp) or relies on multiple records existing (Chronogolf).

Test users want the UI to show these as a single merged row reading like the booking site does: `"9 / 18 holes"` with both green-fee prices.

## Approach

**(c) — Multi-row in DB, merge at display time.**

Two layers change; schema and API stay untouched.

### Adapter layer

Each adapter emits one `TeeTime` record per bookable hole variant for a given slot:

- **ForeUp** — when the upstream field is a combined string (`"9/18"`, `"9_18"`, etc.), expand into two records with identical other fields, one `holes: 9` and one `holes: 18`.
- **CPS Golf** — investigate during implementation whether multi-hole courses return combined records or separate-per-hole records. Expand if combined; leave if already separate.
- **Chronogolf** — API returns one record per `bookable_holes` value. No change expected; verify with live poll against Baker.
- **TeeItUp / Eagle Club / MemberSports** — audit for any combined-record shapes during implementation. Eagle Club is hardcoded 18 today; leave unless something else surfaces.

The existing `holes: 9 | 18` type on `TeeTime` is preserved. Only the *count* of emitted records changes.

### UI layer

In `src/components/tee-time-list.tsx`, after grouping by date, run a second grouping within each date group by `(course_id, time)`. Consecutive rows sharing that key collapse into one display card.

Display rules for a merged card:

- **Holes label:** `"9 / 18 holes"` (slash flanked by spaces, for visual parity with the price split).
- **Price label:** `"$30 / $55"` when both known; single `"$30"` when one is null; omitted when both null. Space-slash-space separator.
- **Open slots:** minimum across the merged rows (conservative — reports the scarcer resource).
- **Nines label:** show once when identical, comma-joined when different.
- **Three or more variants at the same key** (shouldn't happen, but safe): merge all, e.g., `"9 / 18 / 27 holes"`.

A solo row (one variant) renders exactly as today.

## Data flow

1. Cron polls course → adapter emits 1 or 2 records per slot depending on upstream shape.
2. `upsertTeeTimes` deletes existing rows for `(course, date)` and inserts fresh rows. Unchanged.
3. User loads search page. API runs `WHERE holes = ?` when filtered; the filter naturally matches one member of a multi-hole pair.
4. UI receives a flat row list, runs merge logic per date group, renders cards.

## Filter interaction

This is the design's centerpiece and why it's clean:

- **"9 holes only"** — DB returns only the 9-hole row of a multi-hole pair. UI sees one row, renders a solo card reading `"9 holes"`. Correct — user is filtering, the merged "9 / 18" label would lie.
- **"18 holes only"** — mirror of above.
- **"Any"** — DB returns both rows. UI merges. User sees `"9 / 18 holes"` card.

No special filter-aware logic in the merge helper — it merges what it's given.

## Components

- **`mergeHoleVariants(items: TeeTimeItem[]): DisplayTeeTime[]`** — pure function, lives alongside `tee-time-list.tsx` (or in a helper module). Easy to unit-test in isolation.
- **`DisplayTeeTime`** — extends `TeeTimeItem` with `holesLabel: string` and `priceLabel: string | null`. Raw `TeeTimeItem` stays as the wire format between API and UI.
- **`tee-time-list.tsx`** calls the helper inside its per-date map.

## Error handling & edge cases

- Three+ variants at the same key: safe-merged, no crash.
- One side null-priced, other priced: show the known price only.
- Both null-priced: omit price entirely (current behavior for solo rows).
- Variants differing by `$0.01` etc.: display both — no attempt to dedupe.
- `nines` differing across variants: comma-join (`"East/West, South/North"`).

## Testing

- **Adapter unit tests** — ForeUp at minimum: fixture with a `"9/18"` record, assert two `TeeTime` records emitted. Add CPS Golf fixture if investigation shows combined records.
- **Merge helper unit tests** — three cases at least: solo row passes through, two variants merge, three variants merge.
- **Render test** — in `tee-time-list.render.test.tsx`, add a case that renders two rows with same `(course, time)` and asserts the `"9 / 18 holes"` and `"$30 / $55"` text appears once.
- **Smoke tests** — existing `expect([9, 18]).toContain(tt.holes)` assertions should still pass since each emitted row's `holes` is still 9 or 18. Verify no regression.

## Out of scope

- Deep-link Book button modal for multi-hole selection (next feature; merged row shows a single Book button with current passthrough behavior).
- Any D1 schema change.
- 27/36-hole course support.
- Adding the 9/18 filter UI itself — that's feedback item #2, separate work after this lands.

## Why not the alternatives

- **(a) Two separate rows in the UI** — rejected. Test users said multi-entries clutter already-long lists, and the merged format matches how booking sites themselves display these slots.
- **(b) Schema change with array/pivoted columns** — rejected. Requires a migration and query changes, and the filter semantics get worse (have to special-case "9 only" to match slots whose array contains 9). Option (c) gets the same UI with no schema churn.
