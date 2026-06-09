# Investigation Brief — "Dark" Courses That Have Never Returned Tee Times

> **For the investigating agent:** This is a starting prompt, not an implementation plan. Your job is to investigate and classify, then recommend (and only then, if asked, plan/fix). Read the referenced pitfalls and memory before recommending any fix. **Verify against live booking sites — do not trust the catalog.**

## Situation

Twin Cities Tee Times polls public golf-course booking platforms and caches availability in Cloudflare D1. A `/check-logs` deep-dive on **2026-06-09** found **23 active, non-disabled courses that have NEVER returned a tee time** — `last_had_tee_times IS NULL`, **zero `success` rows** in `poll_log` across the entire retention window. That "never once succeeded" signal (as opposed to "no times today") is the tell for a real problem, not empty inventory.

Six of the 23 (all Oak Glen + Gem Lake entries) were a **confirmed platform misconfiguration** — tagged `cps_golf` but actually booking on **ForeUp** — and are being fixed under a separate plan. See pitfall **COURSE-3** (a misconfigured course fails as silent `no_data`, never `error`) and memory `project_oak_glen_gem_lake_foreup_misconfig.md`.

**This investigation covers the remaining 17 courses:**

- **16 Chronogolf:** `crystal-lake`, `eagle-valley`, `elk-river`, `fox-hollow`, `hastings-golf-club`, `le-sueur`, `legends-club`, `links-at-northfork`, `oak-marsh`, `riverwood-national`, `royal-golf-club`, `rum-river-hills`, `stonebrooke`, `the-meadows-at-mystic-lake`, `the-refuge`, `the-wilds`
- **1 TeeItUp:** `deer-run` (alias `deer-run-golf-course`, apiBase `https://phx-api-be-east-1b.kenna.io`, facilityId `3910`)

## Goal

For **each** of the 17 courses, determine why it has never returned data and classify it:

- **(A) MISCONFIGURED** — wrong platform, wrong club/course id, or stale endpoint (like Oak Glen/Gem Lake). Needs a `courses.json`/config fix. Provide the corrected, *verified* config.
- **(B) RECOVERING** — was starved by the systemic Chronogolf HTTP 429 rate limit (see below) and is now succeeding, or will once polled. No code change; just confirm recovery.
- **(C) GENUINELY CLOSED / NO PUBLIC ONLINE TEE TIMES** — seasonally/permanently closed, members-only, or doesn't publish public online tee times. Should be `disabled = 1` (manual) — with evidence.
- **(D) OTHER** — describe precisely.

## CRITICAL first step for the 16 Chronogolf courses

The Chronogolf **HTTP 429** failure was *systemic across all ~40 Chronogolf courses* until a fix deployed at **2026-06-09T00:45Z** (PR #131: single Chronogolf cron lane + per-request throttle + lane deadline). Many Chronogolf courses that showed 0 successes pre-fix are **now succeeding** (verified: baker-national, gopher-hills, glencoe, dwan, mount-frontenac, troy-burne all green post-fix). So these 16 may simply be **429-starved and recovering**.

**Before assuming misconfiguration, check whether each of the 16 has started returning data in cycles AFTER ~`2026-06-09T01:00Z`.**
- Succeeding now → **bucket B**, done.
- Still 0 successes many hours/days after the fix → investigate config (**A**) or closure (**C**).

Reference: memory `project_cps_chronogolf_polling_failures.md`.

## Method & commands

**Production poll_log (read-only; always use `--remote`):**

```bash
# Status histogram per course over the window
npx wrangler d1 execute tee-times-db --remote --command="SELECT course_id, status, COUNT(*) c, MIN(date) mind, MAX(date) maxd, MAX(polled_at) last FROM poll_log WHERE course_id IN ('crystal-lake','eagle-valley','elk-river','fox-hollow','hastings-golf-club','le-sueur','legends-club','links-at-northfork','oak-marsh','riverwood-national','royal-golf-club','rum-river-hills','stonebrooke','the-meadows-at-mystic-lake','the-refuge','the-wilds','deer-run') GROUP BY course_id, status ORDER BY course_id, status"

# Post-fix recovery check for one course
npx wrangler d1 execute tee-times-db --remote --command="SELECT status, tee_time_count, date, polled_at FROM poll_log WHERE course_id='<id>' AND polled_at > '2026-06-09T01:00:00Z' ORDER BY polled_at DESC LIMIT 20"

# Error breakdown for one course
npx wrangler d1 execute tee-times-db --remote --command="SELECT error_message, COUNT(*) c, MAX(polled_at) last FROM poll_log WHERE course_id='<id>' AND status='error' GROUP BY error_message ORDER BY c DESC"
```

**Current config (catalog + live D1):**

```bash
npx wrangler d1 execute tee-times-db --remote --command="SELECT id, platform, platform_config, booking_url, is_active, disabled, last_had_tee_times FROM courses WHERE id IN (...)"
```
- Catalog source of truth: `src/config/courses.json` (`platform`, `platformConfig`, `bookingUrl`).

**Verify the REAL platform & ids (the COURSE-3 discipline — don't trust the catalog):**
1. Find the course's official booking page (course website "Book Tee Time", or search "<course name> MN tee times").
2. Identify the platform from the host/URL:
   - **Chronogolf/Lightspeed:** `*.chronogolf.com` / `*.chronogolf.ca` / lightspeed; numeric club + course ids in URL/API.
   - **ForeUp:** `foreupsoftware.com/index.php/booking/<facilityId>/<scheduleId>`.
   - **TeeItUp:** `<tenant>.book.teeitup.com/?course=<id>` (kenna.io backend).
   - Others (GolfNow, Teesnap, EZLinks, Eagle Club, city/custom) — see `docs/research/`.
3. Compare live platform + ids to our config. Mismatch → bucket A.

**Reproduce an adapter call (confirm the fix target before recommending it):**
- **ForeUp** (direct, no proxy): `GET https://foreupsoftware.com/index.php/api/booking/times?date=MM-DD-YYYY&time=all&holes=0&players=0&booking_class=default&specials_only=0&schedule_id=<id>&api_key=no_limits`
- **Chronogolf:** routed through the Lambda proxy (Cloudflare/CSRF + rate limits); read `src/adapters/chronogolf.ts` for the exact endpoint and how club/course ids map. Live repro may need the proxy — otherwise reason from the live site + adapter code.
- **TeeItUp:** `GET` against the kenna apiBase with the `x-be-alias` header; see `src/adapters/teeitup.ts`.

## Guardrails

- **Verify, don't guess** (project rule). Confirm live platform/ids before claiming misconfig.
- **Never hard-delete a course** — DB-2: `ON DELETE CASCADE` destroys `user_favorites`/`booking_clicks`. Retire via `courses.json` `disabled=1`, or a migration `UPDATE courses SET disabled=1 WHERE id IN (...)` for orphan rows not in `courses.json` (COURSE-4).
- Config changes reach prod via the **seed UPSERT** on deploy — it updates `platform`/`platform_config`/`booking_url` (DB-3).
- Read first: `docs/pitfalls/implementation-pitfalls.md` (COURSE-1..4, DB-2, DB-3).
- Distinguish "no times *today*" (could be legit/booked) from "**never** any times for **any** date" (the signal here).

## Deliverable

1. A table: `course_id | current config | live platform/ids found | verdict (A/B/C/D) | recommended action`.
2. Bucket A: the exact corrected `platform` + `platformConfig` + `bookingUrl`, verified (reproduced if possible).
3. Bucket C: evidence (course site says closed / no online booking).
4. Recommendation on whether to write an implementation plan (`writing-plans-enhanced`) for the fixes, mirroring the Oak Glen/Gem Lake fix (courses.json flips + any orphan-disable migration).
5. **Persist findings** so they survive compaction: a dated note under `docs/research/` (or `docs/plans/`) + update project memory. Capture any new generalizable trap as a pitfall.

## Starting context to read

- `docs/pitfalls/implementation-pitfalls.md` — COURSE-3/4, DB-2/3
- memory: `project_cps_chronogolf_polling_failures.md`, `project_oak_glen_gem_lake_foreup_misconfig.md`
- `docs/research/remaining-platforms-investigation.md` — Chronogolf + TeeItUp API details
- `docs/research/tc-courses-platforms.md` — all ~79 courses by platform
- `src/adapters/chronogolf.ts`, `src/adapters/teeitup.ts`
- `.claude/skills/check-logs/` — the production-log workflow
