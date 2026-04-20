# Overnight execution — decision log

**Session start:** 2026-04-20 ~23:32 CT
**Scope:** Multi-hole tee time feature, Tasks 4–10 of [2026-04-20-multi-hole-tee-times-plan.md](./2026-04-20-multi-hole-tee-times-plan.md)
**Authorization:** Sam authorized autonomous execution with (a) 3x+ adversarial review per significant decision, (b) persistent documentation here, (c) non-destructive git actions. Sam is asleep; work continues unless catastrophic.

---

## Decision log

Entries added as work progresses. Each entry: decision, rationale, review results, alternatives considered.

---

### D-1 — Teesnap: empty-prices slots are skipped (Task 4)

**Decision:** When a Teesnap tee time slot has `prices: []` (empty), skip it entirely rather than emitting a holes=9/price=null fallback record.

**Current behavior:** The pre-fix code produces `{holes: 9, price: null}` for empty-prices slots via its `holes: eighteenPrice ? 18 : 9` fallthrough. This is a silent mispresentation — the slot has no bookable price information but surfaces as "9 holes, unknown price."

**New behavior:** Iterate the prices array, emit one record per known roundType (NINE_HOLE → holes=9, EIGHTEEN_HOLE → holes=18). Unknown roundTypes are skipped. Empty or all-unknown prices arrays produce zero records for that slot.

**3x adversarial review:**
1. **Can an empty-prices slot be legitimately bookable?** Reviewing the Teesnap API shape: prices are always present when a slot is bookable. An empty prices array implies the slot is in some kind of administrative limbo (held, reserved, etc.). Section filtering above already skips held slots. An empty-prices slot after that filter is anomalous and has no meaningful price to show — skipping is correct.
2. **Regression risk for users?** Users who saw "9 holes, no price" slots previously will now see fewer listings at those times. That's a feature, not a regression — the prior data was misleading. If Teesnap starts returning bookable slots with empty prices, we'd want to reconsider, but that's not today's shape.
3. **Test coverage impact?** No existing test exercises empty-prices behavior. Adding one as a regression guard.

**Alternatives considered:** (a) emit a `price: null, holes: 18` record (arbitrary hole count for display) — rejected, misleading; (b) throw on empty prices — rejected, too aggressive for a data quirk that might be legitimate for held/admin slots we've already filtered.

---

### D-2 — TeeItUp: proactive multi-hole fix without live confirmation (Task 6)

**Decision:** Apply the same "iterate rates, group by holes, emit per-group" fix to TeeItUp that was applied to Teewire, without waiting for live multi-hole evidence.

**Context:** TeeItUp's adapter uses `tt.rates.find((r) => !r.trade) ?? tt.rates[0]` to pick one rate per tee time, silently dropping rates with other `holes` values. The fixture has only single-rate arrays (no multi-hole evidence). Smoke test ran green but doesn't output raw API contents to verify multi-hole shapes.

**Rationale for proactive fix:**
1. The interface `rates: TeeItUpRate[]` (plural) with per-rate `holes: number` field is identical in structure to Teewire, which we just confirmed silently truncates multi-hole.
2. The adapter's `.find()` selection pattern is the same anti-pattern as Teewire's.
3. A defensive fix (iterate + group) has zero downside for single-rate-per-slot cases (degenerates to current behavior) and correctly handles multi-hole if it shows up.
4. Keller (one of Sam's father-in-law's favorite courses) uses TeeItUp. If Keller's API data has multi-hole variants, proactive fix benefits the user; waiting for spring/fall live data wastes a bug cycle.
5. Plan's explicit guidance: "proceed with Step 2 defensively — the fix emitting one record per rate is safe even if live data never shows multiple rates."

**3x adversarial review:**
1. **Could TeeItUp return rates with the SAME holes value but different rate types (e.g., two 18-hole rates at different prices for different golfer tiers)?** Yes — the `trade: boolean` flag and current `.find(!trade)` logic suggest this. My fix preserves trade-avoidance within each hole group. So if a slot has two 18-hole rates (one trade, one not), I pick the non-trade one, just like today. No regression.
2. **Could the fix emit duplicate records if the API returns multiple rates with the same holes value (e.g., two 18-hole non-trade rates with different golfer types)?** My group-by-holes logic groups them into one bucket, picks the non-trade one, emits ONE record per group. Only emits multiple records when the groups actually span different hole counts. No duplication.
3. **Could this fix introduce subtle price-attribution bugs?** Within a group, my `find(!trade) ?? group[0]` picks the same rate that current code would pick if the group were the full rates array. Price attribution is preserved.

**Alternatives considered:** (a) wait for live confirmation — rejected, costs a full round-trip + likely fruitless with SD courses, which may not be multi-hole anyway; (b) skip TeeItUp entirely — rejected, ignores strong structural evidence of the bug.

---

### D-3 — CPS Golf: multi-hole via GreenFee{N} shItemCode SKUs (Task 7)

**Decision:** CPS Golf's multi-hole signal lives in `shItemPrices` as `shItemCode` values `GreenFee9` and `GreenFee18`. The adapter now iterates these codes and emits one record per priced hole count, deriving `holes` from the code rather than from `tt.holes`.

**Context (live probe finding):** Ran direct CPS API probe against Francis A Gross (`courseIds: "5,7"`). Raw response characteristics:
- 50 records returned for a single day.
- ALL records have `holes: 9` at the record level (suggesting CPS reports the minimum bookable hole count there, not the available variants).
- ALL 50 records include BOTH `GreenFee9` and `GreenFee18` in their `shItemPrices` array, with distinct prices.
- Record includes `isContain9HoleItems` and `isContain18HoleItems` flag fields (not inspected but redundant with the price inspection).
- `is18HoleOnly` field is ABSENT on multi-hole courses (present as `true` on Twin Oaks / Encinitas single-hole courses).
- No duplicate records per startTime — one record per slot, combined prices.

Current adapter's behavior on Francis A Gross: `tt.holes === 9 ? 9 : 18` → `holes: 9` (since tt.holes is literally 9); `extractGreenFee` picks FIRST `GreenFee*` in the array → `GreenFee18` price. Result: users see `"9 holes, $43.71"` which is a 9-hole label attached to the 18-hole price. Doubly incorrect.

**New behavior:** Iterate `shItemPrices`, find entries where `shItemCode === "GreenFee9"` or `shItemCode === "GreenFee18"`. Emit one TeeTime per found entry with `holes` derived from the code and `price` from the matching entry. Records with no `GreenFee*` SKU are skipped (no known greens fee — not bookable in a user-facing sense).

**3x adversarial review:**
1. **Could a course have `GreenFee*` SKUs that aren't 9 or 18 (e.g., `GreenFee27`)?** Possible in theory; skipping unknown SKUs is the defensive choice. Matches design's out-of-scope policy for 27/36-hole courses.
2. **What if an 18-only course has only `GreenFee18`?** Adapter emits one record with `holes: 18` correctly. Twin Oaks / Encinitas smoke tests show `holes: 18` today — new logic would give same result (`GreenFee18` → `holes: 18`).
3. **What if `shItemPrices` is empty or lacks any `GreenFee*`?** Current code would emit a record with `price: null, holes: 9` (after `tt.holes === 9 ? 9 : 18`). New behavior skips the record. Consistent with D-1 (Teesnap): we don't surface slots with no known price-hole linkage. Loss is marginal (a slot with unknown cost wasn't useful anyway).
4. **Non-greens-fee SKUs in shItemPrices (FullCart18, CartRental, tax, etc.)?** Filtered out by exact `shItemCode === "GreenFee9" | "GreenFee18"` match. Not included in hole-variant detection.

**Alternatives considered:** (a) use `isContain9HoleItems` / `isContain18HoleItems` flags — rejected, adds indirection when `shItemPrices` already has the authoritative price-per-hole data. Using the flags would require a secondary lookup for prices anyway. (b) use `holes` field only — rejected, field is incorrect for multi-hole courses (always 9 on Francis A Gross).

**Follow-on:** the existing behavior "emit record with price=null when no GreenFee* SKU present" is no longer produced by the new adapter — such slots are skipped entirely. Consistent with D-1 (Teesnap). Three existing tests that asserted the null-price fallback (`returns null price when shItemPrices has no green fee`, `... is absent`, `... is empty`) are updated to assert `toHaveLength(0)` — same intent (malformed price data handled gracefully) with updated semantics.

---

### D-4 — MemberSports: NOT modified (end-of-adapter review)

**Decision:** No changes to MemberSports adapter in this feature. Logged here because the initial Round 1 adapter-batch review flagged `slot.items[0]` as a potential silent-truncation pattern similar to Teewire/TeeItUp.

**Why that first impulse was wrong:**
- `slot.items` in MemberSports represents a list of **courses** available at a given time slot. Each `MemberSportsItem` has its own `golfClubId`, `golfCourseId`, `name`, and `golfCourseNumberOfHoles` (course-level property, not per-variant).
- TeeItUp's `rates` array represents **rate variants** of the same tee time at the same course (different hole counts at different prices). Semantically different.
- The MemberSports API request already targets a specific `golfCourseId`. In practice, items is a 1-element array matching that course. If a facility had multiple courses shared at a slot, items would contain multiple courses — but that's a course-filtering concern, not a multi-hole concern.

**Residual bug (not fixed here):** If MemberSports ever returns multi-course slots in response to a course-specific request, `items[0]` might pick the wrong course. The correct fix would be to filter by `item.golfCourseId === parseInt(golfCourseId)`. This is NOT a multi-hole issue and is out of scope for this feature. Filed mentally as a follow-up if it surfaces.

**Adverse evidence considered:** The fixture shows single-item arrays exclusively. No live probe done (MemberSports MN courses are off-season, unlikely to return data; would be low-value at this point).

---
