# Oak Glen + Gem Lake ForeUp Correction — Implementation Plan

> ⛔ **SUPERSEDED (2026-06-09)** — folded into the consolidated `docs/plans/2026-06-09-dark-courses-catalog-fix-plan.md` (same bug class, 17 more courses). The four ForeUp flips and the orphan-row migration in this plan are now Phase 3 + Phase 4 there. **Do NOT execute this plan standalone** — execute the consolidated plan instead. Retained for provenance.

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Correct four catalog courses that are mis-tagged `cps_golf` but actually book on ForeUp (so they poll silent `no_data` forever), and retire two orphan D1 rows left by an earlier facility split — so all four start returning real tee times and the orphans stop being polled.

**Architecture:** Pure catalog + data change, no application code. Flip `platform`/`platformConfig`/`bookingUrl` for the four courses in `src/config/courses.json` (the seed UPSERT propagates these columns to prod D1 on deploy — DB-3). Add a forward-only migration to set `disabled = 1` on the two orphan rows that are absent from `courses.json` and therefore invisible to the seed (COURSE-4; never `DELETE` — DB-2). Regenerate `scripts/seed.sql`. Verify post-deploy via `/check-logs`.

**Tech Stack:** Cloudflare D1 (SQLite migrations), `src/config/courses.json` catalog, `scripts/seed.ts` generator, existing `ForeUpAdapter` (unchanged — it reads `scheduleId` from `platformConfig`).

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

**Overall:** Not started.

| Phase | Status | Ship SHA(s) | Notes |
|---|---|---|---|
| 1 — Flip 4 courses to ForeUp | ⬜ Not started | — | — |
| 2 — Retire 2 orphan rows (migration) | ⬜ Not started | — | — |
| 3 — Verify post-deploy | ⬜ Not started | — | depends on deploy of Phases 1–2 |

### Deviations
- _(none yet)_

### Discoveries
- _(none yet)_

---

## Context the executor needs (read first)

- **Root cause + verified targets:** memory `project_oak_glen_gem_lake_foreup_misconfig.md`; pitfalls **COURSE-3** (a misconfigured course fails as silent `no_data`, never `error`) and **COURSE-4** (split/removed courses orphan their D1 row) in `docs/pitfalls/implementation-pitfalls.md`.
- **All four ForeUp targets were live-reproduced** on 2026-06-09 against the exact API call the adapter makes (`api/booking/times` with `booking_class=default`):

  | courses.json id | facilityId | scheduleId | live result |
  |---|---|---|---|
  | `oak-glen-championship` | `22986` | `12514` | 16 times, $46, 9/18h |
  | `oak-glen-executive` | `22986` | `12527` | 34 times, $13, 9h |
  | `gem-lake-executive` | `22985` | `12529` | 41 times, $18, 9h |
  | `gem-lake-par3` | `22985` | `12528` | 17 times, $16, 9h |

- **Orphan rows (prod D1 only, NOT in `courses.json`):** `oak-glen` (`courseIds "6,7"`) and `gem-lake-hills` (`courseIds "8,9"`) — pre-split combined rows from commit `6ae31fe`. Both `is_active=1, disabled=0`, polled every cycle as silent `no_data`.
- **Reference config shape:** Braemar (`src/config/courses.json`) is the canonical ForeUp entry — `platform: "foreup"`, `platformConfig: { facilityId, scheduleId }`, `bookingUrl: https://foreupsoftware.com/index.php/booking/<facility>/<schedule>`. The adapter (`src/adapters/foreup.ts:38`) reads only `scheduleId`; `facilityId` is for the bookingUrl/reference.
- **Seed mechanics:** `scripts/seed.ts` emits `INSERT … ON CONFLICT(id) DO UPDATE SET … platform=excluded.platform, platform_config=excluded.platform_config, booking_url=excluded.booking_url` — so the catalog flip reaches prod automatically on the next deploy seed. It does NOT touch `is_active`/`last_had_tee_times`, and never deactivates ids absent from the JSON (hence the migration in Phase 2).
- **TDD scope:** This change is config (`courses.json`) + a SQL migration — both explicitly **exempt** from TDD per `CLAUDE.md` (§Test Driven Development → Scope). There is no production-code change. Verification is type-check + full test suite + post-deploy `/check-logs`, NOT new unit tests.
- **Merge class:** **Review** (catalog correctness + a migration touching the prod `courses` table = data-integrity). Per `docs/git-strategy.md`, Sam merges Review-class PRs; do not auto-merge.
- **Branch/worktree:** create `fix/oak-glen-gem-lake-foreup` in a worktree at `.claude/worktrees/<slug>` (git-strategy). PR targets `dev`.

---

## Phase 1 — Flip the four courses to ForeUp

**Execution Status:** ⬜ NOT STARTED

### Task 1.1: Rewrite the four catalog entries

**Files:**
- Modify: `src/config/courses.json` (entries `oak-glen-championship`, `oak-glen-executive`, `gem-lake-executive`, `gem-lake-par3`)

**Change (current → desired).** For each of the four entries, set `"platform": "foreup"`, replace `platformConfig` with the ForeUp shape, and update `bookingUrl`. Leave every other field (`id`, `name`, `city`, `state`, `latitude`, `longitude`, `googlePlaceId`, `index`) unchanged.

- `oak-glen-championship`:
  - `"platform": "foreup"`
  - `"platformConfig": { "facilityId": "22986", "scheduleId": "12514" }`
  - `"bookingUrl": "https://foreupsoftware.com/index.php/booking/22986/12514"`
- `oak-glen-executive`:
  - `"platform": "foreup"`
  - `"platformConfig": { "facilityId": "22986", "scheduleId": "12527" }`
  - `"bookingUrl": "https://foreupsoftware.com/index.php/booking/22986/12527"`
- `gem-lake-executive`:
  - `"platform": "foreup"`
  - `"platformConfig": { "facilityId": "22985", "scheduleId": "12529" }`
  - `"bookingUrl": "https://foreupsoftware.com/index.php/booking/22985/12529"`
- `gem-lake-par3`:
  - `"platform": "foreup"`
  - `"platformConfig": { "facilityId": "22985", "scheduleId": "12528" }`
  - `"bookingUrl": "https://foreupsoftware.com/index.php/booking/22985/12528"`

**Do NOT:** rename the course `id`s; touch `name`/lat-lng/`googlePlaceId`; add a `disabled` field; modify any CPS course; modify the `ForeUpAdapter`. Match Braemar's `platformConfig` key style exactly (string values, `facilityId` then `scheduleId`).

**Verify:**
- `npx tsc --noEmit` → clean.
- `npm test` → green (watch `src/config/areas.test.ts` and `src/adapters/foreup.test.ts` in particular; if any test enumerates/validates `courses.json` platform shapes, it must still pass).
- Sanity-check the JSON parses: the four entries now have `platform: "foreup"` and a `{facilityId, scheduleId}` config; no leftover `subdomain`/`websiteId`/`courseIds`/`authType` keys on them.

### Task 1.2: Regenerate the seed file

**Files:**
- Modify: `scripts/seed.sql` (generated)

**Steps:**
1. Run `npx tsx scripts/seed.ts` (regenerates `scripts/seed.sql` from `courses.json`).
2. Confirm the diff to `scripts/seed.sql` shows ONLY the four courses' `platform`/`platform_config`/`booking_url` changing to ForeUp values — no unrelated churn.

**Commit (Phase 1):**
```bash
git add src/config/courses.json scripts/seed.sql
git commit -m "fix(catalog): point Oak Glen + Gem Lake at ForeUp, not CPS"
```
Commit body MUST note: the 4 courses book on ForeUp (facility/schedule ids), were silently no_data as cps_golf, targets live-verified; reference COURSE-3.

---

## Phase 2 — Retire the two orphan rows

**Execution Status:** ⬜ NOT STARTED

### Task 2.1: Add the retire migration

**Files:**
- Create: `migrations/0011_retire_oak_glen_gem_lake_orphans.sql`

**Content:**
```sql
-- Retire pre-split combined rows orphaned by the Oak Glen / Gem Lake facility
-- split (commit 6ae31fe). They are absent from courses.json so the seed UPSERT
-- never deactivates them; without this they keep polling dead CPS endpoints as
-- silent no_data. disabled=1 (not DELETE) preserves any user_favorites /
-- booking_clicks FKs — see implementation-pitfalls DB-2 and COURSE-4.
UPDATE courses SET disabled = 1 WHERE id IN ('oak-glen', 'gem-lake-hills');
```

**Do NOT:** `DELETE` these rows (CASCADE destroys user data — DB-2). Do NOT migrate `user_favorites` from the orphan ids to the split ids (out of scope, risk — YAGNI). Do NOT set `is_active` (cron owns it — COURSE-1).

**Verify:**
- Migration filename is the next sequential number (`0011`, confirmed — highest existing is `0010_add_poll_content_changed.sql`).
- Optional local dry-run: `npx wrangler d1 execute tee-times-db --local --file=migrations/0011_retire_oak_glen_gem_lake_orphans.sql` then `--local --command="SELECT id, disabled FROM courses WHERE id IN ('oak-glen','gem-lake-hills')"` → both `disabled=1`. (Local D1 may be empty/unseeded; a no-op result is acceptable — the migration runs against prod on deploy.)

**Commit (Phase 2):**
```bash
git add migrations/0011_retire_oak_glen_gem_lake_orphans.sql
git commit -m "fix(catalog): retire orphan oak-glen + gem-lake-hills rows (disabled=1)"
```
Commit body MUST reference COURSE-4 + DB-2 (why disable not delete).

### Task 2.2: Open the PR (Review-class)

```bash
git push -u origin fix/oak-glen-gem-lake-foreup
gh pr create --base dev --title "fix(catalog): Oak Glen + Gem Lake are ForeUp, not CPS" --body "<summary: 4 courses flipped cps_golf→foreup with live-verified facility/schedule ids; migration 0011 retires the 2 orphan rows; COURSE-3/COURSE-4; verification plan below>"
```
**This is Review-class — do NOT auto-merge.** Wait for Sam's merge. After CI is green, ping Sam that it's ready.

---

## Phase 3 — Verify post-deploy

**Execution Status:** ⬜ NOT STARTED — depends on Phases 1–2 being merged to `main` and deployed (deploy runs migrations + seed).

### Task 3.1: Confirm the four courses now succeed

After the change reaches prod (merge to `main` → deploy → seed + migration applied), wait for at least one cron cycle, then:

```bash
npx wrangler d1 execute tee-times-db --remote --command="SELECT id, platform, last_had_tee_times FROM courses WHERE id IN ('oak-glen-championship','oak-glen-executive','gem-lake-executive','gem-lake-par3')"
```
Expected: `platform = foreup` for all four; `last_had_tee_times` now populated (non-null).

```bash
npx wrangler d1 execute tee-times-db --remote --command="SELECT course_id, status, tee_time_count, date, polled_at FROM poll_log WHERE course_id IN ('oak-glen-championship','oak-glen-executive','gem-lake-executive','gem-lake-par3') AND polled_at > '<deploy time>' ORDER BY polled_at DESC LIMIT 20"
```
Expected: `status=success` with non-zero `tee_time_count`.

### Task 3.2: Confirm the orphans stopped polling

```bash
npx wrangler d1 execute tee-times-db --remote --command="SELECT id, disabled FROM courses WHERE id IN ('oak-glen','gem-lake-hills')"
```
Expected: `disabled=1` for both. Confirm no new `poll_log` rows appear for `oak-glen`/`gem-lake-hills` after the deploy.

### Task 3.3: Close out

Update this plan's Execution Status to ✅ SHIPPED with the merge SHA. If any course still shows `no_data`, treat as a new investigation (re-verify the schedule id against the live site per COURSE-3) — do NOT guess.

---

## Why this matters (provenance)

This plan was produced via `writing-plans-enhanced` (Step 5 mandates the Living Document Contract + per-phase Execution Status banners). The fix follows the COURSE-3/COURSE-4 pitfalls added the same day, and mirrors the prior `831d66e` "Greenhaven is ForeUp, not Chronogolf" correction. Verification is post-deploy `/check-logs`, consistent with how the CPS and Chronogolf fixes were validated on 2026-06-09.
