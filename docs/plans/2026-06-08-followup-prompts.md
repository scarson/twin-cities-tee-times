# Follow-up Agent Prompts — 2026-06-08

Copyable, self-contained starting prompts to hand to fresh agents for the follow-ups surfaced during the 2026-06-08 dependency/security/publication work. Each prompt embeds the diagnostic numbers, exact file/line anchors, the project's TDD/worktree/`dev`-targeting rules, and a **mandatory 3-round adversarial review** with task-specific attack angles.

These derive from the 2026-06-07 production diagnostic captured in the project auto-memory (`project_d1_bill_write_amplification.md`, `project_cps_chronogolf_polling_failures.md`) and the Eagle Club smoke failure observed on PR #117.

> **Status — updated 2026-06-08:** Prompt 1 (D1 write-amplification, PR #119 → `main` #120), Prompt 3 (Chronogolf 429, PR #126), and Prompt 4 (Eagle Club smoke, PR #122) are ✅ **SHIPPED**. Prompt 2 (CPS Golf) is implemented in **PR #125** (open, Review-class — awaiting Sam's merge). The remaining open work is **Prompt 5 — automate the CPS `curl_cffi` impersonation-profile rotation** (the maintenance tail introduced by the CPS fix).

## Sequencing

- **Prompt 1 (D1 write-amplification) is ✅ SHIPPED** (PR #119 → `dev`, published to `main` via PR #120 on 2026-06-08), so Prompt 2 is unblocked: compare-then-replace now absorbs the write load, so restoring CPS's ~13 courses no longer re-inflates the ~$125/mo overage. Still confirm the dedup is live in production and watch the post-deploy write rate before/after merging CPS.
- **Prompts 3 (Chronogolf) and 4 (Eagle Club) are independent** and can run in parallel anytime.

The original first follow-up bullet ("D1 + CPS/Chronogolf polling fixes") is split here into its three independent root causes (D1 writes, CPS auth, Chronogolf throttling) so each is a clean single-agent task. Combine them again if you prefer fewer agents.

---

## Prompt 1 — D1 write-amplification fix — ✅ SHIPPED (2026-06-08)

Shipped via PR #119 → `dev`, published to `main` (PR #120). Companion changes in the same PR: `poll_log.content_changed` (migration `0010`), course-detail freshness moved to `poll_log.polled_at`, past-date `tee_times` prune in batch-0 cron housekeeping, and implementation-pitfall `DB-4`. Full record: `docs/plans/2026-06-07-d1-write-amplification-fix.md` and `docs/implementation-log.md`. **Post-deploy check still owed:** confirm D1 rows-written < 50M/mo over ~1 week via `/check-logs` and the `content_changed` rate.

<details>
<summary>Original prompt — superseded; retained for reference, do not run.</summary>

````markdown
# Task: Eliminate D1 write amplification in tee-time polling (compare-then-replace)

You are a fresh agent on the **Twin Cities Tee Times** project (Next.js 16 on Cloudflare Workers + D1, polling public golf tee times). Read `CLAUDE.md` (project rules), `docs/git-strategy.md` (branch/worktree workflow), and `docs/pitfalls/implementation-pitfalls.md` + `docs/pitfalls/testing-pitfalls.md` (READ BEFORE CODING/TESTING) before touching anything. The auto-memory file `project_d1_bill_write_amplification.md` is the authoritative diagnostic for this task.

## Problem (diagnosed 2026-06-07, never implemented)
The unexpected ~$125/mo Cloudflare bill is **D1 rows-written overage**. `upsertTeeTimes` (`src/lib/db.ts`, ~lines 13–46) runs an unconditional `DELETE` + full re-`INSERT` of every tee time on *every* poll, and `pollCourse` (`src/lib/poller.ts:~75`) calls it every cycle. Today+tomorrow re-poll every 5 min (`shouldPollDate` returns true for dayOffset ≤ 1), so the entire tee-time set is rewritten every 5 minutes even when nothing changed. With the `idx_tee_times_course_date` index doubling each row write, this is ~175M writes/month vs the 50M free tier → ~$125/mo overage. Availability actually changes occasionally, not every 5 min — so deduping writes cuts ~80%+ of write volume, toward/under the free tier.

## Decided approach (from a prior 5-round adversarial review — do NOT relitigate)
**Compare-then-replace inside `upsertTeeTimes`:** SELECT the existing rows for that course+date, normalize and multiset-compare against the freshly fetched set, **skip the write entirely when equal**, otherwise keep the existing atomic full-replace `db.batch`. (Row-level diffing and stored-hash approaches were considered and REJECTED — do not implement them.)

### Four required merge gates (all must be satisfied)
1. **Conservative canonicalization.** When in doubt → treat as "changed." `null`/`undefined`/`NaN` must NEVER coerce-equal to `0`/`""`. Compare `price` and `open_slots` as canonical strings, not floats. The only dangerous error is "wrongly equal → serve stale availability," so bias every ambiguity toward writing.
2. **Migrate course-detail freshness off per-row `tee_times.fetched_at` → `poll_log.polled_at`.** Skipping writes leaves `fetched_at` stale, which would make the UI show false staleness. `src/components/course-header.tsx` ("Last updated", ~lines 88–95) and `src/components/tee-time-list.tsx` ("* stale" badge, ~lines 150–188) currently read per-row `fetched_at`. The course `[id]` route already selects `last_polled` from `poll_log` — wire the UI to that instead. (Courses LIST routes already use `poll_log`; only the detail page is inconsistent.)
3. **Keep the write a full-replace `db.batch` and comment WHY** — this makes a skipped stale snapshot provably benign (last-writer-wins, never torn).
4. **Add `open_slots` (or a content hash) to the `poll_log` row** (already inserted every poll → near-free) so intra-count churn is measurable. Post-deploy, verify writes land < 50M/mo over one week via `/check-logs` and D1 analytics.

## Secondary (flag, don't bundle unless trivially safe)
`tee_times` has un-pruned rows back to 2026-03-09 because nothing deletes past-date rows. A cleanup job for `date < today` is worth a SEPARATE follow-up — mention it in your PR but don't expand scope into it without surfacing the decision.

## Hard constraints
- **TDD is mandatory** (this is production `src/` code): write failing tests first, per `superpowers:test-driven-development`. Cover the equal-set skip, every "must be treated as changed" edge case (null vs 0, NaN, added/removed time, changed price, changed open_slots, reordered set), and the freshness-source migration.
- Respect pitfalls: **DB-1** (never compare `datetime()` against JS ISO strings — use `sqliteIsoNow()`), **DB-2** (never hard-delete courses), **CF-1** (no `process.env`), **TIME-1** (Central Time via `todayCT()`).
- Worktree at `.claude/worktrees/<slug>`, branch `fix/...` off `dev`, PR targets **`dev`** (never `main`). Conventional Commits. Use `superpowers:systematic-debugging` if anything surprises you.

## Adversarial review (REQUIRED — minimum 3 rounds)
This must survive **three rounds** of adversarial review before the PR. A round = an independent critical pass whose explicit job is to **break** the work, then you fix every must-fix finding. Continue until a full round finds nothing must-fix; hard minimum 3 rounds.
- **Plan stage:** run the `plan-review-cycle` skill on your written plan.
- **Implementation stage (after green):** run `superpowers:requesting-code-review` and dispatch `feature-dev:code-reviewer` (and/or `code-bug-hunter-holistic`) as independent reviewers.
- Every round MUST specifically attack: **the "wrongly equal → serve stale availability" failure mode** (the only dangerous bug), canonicalization of null/NaN/empty, multiset comparison correctness under reordering and duplicate rows, the freshness-source migration (no false "stale" or false "fresh" badge), and concurrency/torn-write safety of the skip.
- Record all 3 rounds (findings + resolutions) in the PR description.

## Deliverables
A PR to `dev` implementing gates 1–4 with full TDD coverage, the 3-round review trail in the description, and a short note on how you'll verify writes drop below the free tier post-deploy. Close with a completion label (DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT) and evidence.
````

</details>

---

## Prompt 2 — CPS Golf polling failure (auth / transaction registration)

> **Status — 2026-06-08:** ✅ **Implemented in PR #125** (open, Review-class). Root cause was NOT the auth/handshake bug this prompt assumed: CPS moved its v5 reservation API behind a **fingerprint-gated Cloudflare managed challenge**. Fix = fetch proxy rewritten Node→Python+`curl_cffi` (`impersonate="chrome"`) to send a browser TLS fingerprint, plus an adapter canary that throws a distinct "blocked by Cloudflare challenge" error. Full writeup: `docs/research/2026-06-08-cps-cloudflare-challenge.md`; pitfall **DEPLOY-2**. **Follow-up:** the impersonation profile ages out of Cloudflare's allowlist (manual "bump `curl_cffi` + redeploy" runbook today) → **Prompt 5** automates that.

````markdown
# Task: Root-cause and fix the systemic CPS Golf "transaction registration failed" polling break

You are a fresh agent on the **Twin Cities Tee Times** project (Next.js 16 on Cloudflare Workers + D1; polls public golf tee times via per-platform adapters). Read `CLAUDE.md`, `docs/git-strategy.md`, and `docs/pitfalls/*.md` before coding. Background on the CPS Golf platform is in `docs/research/booking-platform-investigation.md`; the diagnostic is in auto-memory `project_cps_chronogolf_polling_failures.md`.

## ⚠️ Sequencing prerequisite (satisfied as of 2026-06-08)
The D1 write-amplification dedup (`project_d1_bill_write_amplification.md`) has **shipped** (PR #119 → `dev`, published to `main` on 2026-06-08), so compare-then-replace now absorbs the write load when CPS resumes writing. Before merging this, confirm the dedup is live in production and watch the post-deploy write rate (`/check-logs` + D1 dashboard) as ~13 CPS courses come back online. State this dependency in your PR.

## Problem (diagnosed 2026-06-07)
**ALL ~13 CPS Golf courses fail every poll with `Error: CPS Golf transaction registration failed`** — ~44k errors over the 7-day `poll_log` window, uniform across every CPS facility, zero successful CPS data, and it's burning subrequest budget. Uniformity across all facilities ⇒ a **systemic adapter/auth break**, not per-facility config. The error is thrown in `src/adapters/cps-golf.ts` (around lines 172/177/206/211) from the `RegisterTransactionId` flow (`tryRegisterTransaction`, ~line 183; main path ~line 161). There is a v4→v5 auth migration probe in `src/lib/cron-handler.ts` (~lines 110–150) that flips `authType` in `platform_config` — understand how it interacts.

## Fresh diagnostic note (2026-06-08)
Still failing every cron cycle as of 2026-06-08 (not self-resolved) — ~3,900–4,000 errors per CPS course over the June 1–8 `poll_log` window. **Localization clue:** a *separate* transient `CPS Golf token request failed: HTTP 503` blip hit several CPS courses only during ~07:01–07:03 on 2026-06-05 and self-resolved — meaning the token-acquisition step normally succeeds (HTTP 200). The constant break is specifically the **transaction-registration** step that runs *after* the token, so focus there, not on token auth. Fastest localizer: run a live SD course (Encinitas Ranch, `jcgsc5.cps.golf`) and diff its transaction-registration request/response against an MN facility — if SD works and MN doesn't, the endpoint/response-shape delta is the root cause.

## Your job
Find the **root cause** (do not patch symptoms — follow `superpowers:systematic-debugging`). Likely candidates to investigate, not assume: an upstream CPS API change to the transaction-registration handshake, a rotated/expired `x-apikey` or per-facility `x-siteid`/`x-terminalid` headers (~line 283+), the v4/v5 token flow, or a changed response shape that trips the "registration failed" guard.

**Use live San Diego CPS test courses for comparison** (they're JC Golf-managed and were working): Encinitas Ranch (`jcgsc5.cps.golf`) and Twin Oaks — see `docs/research/sd-test-courses.md`. If SD works and MN fails, the delta localizes the break. The live smoke test is `src/adapters/cps-golf.smoke.test.ts`.

## Hard constraints
- **TDD** for any production logic change. Add/strengthen tests so this exact failure mode is caught next time. Do NOT weaken the smoke test to make it pass — capture the real error contract.
- No secrets in CLI flags / logs; no PII in logs (log course IDs, not emails). Pitfalls **CF-1** (no `process.env`), **TIME-1**, **DB-1** still apply.
- Worktree under `.claude/worktrees/<slug>`, branch `fix/...` off `dev`, PR targets **`dev`**. Conventional Commits.
- If the root cause is an upstream change you cannot fully verify in-session, escalate (BLOCKED) with REASON / ATTEMPTED / RECOMMENDATION rather than guessing.

## Adversarial review (REQUIRED — minimum 3 rounds)
Three rounds of independent break-it review before the PR; fix every must-fix finding each round; minimum 3 even if early rounds are clean.
- **Plan/diagnosis stage:** before writing the fix, have an independent reviewer (fresh subagent or `code-bug-hunter-exploratory`) try to falsify your root-cause hypothesis — "what else could cause a uniform registration failure across all facilities?"
- **Implementation stage:** `superpowers:requesting-code-review` + `feature-dev:code-reviewer`.
- Every round MUST probe: whether the fix addresses the *root* cause vs a symptom; subrequest-budget impact (CPS is ~13 courses × multiple dates per cron — don't blow the Workers subrequest limit); interaction with the v4→v5 migration probe; and whether SD-vs-MN behavior is actually explained, not just patched.
- Record the 3 rounds in the PR description.

## Deliverables
A PR to `dev` with the root-cause writeup, the fix, regression tests, the D1-dependency note, and the 3-round review trail. End with a completion label + evidence (ideally a successful live poll against a real CPS course).
````

---

## Prompt 3 — Chronogolf rate-limiting (429) fix

> **Status — 2026-06-08:** ✅ Implemented on branch `fix/chronogolf-429-pacing` (PR to `dev`). Fix = single Chronogolf cron lane + per-request adapter throttle (covers pagination) + wall-clock lane deadline; root cause was per-invocation pacing vs. a per-IP limit summed across overlapping batches (see `docs/pitfalls/implementation-pitfalls.md` CF-4 and `docs/plans/2026-06-08-chronogolf-rate-limit-pacing-plan.md`). Post-deploy verification via `/check-logs` (429 → ~0 over a week).

````markdown
# Task: Stop the systemic Chronogolf HTTP 429 rate-limiting across ~35 courses

You are a fresh agent on the **Twin Cities Tee Times** project (Next.js 16 on Cloudflare Workers + D1; per-platform tee-time polling adapters). Read `CLAUDE.md`, `docs/git-strategy.md`, `docs/pitfalls/*.md` first. Chronogolf platform background: `docs/research/remaining-platforms-investigation.md`. Diagnostic: auto-memory `project_cps_chronogolf_polling_failures.md`.

## Problem (diagnosed 2026-06-07)
**ALL ~35 Chronogolf courses intermittently fail with HTTP 429** — ~20k errors over the 7-day window, some successes interleaved. Chronogolf is the project's **largest** platform (~35 courses, all Three Rivers Park District). We are polling too many Chronogolf courses too fast; the current per-platform pacing is insufficient. The polling cadence/backoff lives in `src/lib/batch.ts` (`platformWeight`, `sleepAfterPoll`, `assignBatches`) and is applied in `src/lib/cron-handler.ts` (`await sleep(sleepAfterPoll(course.platform))`, ~lines 83/275/319). The adapter is `src/adapters/chronogolf.ts` (plain `fetch`, ~line 54).

## Fresh diagnostic note (2026-06-08)
The 429s arrive in **synchronized bursts**, not at random: error timestamps cluster tightly at specific cron ticks (e.g. many at ~21:35 and ~23:34), the signature of all ~35 Chronogolf courses hitting the API inside a single cron invocation. Per-course counts over June 1–8 ranged ~250–770. This favors **spreading Chronogolf across more cron batches and/or capping concurrent Chronogolf polls** over merely lengthening `sleepAfterPoll` — the goal is to stop them all firing within one tick. Occasional single Chronogolf 5xx (500/502/503) also appear; those are upstream blips, not rate-limiting, and must NOT drive the pacing math.

## Scope clarification — two distinct things, fix only the production one
- **PRODUCTION issue = 429 (rate limiting).** This is the real bug. Fix via lower Chronogolf concurrency / longer per-platform backoff / batch spreading so ~35 courses aren't hammered within one cron tick. Consider: increasing Chronogolf's `platformWeight`/`sleepAfterPoll`, capping concurrent Chronogolf polls, or spreading Chronogolf courses across more cron batches.
- **NOT in scope = the 403 "TLS fingerprint block from Node.js undici"** seen in the smoke test. That is a **CI/Node-only artifact** (the smoke test already skips it gracefully). Production runs on the Cloudflare Workers `fetch`, which has a different TLS stack. Do NOT contort production code to satisfy undici. If you touch it at all, only confirm the smoke skip is correct.

## Design considerations
- Respect the Workers cron model and subrequest/time budgets — slowing Chronogolf must not starve other platforms or overrun the cron wall-clock. Verify against `docs/research/cloudflare-limits.md`.
- Whatever pacing you choose must be derived/justified, not magic-numbered — show the math (courses × dates × cadence vs Chronogolf's tolerated rate).

## Hard constraints
- **TDD** for the batching/backoff logic (`batch.ts` is testable pure logic — assert concurrency caps and sleep selection). Pitfalls **CF-1**, **TIME-1**, **DB-1** apply.
- Worktree `.claude/worktrees/<slug>`, branch `fix/...` off `dev`, PR targets **`dev`**. Conventional Commits. Use `superpowers:systematic-debugging`.

## Adversarial review (REQUIRED — minimum 3 rounds)
Three rounds of independent break-it review before the PR; resolve must-fix findings each round; minimum 3.
- **Plan stage:** `plan-review-cycle` on your pacing plan.
- **Implementation stage:** `superpowers:requesting-code-review` + `feature-dev:code-reviewer`.
- Every round MUST probe: does the new pacing actually keep all ~35 courses under the 429 threshold across a full cron tick? Does it starve other platforms or blow the cron time/subrequest budget? Is the 403/undici concern correctly excluded as out-of-scope? Are the backoff numbers justified by the request-volume math?
- Record the 3 rounds in the PR description.

## Deliverables
A PR to `dev` with the throttling fix, tests for the batching/backoff logic, the volume math, and the 3-round review trail. End with a completion label + evidence. Note: post-deploy verification is via `/check-logs` (429 count should fall to ~0 over a week).
````

---

## Prompt 4 — Eagle Club brittle smoke assertion

````markdown
# Task: Fix the brittle Eagle Club smoke-test assertion that hard-codes 18 holes

You are a fresh agent on the **Twin Cities Tee Times** project (Next.js 16 on Cloudflare Workers + D1). Read `CLAUDE.md` and `docs/pitfalls/testing-pitfalls.md` first. Eagle Club platform background: `docs/research/remaining-platforms-investigation.md`.

## Problem
The Adapter Smoke Tests CI job fails on `src/adapters/eagle-club.smoke.test.ts` (~line 136) with `AssertionError: expected 9 to be 18`. The test asserts `expect(tt.holes).toBe(18)` for every returned tee time, but the live Eagle Club course (Valleywood) legitimately offers **9-hole** tee times. The assertion encodes a false assumption that all Eagle Club times are 18-hole.

## Fresh confirmation (2026-06-08)
Confirmed live on 2026-06-08: Valleywood genuinely returned a **9-hole** tee time, and this is the only Adapter Smoke Tests failure besides the separate CPS Golf break — i.e. the adapter output is real data and the hard-coded `toBe(18)` assertion is the defect, exactly as framed below. Still verify the adapter classifies 9 vs 18 correctly before relaxing the assertion (don't mask a real misclassification).

## Your job — but do NOT just weaken the test
Per `CLAUDE.md`, you must not relax a test merely to make it pass. First **confirm 9 is genuinely valid** for this platform: read `src/adapters/eagle-club.ts` and verify the adapter *correctly classifies* 9 vs 18 holes from the API response (not misclassifying). Then fix the assertion to validate the real contract: `holes` must be one of `9 | 18` (a valid classification with no nulls/NaN), rather than hard-coded `18`. Mirror however the other adapters' smoke tests assert holes (check `src/adapters/*.smoke.test.ts` for the canonical pattern — e.g., the holes-classification helper in `src/lib/parse-holes.ts`).

## Also (small sweep, in scope)
Grep the other `*.smoke.test.ts` files for the same brittle `toBe(18)` / hard-coded-holes pattern and fix any others that would break when a course offers 9-hole times. Flag (don't necessarily fix) any deeper holes-misclassification you find in an adapter.

## Hard constraints
- This is a test-quality fix; if you change adapter production logic, **TDD** applies. Keep test output PRISTINE (the `testing-pitfalls.md` discipline).
- Worktree `.claude/worktrees/<slug>`, branch `fix/...` (or `test/...`) off `dev`, PR targets **`dev`**. Conventional Commits.

## Adversarial review (REQUIRED — minimum 3 rounds)
Even though this is small, three rounds of independent review are required; minimum 3.
- **Stage 1:** an independent reviewer confirms 9-hole really is a valid Eagle Club output (you're not masking a real misclassification bug).
- **Stages 2–3:** `superpowers:requesting-code-review` + `feature-dev:code-reviewer` on the final diff.
- Every round MUST probe: are you hiding a real adapter bug behind a looser assertion? Does the new assertion still catch genuine corruption (null/NaN/0/garbage holes)? Did the cross-adapter sweep miss any sibling smoke test with the same flaw?
- Record the 3 rounds in the PR description.

## Deliverables
A PR to `dev` fixing the assertion (and any siblings), confirming the adapter classifies holes correctly, with the 3-round review trail. End with a completion label + evidence (the smoke test passing against live data, or a clear note if live data is unavailable in the run).
````

---

## Prompt 5 — Automate the CPS `curl_cffi` impersonation-profile rotation

> **Status — 2026-06-08:** ✅ **Implemented** on `feat/cps-profile-rotation` (PR #129 to `dev`, Review-class — Sam merges). Hybrid: an in-proxy versionless multi-vendor cascade (`chrome`/`safari`/`firefox`, axis 1, no redeploy) + a daily live-probe-gated GitHub Actions workflow that, when the pin ages out and a newer version both live-clears the real CPS challenge and cross-vendors for the Lambda, **auto-merges** the bump to `main` + `dev` and triggers a deploy — **unattended auto-deploy** (Sam's call: don't babysit). Decision logic is a pure, exhaustively unit-tested function. Design: `docs/plans/2026-06-08-cps-profile-rotation-design.md`; plan: `docs/plans/2026-06-08-cps-profile-rotation-plan.md`; log: `docs/implementation-log.md`. **Owed:** live `workflow_dispatch` runs deferred to post-merge-to-`dev`; the deploy-trigger leg works once published `dev`→`main`.

> **Why this exists:** the CPS fix (Prompt 2 / PR #125) defends against CPS's Cloudflare challenge by sending a browser TLS fingerprint via `curl_cffi` (`impersonate="chrome"`) from the Lambda fetch-proxy. Cloudflare allowlists *current* browser fingerprints and the `curl_cffi` version is frozen at deploy time, so the fingerprint eventually ages out (already true for pinned `chrome124`/`chrome131`). When it does, **all ~13 v5 CPS courses break again** and recovery is a manual runbook: bump `curl_cffi` in `requirements.txt` → redeploy. This task makes that self-healing / self-updating. **Design/architecture work, not a known-answer bugfix** — investigate and recommend before building.

````markdown
# Task: Automate the CPS Golf curl_cffi impersonation-profile rotation so the Cloudflare-challenge defense self-heals

You are a fresh agent on the **Twin Cities Tee Times** project (Next.js 16 on Cloudflare Workers + D1; polls public golf tee times via per-platform adapters, with an AWS Lambda fetch-proxy for hosts that block Worker IPs). Read `CLAUDE.md`, `docs/git-strategy.md`, and `docs/pitfalls/*.md` first.

## REQUIRED background (this is a direct follow-up to the CPS Cloudflare fix — read before designing)
- `docs/research/2026-06-08-cps-cloudflare-challenge.md` — the root cause + fix you are extending (see its "Maintenance tail" section, which motivates this task).
- `docs/pitfalls/implementation-pitfalls.md` **DEPLOY-2** — read-before-you-code summary + the manual rotation runbook this task automates. Its rule: use the versionless `chrome` alias, never a pinned `chromeNNN`.
- `lambda/fetch-proxy/index.py` — the proxy. `PRIMARY_PROFILE = "chrome"`, `FALLBACK_PROFILE = "safari17_0"`, with a time-bounded challenge fallback; `_is_cf_challenge()` is the detector.
- `lambda/fetch-proxy/requirements.txt` — the pinned `curl_cffi` (vendored at deploy time by `.github/workflows/deploy.yml`).
- `.github/workflows/deploy.yml` — Lambda vendoring + deploy (runs on push to `main` only).
- `src/adapters/cps-golf.ts` — the **canary**: `isCloudflareChallenge()` → throws `CPS Golf reservation API blocked by Cloudflare challenge (HTTP 403)`. This is the detection signal in `poll_log`/`check-logs`. Do NOT remove it.
- `src/lib/proxy-fetch.ts` — the Worker→Lambda seam (SigV4'd Function URL). The proxy currently **hardcodes** the impersonation profile; the Worker could pass it in the request payload.

## The problem
CPS's v5 reservation API sits behind a Cloudflare managed challenge that is **fingerprint-gated**. The proxy clears it with a browser TLS fingerprint, but the vendored `curl_cffi`'s `chrome` fingerprint eventually ages out of Cloudflare's allowlist → the challenge returns → every v5 CPS poll fails → manual bump+redeploy. Make this automatic (self-heal, or self-update with a safe gate). Sam's framing: "this should be automatable, even if we store a rolling version pin with an update mechanism in the database or something."

## Approach
Start with `superpowers:brainstorming`. Do NOT jump to code. Investigate the solution space, weigh tradeoffs, and **bring Sam a recommendation BEFORE implementing** (architectural decision per `CLAUDE.md`).

### The conceptual trap you MUST get right (or the design will be wrong)
Two separable problems — do not conflate them:
1. **Profile *selection*** among fingerprints the installed `curl_cffi` already ships — pure config; changeable WITHOUT a Lambda redeploy (e.g. the Worker reads a profile from D1/KV and passes it to the proxy in the `proxyFetch` payload).
2. **Getting a *newer* fingerprint** than the installed `curl_cffi` knows — REQUIRES a package update + Lambda redeploy. No config/DB value can conjure a fingerprint the vendored library does not contain.

A "rolling version pin in the database" only solves (1). True future-proofing against Cloudflare advancing past *every* installed profile needs automated rebuild+redeploy for (2). **State explicitly which axis each option addresses.**

### Options to evaluate (compare and recommend — don't pre-commit)
- **(A) Multi-profile cascade in the proxy.** Extend the `chrome`→`safari17_0` fallback to a list of current profiles, trying each until one clears the challenge. Self-heals within one invocation, no redeploy — but bounded by the installed `curl_cffi`, and each fallback costs an extra upstream request (mind the `proxyFetch` ~12s / Lambda 15s budget; the proxy already time-bounds the fallback).
- **(B) Config-driven profile selection (the "rolling pin in DB" idea, for PROFILE not VERSION).** Worker reads the desired profile from D1/KV and passes it to the proxy; an operator or automated job rotates among installed profiles without a Lambda redeploy. Note: the Worker has D1; the Lambda does not — config must flow Worker→proxy via the request payload.
- **(C) Scheduled auto-rotation pipeline (the only thing that solves axis 2).** A scheduled GitHub Action (or Cron Trigger) that detects the challenge — via the `poll_log` canary and/or a live probe — then tries the latest `curl_cffi` and/or newer profiles, and **only if a LIVE smoke test confirms the candidate clears the actual CPS challenge**, bumps `requirements.txt` and either opens a ready-to-merge PR or auto-deploys. Automates the manual runbook.
- **(D) Hybrid:** (A)/(B) for instant rotation among known-good profiles + (C) for pulling in newer fingerprints + the canary as the trigger.

### Questions the investigation must answer
- **How often does this actually fire?** Estimate from Chrome's release cadence (~monthly), `curl_cffi`'s release lag, and Cloudflare's allowlist lag. If rare (every several months), a monitored auto-PR with a human merge may beat unattended auto-deploy; if frequent, lean fuller automation. Reason it out / instrument it.
- **Does Sam want unattended auto-deploy of prod infra, or a human gate?** Surface this as an explicit decision, don't assume.
- Latency/cost of the in-proxy cascade vs. its resilience benefit.
- Any auto-remediation MUST be gated on a live smoke test proving the candidate clears the *real* CPS challenge before shipping — **never deploy a blind/unverified profile or version.**

## Hard constraints
- Mostly infra/CI/proxy work. **TDD applies to any production `src/` logic** (e.g. if the Worker gains profile-config logic). The Lambda (Python) and CI are outside the `src/` TDD mandate but MUST be live-verified (smoke-test the chosen mechanism against a real CPS facility, as the CPS fix did via `handler()`).
- **Never ship a profile/version not live-verified to clear the actual CPS challenge.** No secrets in logs/CLI flags; no PII (log course IDs, not emails). Verify Cloudflare platform behavior (Cron Triggers, KV, subrequest budget) via the docs MCP — don't guess (CF-1, CF-3 apply).
- Keep the canary (the distinct challenge error) and the `chrome`→`safari` fallback. Use the versionless `chrome`, never `chromeNNN` (DEPLOY-2).
- Worktree under `.claude/worktrees/<slug>`, branch `feat/...` or `chore/...` off `dev`, PR targets **`dev`**. Conventional Commits.

## Adversarial review (REQUIRED — minimum 3 rounds)
- **Plan stage:** `plan-review-cycle` on your design/plan; have an independent reviewer attack the **version-vs-profile distinction** — does the design actually future-proof against ALL installed profiles aging out, or only rotate among them?
- **Implementation stage:** `superpowers:requesting-code-review` + `feature-dev:code-reviewer`.
- Every round MUST probe: can the mechanism ship a **blind/unverified** profile to prod? What's the **self-heal latency** (how long is CPS down before rotation kicks in)? Does the cascade blow the `proxyFetch`/Lambda time budget? Does auto-deploy have a safe rollback and a fail-closed smoke gate? Does it leak secrets/PII?
- Record the 3 rounds in the PR description.

## Deliverables
First, a brainstorming/design writeup + a recommendation to Sam — with the version-vs-profile axis made explicit and the auto-deploy-vs-human-gate decision surfaced. After Sam agrees: a plan (`writing-plans-enhanced`), then the implementation PR(s) to `dev` with the live-smoke-test gate, the 3-round review trail, and a completion label + evidence. **Out of scope:** re-solving the root cause (done in PR #125), a headless browser (the challenge is fingerprint-gated — impersonation suffices), and the other platforms' issues.
````
