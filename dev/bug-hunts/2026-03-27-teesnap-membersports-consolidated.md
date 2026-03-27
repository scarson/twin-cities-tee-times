# Teesnap & MemberSports Bug Hunt — Consolidated Findings

**Date:** 2026-03-27
**Scope:** Teesnap adapter, MemberSports adapter, 5 new catalog entries, adapter registration
**Hunters:** Exploratory, Holistic, Multipass

---

## Confirmed Bugs

### B1. Missing `address` field on all 5 new catalog entries

**Consensus:** Multipass found this; verified by consolidation
**Location:** `src/config/courses.json` — entries at indices 44-48 (daytona, stoneridge, river-oaks, emerald-greens-gold, emerald-greens-silver)
**Evidence:** Every other course in the catalog (44 of 44 existing) has an `address` field. All 5 new entries omit it.
**Impact:** These courses won't have a "View on Maps" link in the UI. The UI handles the missing field gracefully (conditional render), so no crash, but it's a data completeness gap.
**Blast radius:** `courses.json` only, no code changes needed
**Fix approach:** Add address strings to all 5 entries. Addresses are publicly available.

---

## Design Decisions Requiring User Input

### D1. Teesnap `holes` derived from pricing tier presence

**Location:** `src/adapters/teesnap.ts:115`
**The concern:** The adapter sets `holes: eighteenPrice ? 18 : 9` based on whether an `EIGHTEEN_HOLE` price entry exists in the response. If a tee time only has 9-hole pricing, it's reported as 9 holes.
**Flagged by:** Exploratory, Multipass (significant)
**Why this needs a decision:** The Teesnap API doesn't have a separate "this tee time is for X holes" field — round type is only available through the pricing tiers. Our live testing showed all StoneRidge slots return both price types. But if a course only offers 9-hole play for certain time slots, pricing is our only signal.
**Options:**
  - **(A) Keep current behavior** — `holes` reflects the pricing tier selected. If only 9-hole pricing exists, report 9 holes with the 9-hole price. This is the design decision made during brainstorming.
  - **(B) Always report 18** — hardcode `holes: 18` and always use 18-hole price. Simpler but loses 9-hole info.
**Recommendation:** Keep (A). This was a deliberate design choice. The Teesnap `holes` query param has no effect on results (tested live), so pricing tier is the most accurate signal for hole count.

### D2. MemberSports only examines `items[0]` per slot

**Location:** `src/adapters/membersports.ts:77`
**The concern:** Each API slot can have multiple `items`. The adapter only looks at `items[0]`. If `items[0]` is `bookingNotAllowed: true` but a later item is bookable, the slot is incorrectly filtered out.
**Flagged by:** All three hunters
**Why this needs a decision:** We've only observed single-item slots in River Oaks data. Multiple items might represent different rate tiers (member vs public) or course configurations.
**Options:**
  - **(A) Keep current behavior** — only look at `items[0]`. Simple, matches observed data.
  - **(B) Check all items** — find the first bookable item instead of just `items[0]`. More defensive.
**Recommendation:** Keep (A) for now. River Oaks is the only MemberSports course. If we discover multi-item slots in practice, we can revisit. Over-engineering for an unobserved case.

### D3. Teesnap hardcoded foursome maximum (4 slots)

**Location:** `src/adapters/teesnap.ts:99`
**The concern:** `openSlots = 4 - totalBooked`. If a course allows fivesomes or sixsomes, availability would be undercounted.
**Flagged by:** Exploratory, Holistic
**Why this needs a decision:** Standard golf tee times are foursomes. The Teesnap API's `window.property` config has a `max_players` field, but it's on the page HTML, not the tee times API response. We'd need to either hardcode per-course or make an extra page fetch.
**Options:**
  - **(A) Keep 4** — industry standard, simple
  - **(B) Add `maxPlayers` to platformConfig** — per-course override, more accurate
**Recommendation:** Keep (A). Both MN courses are standard foursomes. Add a comment if not already present.

---

## False Positives

### FP1. Teesnap potential double-counting in multi-section tee times

**Flagged by:** Holistic
**Why invalid:** The concern was that the same booking ID could appear in multiple tee-off sections, causing double-counting. In practice, a booking is assigned to exactly one section (FRONT_NINE or BACK_NINE). Even if double-counting occurred, the failure mode is overcounting booked golfers = showing less availability, which is the safer direction (conservative).

### FP2. MemberSports hardcoded API key should use env secrets

**Flagged by:** Multipass (design concern)
**Why invalid:** Other adapters in this codebase also hardcode static API keys (CPS Golf, Eagle Club). This is a public key embedded in the frontend Angular bundle — it's not a secret. Consistent with established project pattern.

### FP3. MemberSports parseInt pattern is a deviation from sibling patterns

**Flagged by:** Multipass (design concern)
**Why invalid:** MemberSports is the only adapter where platformConfig values must be converted to integers for the API request body. Other adapters pass strings directly to URL params. The parseInt + NaN validation is the correct pattern for this case.

---

## Bugs Outside Primary Scope

None identified.

---

## Test Gap Analysis

### B1. Missing `address` field on new catalog entries

**Why missed:** This is a data completeness issue, not a code bug. No test validates that course entries have addresses — it's a catalog convention, not a type requirement.
**Pitfall coverage:** Not covered by existing pitfalls (this is configuration data quality, not code behavior)
**Catch test:** A catalog validation test that checks all courses have required fields (id, name, city, platform, platformConfig, bookingUrl, address) would catch this. But this is probably better fixed by just adding the addresses than adding a test.

### Testing Pitfalls Updates
- None warranted. All design concerns are already covered by existing pitfall patterns.
