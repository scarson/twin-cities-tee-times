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

### D-5 — Defensive integration test for large batches (end-of-feature review)

**Decision:** Added a regression test to `src/lib/db.integration.test.ts` asserting `upsertTeeTimes` handles 200-record batches without error.

**Context:** Multi-hole adapter fixes can double the row count per course-date upsert. Francis A Gross post-fix emits ~130 records for a single day (63 slots × 2 variants). Pre-fix Cloudflare D1 documentation suggested a possible 100-statement batch limit, which would have broken this feature in production.

**Investigation (during Round 4 of end-of-feature review):**
- Checked current CF D1 docs via MCP. No explicit statement-count limit in batch calls — only per-statement limits (100 bound parameters, 100 KB SQL length).
- Each INSERT uses 9 bound parameters. Well under the per-statement limit.
- Total batch duration limit: 30 seconds. 200 inserts well within.
- Ran empirical verification with 200 records via a local integration test — succeeded.

**Decision:** Since the empirical test passed AND the docs suggest no count limit, no architectural change needed. BUT the doubling risk is latent and a future refactor could reintroduce concerns. A regression test encoding "200-record batches must work" is cheap insurance.

**3x adversarial review:**
1. **Could the local SQLite test environment differ from production D1 behavior for batches?** Possible, but production D1 exposes the same `batch()` API with documented per-statement limits that match what local SQLite enforces. Batch count limit, if it existed, would be in the API wrapper layer — not reproducible locally, but also not in the docs.
2. **Is 200 the right threshold to test?** 130 is the current realistic max; 200 provides 54% headroom. Higher would slow the test without meaningful added coverage. Lower would miss growth room.
3. **Does this test add maintenance burden?** Minimal — 20 lines, single scenario, deterministic.

---

## End-of-feature summary

**Commits landed on dev (2026-04-20 overnight session):**

- Adapter layer (6 commits): foreup, chronogolf, teesnap, teewire, teeitup, cps-golf — all emit one TeeTime per hole variant instead of silently truncating.
- UI layer (2 commits): `mergeHoleVariants` pure helper + integration into `tee-time-list.tsx` for `"9 / 18 holes"` and `"$30.00 / $55.00"` merged rendering.
- Test coverage (1 commit): large-batch regression guard in db integration tests.
- Docs (this file): decisions D-1..D-5 with 3x+ adversarial review each.

**Test count:** 628 → 664 (+36 tests across 7 suites).

**Live verification:** CPS Golf probe against Francis A Gross confirmed 116 records produced across 63 unique slots, with 53 slots correctly exposing both 9h ($26.04) and 18h ($43.71) variants.

**Review rounds completed:**
- Per-task: 1x TDD red/green cycle
- End-of-adapter-batch: 3 rounds (1 finding surfaced then withdrawn after deeper analysis of MemberSports semantics)
- End-of-feature: 5 rounds (1 finding addressed — large-batch regression test)

**Known limitations / follow-ups:**
- Chronogolf uses Option A (null second price). Accepts imperfect pricing to avoid doubling API load. Revisit as Option B if users notice missing prices.
- MemberSports `items[0]` is a latent course-filtering bug (not multi-hole). Filed mentally; address if it surfaces.
- TeeItUp fix is defensive (no live multi-hole evidence in fixture). Degenerates to current behavior for solo-rate slots; correct for multi-hole if it surfaces.
- CPS Golf 4-decimal prices (e.g., $43.7107649384) stored as-is. Display via `.toFixed(2)` correctly shows `"$43.71"`.

---

### D-6 — 9/18 hole filter design (Task 2 from feedback list)

**Decision:** Add a `HolesFilter` component in the same filter row as `TimeFilter`, with three buttons: Any / 9 holes / 18 holes. State stored in `useState<"" | "9" | "18">`. Query param passed to existing API `holes=` handling. No schema/API changes needed.

**Placement rationale:** Same row as TimeFilter. On mobile (<640px), `flex-wrap` naturally flows overflow buttons to a second line. On desktop, all 8 buttons (5 time + 3 holes) fit on one line.

**Interaction with multi-hole merge:** Verified during multi-hole feature design:
- User selects "9 holes" → `WHERE holes = 9` returns only the 9-hole row of a multi-hole pair → `mergeHoleVariants` sees a solo row → renders `"9 holes · $30"` card. Correct.
- User selects "18 holes" → mirror of above.
- User selects "Any" → both rows returned → helper merges → `"9 / 18 holes · $30 / $55"` card.

**3x adversarial review:**
1. **Could the `holes` URL param collide with anything?** No existing param named `holes`. API route `src/app/api/tee-times/route.ts:25` already reads it. Clean integration.
2. **Could the TypeScript type `"" | "9" | "18"` need to be broader?** API validates param as "9" or "18" exactly. String literal union is correct.
3. **Could mobile UI break with 8 buttons?** `flex-wrap` on the parent div handles overflow. Tested during nav responsive work — mobile layouts accommodate 2-3 rows fine.

**Alternatives considered:** (a) dropdown select for holes — rejected, button group matches the time filter's visual pattern; (b) keep "Any" as implicit default with only "9" / "18" buttons — rejected, explicit "Any" button improves discoverability.

---

### D-7 — Catalog expansion (#4) deferred for morning review (REVERSED by Sam 2026-04-20 ~00:40 CT)

**Update:** Sam reviewed this decision and overrode it. Catalog expansion is back on the overnight queue as the LAST priority item (after deep-link Book buttons). Rationale for override: "it shouldn't wait on me." Claude proceeds autonomously using `dev/research/tc-courses-platforms.md` for the course list, the Google Maps API key in `.dev.vars` for geocoding + Place ID lookup, and `scripts/lookup-place-ids.ts` for Place IDs. See D-9 for the actual expansion decision.

**Original decision (preserved for context):** Skip the "add rest of TC courses (~50 more)" feedback item overnight. Move it to Sam's morning queue.

**Rationale:** Adding ~50 courses to `src/config/courses.json` requires per-course:
- Platform-specific config (subdomain/courseId/scheduleId/tenant/etc.)
- Address + latitude/longitude (geocoding via Google Maps API)
- Google Place ID (via `scripts/lookup-place-ids.ts`)
- Booking URL verification

Each of these is a research step that requires visiting the course's actual booking page. Automating overnight would either (a) require the Google Maps API key that's in `.dev.vars` (not tested autonomously), or (b) risk introducing wrong IDs that silently break polling on the affected course. Silent-fail bugs from bad IDs are hard to detect until real users notice missing tee times.

**3x adversarial review:**
1. **Could I add a small, high-confidence subset autonomously?** Possibly 2-3 courses where the config follows a known pattern (e.g., Chronogolf courses sharing a club UUID). But even that requires visiting the marketplace to confirm UUIDs. Net: low speed, high review-dependency.
2. **Could I generate the list but NOT commit it?** Yes — could produce a `dev/research/catalog-expansion-candidates.md` document for morning review. Deferring to that as a possible follow-up if I run out of other work overnight.
3. **Does deferring this block anything?** No. The existing 49 courses serve users today. Catalog expansion is additive.

**Action:** Skip for now. Priority for morning: Sam decides whether to tackle this personally (highest data quality) or delegate with specific constraints.

---

### D-9 — Deep-link Book buttons: use Playwright MCP for live SPA verification

**Decision:** Use Playwright MCP browser tools to live-test each booking platform's SPA behavior before implementing any deep-link. Document per-platform capability in `dev/research/2026-04-20-deep-link-research.md`. Implement `buildBookingUrl(teeTime)` adapter method for each platform where URL-based deep-linking is verified to work.

**Prior misdirection:** An initial draft of this decision deferred deep-link work entirely based on a fear that Playwright MCP was unreliable. Sam corrected: "Use Playwright for anything where you need live browser testing." That's the authoritative guidance. Pivoting.

**Research so far (pre-Playwright):**
- **ForeUp:** URL `?date=` does NOT deep-link — DEFAULT_FILTER echoes today regardless (curl probe, not live). Needs Playwright confirmation. Maybe hash routes work?
- **CPS Golf:** Angular SPA with `/search-teetime` route. No curl-level evidence of URL→state wiring. Needs Playwright.
- Other 6 platforms: not yet probed.

**Workflow:**

1. For each platform, pick one representative course with known working polling.
2. Via Playwright MCP: navigate to `baseUrl?candidate-param=value`, wait for SPA to settle, inspect what date/time/holes the UI shows.
3. Try: `?date=MM-DD-YYYY`, `?date=YYYY-MM-DD`, `#date=...`, path segments like `/YYYY-MM-DD`, embedded hash routes.
4. Record findings per platform as "verified working" / "verified ignored" / "untested."
5. Implement adapter method only for verified-working platforms. Ship incrementally per-platform commits.

**3x adversarial review:**

1. **Is Playwright MCP robust enough for 8 platforms?** The prior session's browser-lock issues may have been environmental. A fresh session with a fresh browser state is the reset. If it fails again, fall back to writing project-local Playwright specs and running via `npx playwright test`.
2. **Could the hole-count modal add value even without date deep-linking?** No — if the deep-link doesn't change behavior with hole-count, the modal is a pointless extra click. Gate modal implementation behind confirmed per-platform deep-link support.
3. **Should I block on ALL platforms working before shipping any?** No. Ship per-platform incrementally. Each platform is a separate adapter with no cross-dependency.

**Action:** Begin Playwright probing. Commit research updates as each platform is verified.

---

### D-8 — 9/18 filter commit rides along in PR #98

**Decision:** Pushed the 9/18 filter commit (245a584) to the `dev` branch, which is the source branch for PR #98 (multi-hole). PR #98 now includes both features.

**Rationale:** PR #97 set a precedent of bundling multiple feedback items per PR. Splitting into a separate PR would require branch management that risks leaving work unpushed and unverified by CI. The two features are thematically related ("multi-hole display improvements") and share UI surface (the search page filter bar).

**3x adversarial review:**
1. **Does bundling obscure review?** Diff is larger but each commit is scoped. Sam can review commit-by-commit.
2. **CI still validates each push?** Yes — every push to dev triggers the CI jobs.
3. **Are the two features genuinely independent in risk?** Yes — the 9/18 filter doesn't touch adapters, and multi-hole doesn't touch filter state. They can be reverted independently if needed.

**Action:** Update PR #98 body at end of overnight session to reflect the expanded scope.
