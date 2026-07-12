# Dark-Courses Catalog Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Make every "dark" course (zero `success` rows ever) either return real tee times or stop polling — by pointing the migrated courses at their *current* booking platform, disabling the ones we can't poll yet, and retiring two orphan D1 rows.

**Architecture:** Almost entirely a catalog + data change (the same bug class as COURSE-3: a course migrated booking providers, the old platform keeps answering `200` with an empty teesheet, so polls log silent `no_data` forever). The only production-code change is one TeeWire adapter fix (Phase 1). Everything else is `src/config/courses.json` edits + one SQL migration, propagated to prod by the seed UPSERT on deploy (DB-3). All targets were live-verified on 2026-06-09 — see `docs/research/2026-06-09-dark-courses-findings.md`.

**Tech Stack:** `src/config/courses.json` catalog, `scripts/seed.ts` generator (emits `scripts/seed.sql`), Cloudflare D1 (SQLite migrations under `migrations/`), existing adapters (`foreup`, `teeitup`, `membersports`, `teewire`, `cps_golf`) — all unchanged except `src/adapters/teewire.ts`.

---

## Living Document Contract

This plan is a living document. Every executing agent MUST update it as
execution progresses, not only at completion.

- **On phase claim:** the executor MUST flip the banner to 🚧 IN PROGRESS
  with a claim timestamp (ISO 8601 UTC) and the active branch name. The
  banner MUST NOT include an expected-completion estimate — agents cannot
  reliably estimate their own wall-clock, and a fabricated duration
  becomes a stale anchor that misleads future readers. Followers
  encountering a 🚧 banner determine liveness by observable signals (PR
  existence, recent branch commits), not by arithmetic on expected times.
  See Step 5's stale-claim reclaim protocol.
- **On phase ship:** the executor MUST update that phase's **Execution
  Status** banner with the shipped commit SHA(s) and date. If a PR is
  open, the PR number and URL MUST appear in the top-of-plan Execution
  Status table.
- **On phase defer:** the executor MUST update the banner with ⏸ status
  AND a prose description of the unblock condition + a link to the
  likely-unblocker artifact (plan page, task, or PR whose own Execution
  Status banner will signal completion). Prose + link is durable across
  paraphrases and scope edits; exact-string coordination between agents
  is not.
- **On PR merge:** the executor MUST record the merge SHA in the banner
  + the top-of-plan Execution Status table.
- **On deviation from the written plan** (scope edits, structural
  refactors, dropped tasks, reordered phases): the executor MUST
  inline-document the deviation in the affected task AND summarize it
  in the top-of-plan Execution Status as a "Deviations" subsection.
  Deviation state MUST NOT live only in PR notes or status reports.
- **On discovery** (pre-existing drift surfaced during execution, new
  bugs found, architectural issues noted): the executor MUST add a
  "Discoveries" subsection at the top of the plan with pointers to the
  files/lines affected. Follow-up dispatches read this subsection to
  avoid duplicate discovery work.

The plan SHOULD reflect reality at the end of every session that touches
it. Anything worth putting in a status report to the user is worth
putting in the plan.

Rationale: `/writing-plans-enhanced` Step 5. Writing at ship time is
cheap; reconstruction by downstream readers is expensive, compounds
across dispatches, and fails silently when state is split across PR
notes and commit messages.

---

## Execution Status

**Overall:** 🚧 IN PROGRESS — claimed 2026-07-12T05:25:44Z on branch `fix/dark-courses-catalog`.

| Phase | Status | Ship SHA(s) | Notes |
|---|---|---|---|
| 1 — TeeWire walking-rate matcher fix (TDD) | ✅ Shipped | `c8d4f1b` | production code; le-sueur pricing depends on it |
| 2 — legends-club CPS ids | ✅ Done | — | discovered + live-verified 2026-06-09 (courseIds `1`, websiteId `30bb60d4…`) |
| 3 — Catalog edits (all flips + disables) + seed regen | ✅ Shipped | `a195b3d` | 14 flips + 6 disables (the-wilds already disabled on origin/dev); seed resynced (was stale) |
| 4 — Retire 2 orphan rows (migration `0011`) | ✅ Shipped | `296cc6e` | Oak Glen / Gem Lake orphans |
| 5 — PR + post-deploy verification | ⬜ Not started | — | `/check-logs`; depends on merge→deploy |

### Deviations
- **Task 3.3 seed diff is larger than "only touched rows".** `scripts/seed.sql` was pre-existingly stale (49 rows vs 93 courses — see Discoveries), so its regeneration also adds the 44 previously-unseeded courses alongside the intended flips/disables. Accepted as-is: the deploy regenerates `seed.sql` from `courses.json` anyway, and committing the resynced artifact is more correct than committing a knowingly-stale one. All my catalog edits were verified field-by-field against the target table before regenerating.

### Discoveries
- **`scripts/seed.sql` was stale (pre-existing drift).** The committed `scripts/seed.sql` carried only **49** `INSERT` rows while `src/config/courses.json` has **93** courses — ~44 courses were added to the catalog since the last commit that touched `seed.sql` (`e434043`) without regenerating it. This is harmless in prod because `deploy.yml:55` runs `npx tsx scripts/seed.ts` to regenerate `seed.sql` *before* applying it, so the committed file is only an informational artifact. Regenerating it here (Task 3.3) resyncs it to all 93 courses, so the `seed.sql` diff in this PR shows the 14 flips + 6 disables **plus** the 44 previously-unseeded courses being added — not the "only touched rows" the plan anticipated. The extra rows are a correctness improvement (the committed artifact now matches reality), not scope creep.

---

## Context the executor needs (read first)

- **Full investigation + evidence:** `docs/research/2026-06-09-dark-courses-findings.md` (per-course verdicts, live tee-time counts, exact configs, gotchas). This plan carries the load-bearing values inline; the research note is the provenance.
- **Pitfalls (REQUIRED):** `docs/pitfalls/implementation-pitfalls.md` — **COURSE-1** (never set `is_active` by hand — cron owns it), **COURSE-3** (silent `no_data` = wrong platform; verify live), **COURSE-4** (orphan rows need a retire migration), **DB-2** (never hard-delete — CASCADE destroys `user_favorites`/`booking_clicks`), **DB-3** (seed UPSERT propagates `platform`/`platform_config`/`booking_url`/`disabled`). Also the 2026-06-09 changelog entry "COURSE-3 validated at scale" (Chronogolf `active:false` diagnostic; coverage-gap disposition; the curl/Node-fetch tooling trap).
- **This plan SUPERSEDES** `docs/plans/2026-06-09-oak-glen-gem-lake-foreup-fix-plan.md` (its 4 ForeUp flips + orphan migration are folded into Phases 3–4 here). Mark that plan superseded when this one is claimed.
- **Seed mechanics (DB-3):** `scripts/seed.ts` emits `INSERT … ON CONFLICT(id) DO UPDATE SET name=…, disabled=excluded.disabled, platform=excluded.platform, platform_config=excluded.platform_config, booking_url=excluded.booking_url, …`. So a catalog flip (incl. `disabled`) reaches prod automatically on the next deploy seed. It does NOT touch `is_active`/`last_had_tee_times`, and never deactivates ids **absent** from the JSON (hence the Phase 4 migration for the orphans).
- **Reference config shapes (existing entries):** ForeUp = `braemar` (`{facilityId, scheduleId}`); TeeItUp = `keller` (`{alias, apiBase, facilityId}`); MemberSports = `river-oaks` (`{golfClubId, golfCourseId}`); TeeWire = `inver-wood-18` (`{tenant, calendarId}`); CPS = `theodore-wirth-18` (`{subdomain, courseIds, websiteId}`).
- **Course schema keys:** `index, id, name, city, state, address, latitude, longitude, platform, platformConfig, bookingUrl, googlePlaceId` (+ optional `disabled`, `displayNotes`). Only ever change `platform`/`platformConfig`/`bookingUrl`/`disabled` — leave identity/geo fields untouched.
- **TDD scope (CLAUDE.md §TDD → Scope):** `courses.json` and SQL migrations are **TDD-exempt**. Phase 1 (the TeeWire adapter change) is production code → **TDD REQUIRED**.
- **Merge class:** **Review** (catalog correctness + a migration touching the prod `courses` table = data-integrity). Per `docs/git-strategy.md`, Sam merges Review-class PRs — do NOT auto-merge.
- **Branch/worktree:** create `fix/dark-courses-catalog` in a worktree at `.claude/worktrees/dark-courses-catalog` (`git worktree add .claude/worktrees/dark-courses-catalog -b fix/dark-courses-catalog`). PR targets `dev`.
- **Live-verification tooling trap:** booking-data hosts fingerprint-block Node's `fetch` (HTTP 403) — use `curl` with a browser `User-Agent`. On Windows, pipe `curl → node` via stdin; do NOT `curl -o /tmp/x` then have `node` read it (MSYS `/tmp` ≠ Windows `/tmp` → ENOENT).

### The verified target table (load-bearing — copy these exactly)

**Flips to a supported platform (Phase 3):**

| id | new `platform` | new `platformConfig` | new `bookingUrl` | live count (06-13) |
|---|---|---|---|---|
| `crystal-lake` | `foreup` | `{ "facilityId": "22877", "scheduleId": "12220" }` | `https://foreupsoftware.com/index.php/booking/22877/12220` | 51 |
| `deer-run` | `foreup` | `{ "facilityId": "21800", "scheduleId": "8918" }` | `https://foreupsoftware.com/index.php/booking/21800/8918` | 16 |
| `the-meadows-at-mystic-lake` | `foreup` | `{ "facilityId": "22252", "scheduleId": "10233" }` | `https://foreupsoftware.com/index.php/booking/22252/10233` | 4 (18h only) |
| `eagle-valley` | `membersports` | `{ "golfClubId": "9133", "golfCourseId": "11343" }` | `https://app.membersports.com/tee-times/9133/11343/0` | 85 |
| `elk-river` | `teeitup` | `{ "alias": "elk-river-golf-club", "apiBase": "https://phx-api-be-east-1b.kenna.io", "facilityId": "3885" }` | `https://elk-river-golf-club.book.teeitup.golf/` | 46 |
| `oak-marsh` | `teeitup` | `{ "alias": "oak-marsh-golf-course", "apiBase": "https://phx-api-be-east-1b.kenna.io", "facilityId": "4585" }` | `https://oak-marsh-golf-course.book.teeitup.golf/` | 32 |
| `rum-river-hills` | `teeitup` | `{ "alias": "rum-river-hills-golf-club", "apiBase": "https://phx-api-be-east-1b.kenna.io", "facilityId": "8793" }` | `https://rum-river-hills-golf-club.book.teeitup.golf/` | 35 |
| `the-refuge` | `teeitup` | `{ "alias": "the-refuge-golf-club", "apiBase": "https://phx-api-be-east-1b.kenna.io", "facilityId": "3921" }` | `https://refuge-golf-club.book.teeitup.com/` | 71 |
| `le-sueur` | `teewire` | `{ "tenant": "le-sueur", "calendarId": "1" }` | `https://teewire.app/le-sueur/` | 50 (needs Phase 1) |
| `oak-glen-championship` | `foreup` | `{ "facilityId": "22986", "scheduleId": "12514" }` | `https://foreupsoftware.com/index.php/booking/22986/12514` | 16 (prior verify) |
| `oak-glen-executive` | `foreup` | `{ "facilityId": "22986", "scheduleId": "12527" }` | `https://foreupsoftware.com/index.php/booking/22986/12527` | 34 (prior verify) |
| `gem-lake-executive` | `foreup` | `{ "facilityId": "22985", "scheduleId": "12529" }` | `https://foreupsoftware.com/index.php/booking/22985/12529` | 41 (prior verify) |
| `gem-lake-par3` | `foreup` | `{ "facilityId": "22985", "scheduleId": "12528" }` | `https://foreupsoftware.com/index.php/booking/22985/12528` | 17 (prior verify) |
| `legends-club` | `cps_golf` | `{ "subdomain": "legendsmn", "courseIds": "1", "websiteId": "30bb60d4-447d-4f71-6792-08db3854da2c" }` | `https://legendsmn.cps.golf/onlineresweb` | 27 (discovered + verified 06-09) |

**Gotchas baked into the table above (do not "fix" them):**
- `the-refuge` alias `the-refuge-golf-club` ≠ its URL subdomain `refuge-golf-club`. The `.golf` sibling tenant is dead (HTTP 500) — bookingUrl uses `.com`.
- `elk-river`/`oak-marsh`/`rum-river-hills` use the `.book.teeitup.golf` TLD in `bookingUrl`. That's correct; the adapter only talks to the `kenna.io` `apiBase`, so the TLD is cosmetic.
- `the-meadows-at-mystic-lake` is **18-hole only** (the site states no 9-hole rate) — a low live count is expected, not a bug.

**Disable-only (Phase 3), set `"disabled": 1`, leave platform/config as-is:**

| id | why | real platform (for the future adapter, recorded in research note) |
|---|---|---|
| `fox-hollow` | unpollable (no adapter) | Club Caddie 103436 |
| `riverwood-national` | unpollable (no adapter) | Club Caddie `ehfdabab` (+ Vintage `fhfdabab`) |
| `stonebrooke` | unpollable (no adapter) | Club Caddie `cifdabab` |
| `hastings-golf-club` | unpollable (no adapter) | EZLinks `hastings.ezlinksgolf.com` |
| `the-wilds` | unpollable (no adapter) | EZLinks `wildsgolfclubpub` |
| `links-at-northfork` | unpollable (no adapter; reCAPTCHA-gated) | TenFore `16553` |
| `royal-golf-club` | went public→private; no public online tee times | none |

> We deliberately leave `platform`/`platformConfig` unchanged on the disabled rows (smallest change; CLAUDE.md). The real platform/ids live in the research note for the future adapter work. Disabled rows are filtered out before any adapter lookup (the cron handler does `SELECT … WHERE disabled = 0`), so leaving `platform=chronogolf` is safe — nothing polls them. Do NOT set `platform` to `clubcaddie`/`ezlinks`/`tenfore`: those have no adapter, so a future `disabled=0` flip would make every poll fail (`getAdapter()` returns undefined → `pollCourse` logs an error and skips) until the adapter is built.

---

## Phase 1 — TeeWire walking-rate matcher fix (production code, TDD)

**Execution Status:** ✅ SHIPPED 2026-07-12 — commit `c8d4f1b`. TDD: new failing test → matcher fix → all 769 tests green, tsc clean. Existing Walking-fixture prices unchanged (51/28); Riding-only null case preserved.

**Why:** `le-sueur` books on TeeWire with rate titles `"9 Holes"` / `"18 Holes"` (walking) and `"9 Holes w/ Cart"` / `"18 Holes w/ Cart"` (riding). The current matcher at `src/adapters/teewire.ts:95` selects the walking rate via `rate_title.includes("Walking")` — none of Le Sueur's titles contain "Walking", so price resolves to `null` for every slot. Generalize the matcher so a non-cart title counts as the walking rate, **without breaking the existing TeeWire fixtures**.

### Task 1.1: Set up the branch + read context

```
BEFORE starting work:
1. Invoke superpowers:test-driven-development
2. Read docs/pitfalls/testing-pitfalls.md
```

**Steps:**
1. `git worktree add .claude/worktrees/dark-courses-catalog -b fix/dark-courses-catalog` and work there.
2. Read `src/adapters/teewire.ts` in full and `src/adapters/teewire.test.ts` (+ any fixture under `src/test/fixtures/` it loads). Note the **existing** rate-title shapes the current `"Walking"` matcher relies on — your change MUST keep those tests green.

### Task 1.2: Write the failing test

**Files:**
- Test: `src/adapters/teewire.test.ts` (add a case)

**Step — add a test** that feeds a TeeWire response whose slot has Le-Sueur-shaped titles and asserts the walking price is parsed (NOT null). This MUST match the existing file's pattern exactly — `vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))`, the `adapter` already declared in the `describe` block, and the existing `mockConfig` (the config does not affect rate parsing — only the URL — so reuse it rather than inventing a new one):

```ts
it("parses the plain (non-cart) title as the walking rate when no title says 'Walking'", async () => {
  // Le Sueur's TeeWire titles are plain "9 Holes" / "18 Holes" (walking) and
  // "… w/ Cart" (riding); none contain the word "Walking".
  const payload = {
    success: true,
    data: { tee_times: [{
      slot_id: 1,
      time: "07:00:00",
      date: "2026-06-13",
      availability: { available_spots: 4, max_spots: 4 },
      pricing: { rates: [
        { rate_id: 1, rate_title: "18 Holes",         holes: 18, price: "$54.00", description: "" },
        { rate_id: 2, rate_title: "18 Holes w/ Cart", holes: 18, price: "$79.00", description: "" },
        { rate_id: 3, rate_title: "9 Holes",          holes: 9,  price: "$33.00", description: "" },
        { rate_id: 4, rate_title: "9 Holes w/ Cart",  holes: 9,  price: "$46.00", description: "" },
      ] },
    }] },
  };
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(payload), { status: 200 })
  );

  const results = await adapter.fetchTeeTimes(mockConfig, "2026-06-13");

  const h18 = results.find((r) => r.holes === 18)!;
  const h9 = results.find((r) => r.holes === 9)!;
  expect(h18.price).toBe(54); // walking 18, NOT 79 (cart)
  expect(h9.price).toBe(33);  // walking 9,  NOT 46 (cart)
});
```

**Step — run it, expect FAIL:** `npm test -- teewire` → the new case fails (`price` is `null`).

### Task 1.3: Generalize the matcher

**Files:**
- Modify: `src/adapters/teewire.ts:95`

**Change (current → desired).** Replace the single `.includes("Walking")` lookup with a two-tier preference: an explicit "Walking" title first (preserves existing behavior), then fall back to the rate whose title does **not** indicate a cart:

```ts
// Prefer an explicit "Walking" rate; otherwise the non-cart title is the walking
// (green-fee) rate. Cart/riding titles bundle cart cost and aren't comparable.
const walkingRate =
  rates.find((r) => /walking/i.test(r.rate_title)) ??
  rates.find((r) => !/cart|riding/i.test(r.rate_title));
const price = walkingRate
  ? parseFloat(walkingRate.price.replace(/[^0-9.]/g, ""))
  : null;
```

Update the adjacent comment to describe the two-tier rule (do not leave a comment describing only the old "Walking-only" behavior).

**The `riding` term in the fallback regex is load-bearing — do NOT drop it.** The existing fixture uses titles `"18 Holes Riding"` / `"9 Holes Riding"`, and the test `"uses null price for each variant when no walking rate exists (Riding-only)"` (`src/adapters/teewire.test.ts:238`) asserts `price === null` for a Riding-only slot. If the fallback were just `!/cart/i`, `"18 Holes Riding"` (no "cart") would be picked as the walking rate → that test breaks. Matching `/cart|riding/i` keeps it green.

**Do NOT:** change the hole-grouping logic, the `available_spots > 0` filter, the `classifyHoles` skip of unknown hole counts, or the proxy path. Keep `price = null` as the final fallback when a group has no walking-eligible rate (preserves the Riding-only behavior above).

### Task 1.4: Verify green + commit

**Step — run the full TeeWire suite:** `npm test -- teewire` → new case PASSES and **all pre-existing TeeWire tests still pass** (the explicit-"Walking" path is unchanged). Then `npx tsc --noEmit` → clean.

```
BEFORE marking this task complete:
1. Review the test against docs/pitfalls/testing-pitfalls.md.
2. Confirm the existing TeeWire fixtures still parse the SAME prices as before
   (the `/walking/i` first-tier preserves them). If any pre-existing test now
   resolves a different price, STOP — the fallback is too greedy; tighten the
   cart regex rather than weakening the test.
3. Run tests, confirm green.
```

> The regression guard here is the **unit** suite (`src/adapters/teewire.test.ts` + its JSON fixture `src/test/fixtures/teewire-tee-times.json`) — that's what proves the matcher change is price-preserving. The separate `teewire.smoke.test.ts` polls the live `inverwood` tenant and `ctx.skip()`s when the live API returns no times, so it CANNOT be relied on to catch a matcher regression. Do not treat a green smoke run as the safety net.

**Commit:**
```bash
git add src/adapters/teewire.ts src/adapters/teewire.test.ts
git commit -m "fix(teewire): treat the non-cart rate title as the walking green fee"
```
Body: note Le Sueur's titles are `"9 Holes"`/`"18 Holes"` (no "Walking"); the explicit-Walking path is preserved for existing tenants.

---

## Phase 2 — legends-club CPS ids (DISCOVERED — no work needed)

**Execution Status:** ✅ DONE (discovered + live-verified 2026-06-09, pre-execution)

**Result:** `legends-club` migrated off Chronogolf to **CPS Golf** (`legendsmn.cps.golf`). The two ids the adapter needs were discovered via `GetAllOptions` (curl_cffi `impersonate="chrome"`, after the short-lived token) and the full adapter flow (token → `RegisterTransactionId` → `TeeTimes`) was reproduced live: **27 tee times for 2026-06-13, $107.96/18h**.

- `courseIds = "1"` (the only entry in `courseOptions`; `courseName: "Legends Club"`)
- `webSiteId = "30bb60d4-447d-4f71-6792-08db3854da2c"` (top-level field, also on `courseOptions[0]`)
- v5 flow (no `authType` — matches `theodore-wirth-18`).

These values are already in the Phase 3 verified-target table. No discovery work remains; `legends-club` is a ready flip in Phase 3 (Task 3.1). If you want to re-verify before flipping, re-run the token → GetAllOptions → TeeTimes sequence (COURSE-3 discipline) — but it is not required.

---

## Phase 3 — Catalog edits: all flips + disables + seed regen

**Execution Status:** ✅ SHIPPED 2026-07-12. 14 flips + 6 disables applied to `courses.json`; `seed.sql` regenerated. `the-wilds` was already `disabled=1` on origin/dev (PR #155) — verified, not duplicated. All 9 non-verified public flip targets (foreup ×6, teeitup ×3) live-spot-checked 2026-07-12 with curl and returned real times; crystal-lake/elk-river/eagle-valley re-verified same day; le-sueur (teewire) + legends-club (cps_golf) are Cloudflare-gated locally so trusted per the 06-09/06-13 verification. tsc clean, 769 tests green.

**Ordering note:** the `le-sueur` catalog edit is itself independent of Phase 1 — the flip to `teewire` works on its own; it just returns **null prices** until Phase 1's matcher fix is also in the branch. Since both ship in the **same PR** (single branch `fix/dark-courses-catalog`), order within the branch doesn't matter — just ensure Phase 1 is committed before the PR opens (Phase 5) so le-sueur ships with correct prices.

**Why one phase:** every edit below is in the single file `src/config/courses.json`. Doing them as one sequential pass (not parallel agents) avoids same-file conflicts.

### Task 3.1: Apply the flips

**Files:**
- Modify: `src/config/courses.json`

**Step.** For each row in the **"Flips to a supported platform"** table under *Context*, set its `platform`, replace `platformConfig` wholesale, and set `bookingUrl` to the exact values listed. Leave `id`/`name`/`city`/`state`/`address`/`latitude`/`longitude`/`googlePlaceId`/`index` untouched. This covers all 14 rows in the flip table: `crystal-lake`, `deer-run`, `the-meadows-at-mystic-lake`, `eagle-valley`, `elk-river`, `oak-marsh`, `rum-river-hills`, `the-refuge`, `le-sueur`, `legends-club`, and the four Oak Glen/Gem Lake rows.

**Do NOT:** leave any stale keys on a flipped row — **replace the entire `platformConfig` object**, leaving none of the old keys. The current shapes (all must be fully replaced, not field-merged):
- The **9 Chronogolf rows** (`crystal-lake`, `the-meadows-at-mystic-lake`, `eagle-valley`, `elk-river`, `oak-marsh`, `rum-river-hills`, `the-refuge`, `le-sueur`, `legends-club`) carry `clubSlug` + `courseId`.
- The **four Oak Glen/Gem Lake rows** are currently `cps_golf` carrying **`subdomain` + `websiteId` + `courseIds` + `authType` ("v4")** — drop all **four** (ForeUp ignores `authType`, but a leftover key violates "no stale keys" and is a COURSE-3 smell).
- `deer-run` is the lone exception — currently `teeitup` with `alias` + `apiBase` + `facilityId`; replace wholesale with the foreup `{facilityId, scheduleId}` shape.

Do NOT add a `disabled` field to a flipped row. Do NOT touch `is_active` (cron owns it — COURSE-1).

### Task 3.2: Apply the disables

**Step.** For each row in the **"Disable-only"** table, add `"disabled": 1` (match the key style of an existing disabled entry like `inver-wood-18`). Leave `platform`/`platformConfig`/`bookingUrl` unchanged on these rows. Rows: `fox-hollow`, `riverwood-national`, `stonebrooke`, `hastings-golf-club`, `the-wilds`, `links-at-northfork`, `royal-golf-club`.

### Task 3.3: Regenerate the seed + verify

**Files:**
- Modify: `scripts/seed.sql` (generated)

**Steps:**
1. `npx tsx scripts/seed.ts` (regenerates `scripts/seed.sql` from `courses.json`).
2. Confirm the `scripts/seed.sql` diff shows ONLY the touched courses' `platform`/`platform_config`/`booking_url`/`disabled` changing — no unrelated churn.
3. `npx tsc --noEmit` → clean.
4. `npm test` → green. **Be aware of the coverage gap:** the only test that reads `courses.json` is `src/config/areas.test.ts` (it checks `city` coverage + the `sd-` id prefix — neither of which any flip touches, so it stays green). **There is NO test that validates `platformConfig` shape against `courses.json`** — a transposed or wrong id will pass `npm test` and only surface post-deploy as `no_data`. So `npm test` green here proves nothing about id correctness; the field-by-field re-check below and the Phase 5 `/check-logs` verification are the real safety nets (treat Phase 5 as mandatory, not optional).
5. JSON sanity: every flipped row has exactly the right `platformConfig` keys for its platform and no leftover keys; every disabled row has `disabled: 1`.

```
BEFORE marking this task complete:
- Re-read the verified-target table and diff it against your edits field-by-field
  (a transposed facility/schedule id silently returns the wrong course's sheet —
  COURSE-3). The Refuge alias (`the-refuge-golf-club`) and the `.golf` bookingUrl
  TLDs are intentional — confirm you did not "correct" them.
```

**Commit:**
```bash
git add src/config/courses.json scripts/seed.sql
git commit -m "fix(catalog): repoint migrated dark courses, disable unpollable ones"
```
Body: list the platform flips (foreup/teeitup/membersports/teewire/cps) and the disables (Club Caddie ×3 / EZLinks ×2 / TenFore ×1 / royal private); note all targets live-verified 2026-06-09; reference COURSE-3 and `docs/research/2026-06-09-dark-courses-findings.md`.

---

## Phase 4 — Retire the two orphan rows (migration)

**Execution Status:** ✅ SHIPPED 2026-07-12 — commit `296cc6e`, `migrations/0011_retire_oak_glen_gem_lake_orphans.sql`. `0011` confirmed next free (highest existing `0010`). ids verified against COURSE-4 (`oak-glen` "6,7", `gem-lake-hills` "8,9"). Local dry-run confirmed SQL parses (0 rows locally — orphans absent from local DB, as the plan predicted); takes effect against prod on deploy.

**Why:** prod D1 has stale combined rows `oak-glen` (`courseIds "6,7"`) and `gem-lake-hills` (`"8,9"`) left by the facility split (commit `6ae31fe`). They are NOT in `courses.json`, so the seed UPSERT never deactivates them (COURSE-4) — they poll dead CPS endpoints as silent `no_data` forever.

### Task 4.1: Add the retire migration

**Files:**
- Create: `migrations/0011_retire_oak_glen_gem_lake_orphans.sql` (confirm `0011` is still the next free number — highest existing is `0010_add_poll_content_changed.sql`; bump if another migration landed).

**Content:**
```sql
-- Retire pre-split combined rows orphaned by the Oak Glen / Gem Lake facility
-- split (commit 6ae31fe). They are absent from courses.json so the seed UPSERT
-- never deactivates them; without this they keep polling dead CPS endpoints as
-- silent no_data. disabled=1 (not DELETE) preserves any user_favorites /
-- booking_clicks FKs — see implementation-pitfalls DB-2 and COURSE-4.
UPDATE courses SET disabled = 1 WHERE id IN ('oak-glen', 'gem-lake-hills');
```

**Do NOT:** `DELETE` these rows (CASCADE destroys user data — DB-2). Do NOT migrate `user_favorites` from the orphan ids to the split ids (out of scope — YAGNI). Do NOT set `is_active` (cron owns it — COURSE-1).

**Verify (optional local dry-run):** `npx wrangler d1 execute tee-times-db --local --file=migrations/0011_retire_oak_glen_gem_lake_orphans.sql` then `--local --command="SELECT id, disabled FROM courses WHERE id IN ('oak-glen','gem-lake-hills')"`. **These ids are NOT in `courses.json` (they're orphans), so the local DB won't have them** — the dry-run will update 0 rows and the SELECT returns nothing. That only confirms the SQL *parses*; it cannot confirm the ids are right. Since a typo'd id silently no-ops in prod too, manually confirm the two ids exactly match the orphans in the research note / memory (`oak-glen`, `gem-lake-hills`) before committing. The migration takes effect against prod on deploy.

**Commit:**
```bash
git add migrations/0011_retire_oak_glen_gem_lake_orphans.sql
git commit -m "fix(catalog): retire orphan oak-glen + gem-lake-hills rows (disabled=1)"
```
Body: reference COURSE-4 + DB-2 (why disable, not delete).

---

## Phase 5 — PR + post-deploy verification

**Execution Status:** ⬜ NOT STARTED — depends on Phases 1–4 committed; verification depends on merge→`main`→deploy (deploy runs migrations + seed).

### Task 5.1: Open the PR (Review-class)

```bash
git push -u origin fix/dark-courses-catalog
gh pr create --base dev \
  --title "fix(catalog): repoint migrated dark courses + retire orphans" \
  --body "<summary: 14 platform flips (live-verified facility/schedule/alias ids), 7 disables (unpollable/private), TeeWire walking-rate fix, migration 0011 retires 2 orphan rows; supersedes the Oak Glen/Gem Lake plan; COURSE-3/4; full report docs/research/2026-06-09-dark-courses-findings.md; verification plan below>"
```
**This is Review-class — do NOT auto-merge.** After CI is green, ping Sam that it's ready. Update the top-of-plan Execution Status table with the PR number/URL.

### Task 5.2: After merge + deploy, confirm flips now succeed

Wait for at least one cron cycle after deploy, then (read-only, `--remote`):
```bash
npx wrangler d1 execute tee-times-db --remote --command="SELECT id, platform, last_had_tee_times FROM courses WHERE id IN ('crystal-lake','deer-run','the-meadows-at-mystic-lake','eagle-valley','elk-river','oak-marsh','rum-river-hills','the-refuge','le-sueur','legends-club','oak-glen-championship','oak-glen-executive','gem-lake-executive','gem-lake-par3')"
```
Expected: each shows its new `platform` and a non-null `last_had_tee_times`.

```bash
npx wrangler d1 execute tee-times-db --remote --command="SELECT course_id, status, tee_time_count, MAX(polled_at) last FROM poll_log WHERE course_id IN ('crystal-lake','deer-run','eagle-valley','elk-river','oak-marsh','rum-river-hills','the-refuge','the-meadows-at-mystic-lake','le-sueur','legends-club','oak-glen-championship','oak-glen-executive','gem-lake-executive','gem-lake-par3') AND polled_at > '<deploy-time>' GROUP BY course_id, status ORDER BY course_id, status"
```
Expected: `status=success` with non-zero `tee_time_count` for each. **Special-cases:** `the-meadows-at-mystic-lake` is 18-hole-only (low count OK); `le-sueur` should now carry non-null prices (Phase 1) — if prices are null, the matcher fix regressed.

### Task 5.3: Confirm disables + orphans stopped polling

```bash
npx wrangler d1 execute tee-times-db --remote --command="SELECT id, disabled FROM courses WHERE id IN ('fox-hollow','riverwood-national','stonebrooke','hastings-golf-club','the-wilds','links-at-northfork','royal-golf-club','oak-glen','gem-lake-hills')"
```
Expected: `disabled=1` for all. Confirm no new `poll_log` rows appear for these ids after the deploy.

### Task 5.4: Close out

Update this plan's Execution Status to ✅ SHIPPED with the merge SHA; update the superseded Oak Glen/Gem Lake plan's banner to point here. If any flipped course still shows `no_data`, treat it as a fresh COURSE-3 investigation (re-verify ids against the live site) — do NOT guess. Journal the Club Caddie / EZLinks / TenFore adapter candidates (the disabled 6) as follow-up work.

---

## Review checkpoint

```
After completing Phases 1–4 (before opening the PR):
Review the batch from multiple perspectives — minimum 3 rounds:
1. Correctness: every flipped platformConfig matches the verified-target table
   field-by-field; no transposed/leftover ids; disables have disabled:1.
2. Pitfalls: COURSE-1 (no hand-set is_active), COURSE-3 (live-verified), COURSE-4
   + DB-2 (orphans disabled, not deleted), DB-3 (seed regenerated).
3. Blast radius: `npm test` green — but note NO test validates courses.json
   platform-config shape, so green does NOT prove id correctness; the field-by-field
   re-check (Task 3.3) + Phase 5 /check-logs are the real guards. seed.sql diff
   shows only intended rows; TeeWire existing UNIT fixtures unchanged in price.
If round 3 still finds issues, keep going until clean.
```

## Why this matters (provenance)

Produced via `writing-plans-enhanced` (Living Document Contract + per-phase Execution Status banners). Same bug class as the COURSE-3 Oak Glen/Gem Lake remediation it supersedes; all targets live-verified 2026-06-09 (`docs/research/2026-06-09-dark-courses-findings.md`). Verification is post-deploy `/check-logs`, consistent with how the CPS and Chronogolf fixes were validated on 2026-06-09.
