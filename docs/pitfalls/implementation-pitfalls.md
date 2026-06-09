# Twin Cities Tee Times — Implementation Pitfalls & Review Findings

> **Purpose:** Document implementation traps, design flaws, and corrected decisions that would cause production failures, security vulnerabilities, or data correctness bugs if shipped. This document is the primary code review reference for the Twin Cities Tee Times codebase.
>
> **Relationship to testing-pitfalls.md:** This document specifies *what* to implement and *why*. `docs/pitfalls/testing-pitfalls.md` specifies *how to verify* those implementations work correctly. They are complementary — cross-references are noted inline.
>
> **Last validated against codebase:** 2026-06-08

---

## How to Use This Document

This document serves three audiences. Start here, then go directly to the section you need.

**If you're implementing code:** Go to the domain section matching your work area. Each entry has a *Flaw → Why It Matters → Fix → Lesson* structure (condensed to a single paragraph when the fix is self-evident). Follow the Fix. The Lesson teaches the generalizable principle so you'll catch the next instance.

**If you're reviewing code:** Go to your domain section's **Review Checklist** at the end. Each item is a pass/fail check derived from the pitfalls above it. If a checklist item fails, read the referenced pitfall for context.

**If you're maintaining this document:** Every pitfall discovered during implementation, review, or debugging MUST be added here. See Appendix C at the end. Partial updates cause drift.

---

## Table of Contents

| § | Section | You're working on... | Entries | Checklist |
|---|---------|---------------------|---------|-----------|
| 1 | [Time & Timezones](#section-1-time--timezones) | Any date/time logic, "today", date strings | TIME-1 | §1.C |
| 2 | [Cloudflare Workers Runtime](#section-2-cloudflare-workers-runtime) | Bindings, secrets, env access, runtime APIs | CF-1 – CF-4 | §2.C |
| 3 | [Database & D1](#section-3-database--d1) | SQL queries, schema, seeding | DB-1 – DB-4 | §3.C |
| 4 | [Course Catalog & Lifecycle](#section-4-course-catalog--lifecycle) | courses.json, polling flags, onboarding | COURSE-1 – COURSE-4 | §4.C |
| 5 | [Auth & Sessions](#section-5-auth--sessions) | Authentication, cookies, OAuth | AUTH-1 – AUTH-2 | §5.C |
| 6 | [Deploy & Infrastructure](#section-6-deploy--infrastructure) | CI/CD, the Lambda fetch proxy | DEPLOY-1 – DEPLOY-3 | §6.C |
| — | [Orchestration](#orchestration) | Parallel subagent dispatch and output persistence | ORCH-1 | §Orchestration.C |
| A | [Historical Changelog](#appendix-a-historical-changelog) | Provenance, validation dates | — | — |
| B | [Unified Summary Table](#appendix-b-unified-summary-table) | All pitfalls at a glance, with severity and status | — | — |
| C | [Document Maintenance Guide](#appendix-c-document-maintenance-guide) | How to add/update pitfalls | — | — |

---

# Section 1: Time & Timezones

> **Reader context:** I'm computing dates, formatting "today", or comparing timestamps.
>
> This app is **Central Time everywhere**. The dangerous seam is between server-side code (must be CT-aware) and JavaScript's UTC-defaulting `Date`. See testing-pitfalls.md §2 for the verification checklist.

---

### TIME-1: Derive Dates from `todayCT()`, Never Raw `new Date()` / `toISOString()`

**The Flaw:** Computing a date string with `new Date().toISOString().split("T")[0]` returns the **UTC** date. In Central Time that rolls over to *tomorrow* after ~6–7 PM local.

**Why It Matters:** Users in CT see tomorrow's date selected for several hours every evening; worse, the cron handler and the client can disagree about what "today" is, so the user requests tee times for a date the poller never polled. The failure is invisible in tests that run at the wrong hour.

**The Fix:** Use `todayCT()` from `src/lib/format.ts` for date strings. All date logic uses the `America/Chicago` timezone. When doing date arithmetic, use `Date(year, month, day + N)` (which handles month/DST boundaries) rather than millisecond addition.

**The Lesson:** Any "today" or date-string derivation that touches raw `Date`/`toISOString()` is a timezone bug waiting for the evening. Route every date through the CT-aware helpers.

---

### Review Checklist {#section-1c}

- [ ] **No `toISOString()`-derived date strings** — date strings come from `todayCT()` / the CT-aware formatters, not raw `Date` (TIME-1)
- [ ] **Date arithmetic uses calendar fields, not millisecond math** — `Date(y, m, d + N)`, not `+ N * 86_400_000` (TIME-1)

---

# Section 2: Cloudflare Workers Runtime

> **Reader context:** I'm reading secrets/bindings, or relying on a Node or browser API.
>
> The app runs on Cloudflare Workers via OpenNext. The runtime is neither Node nor a browser; `next dev` masks the differences. See testing-pitfalls.md §12.

---

### CF-1: Read Bindings via `getCloudflareContext()`, Never `process.env`

**The Flaw:** Cloudflare Workers don't support `process.env`. Code that reads D1 or secrets through `process.env` returns `undefined` at runtime.

**Why It Matters:** It works in `next dev` (Node) and fails **silently** in production Workers — the worst failure shape. A binding read as `undefined` typically surfaces far downstream as a confusing null/auth error.

**The Fix:** `const { env } = await getCloudflareContext()` from `@opennextjs/cloudflare` for all bindings (D1, secrets, etc.). The cron handler receives `env` directly from the Worker `scheduled()` handler — don't reach for `process.env` there either.

**The Lesson:** On this stack, "works in dev" proves nothing about the runtime. Bindings come from `getCloudflareContext()`; secrets are bindings.

---

### CF-2: Local Secrets Live in `.dev.vars`

Store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `JWT_SECRET` in `.dev.vars` for local dev (already gitignored). This is the local mirror of the deployed secret bindings declared in `env.d.ts` — missing values here produce auth failures that look like code bugs.

---

### CF-3: Never Guess at Cloudflare Platform Behavior — Verify First

Do not assume Workers, D1, Cron Trigger, or Wrangler semantics from memory. Use the Cloudflare documentation MCP (`search_cloudflare_documentation`) to verify platform-specific behavior before making a claim or a design decision. Platform limits and quotas are captured in `docs/research/cloudflare-limits.md`. Guessing here produces designs that pass review and fail in production.

---

### CF-4: Per-Invocation Pacing Cannot Bound a Per-IP Rate Limit

**The Flaw:** Throttling an external API with an *in-process* delay (a `sleep()` between calls, a per-invocation counter) when that API enforces its limit **per egress IP** — a resource shared across *every concurrent Worker invocation*. This project's cron uses 5 staggered Cron Trigger schedules (`wrangler.jsonc`) that fire 1 minute apart and each run longer than a minute, so 2–5 invocations overlap. Their request streams **sum at the shared Cloudflare egress IP**, so each invocation's local pacing is multiplied by the number of overlapping invocations. An adapter that paginates (N HTTP requests per logical "poll") compounds it: a per-poll sleep does not space the within-poll burst at all.

**Why It Matters:** The limiter (per-IP, global) and the throttle (per-invocation, local) are scoped to **different things**, so the throttle silently fails to bound the real rate. It is invisible in any single-invocation test and in `next dev` (one invocation). Chronogolf 429s persisted through two rounds of `sleepAfterPoll` tuning (1500ms → 2500ms) for exactly this reason — ~35 courses spread across 5 overlapping batches, each pacing itself but collectively far over Chronogolf's ~1 req/sec per-IP ceiling.

**The Fix:** Bound the rate at the scope the limit is enforced. Two levers, used together: (1) **serialize to one lane** — pin all of the rate-limited platform's work to a single cron batch so only one invocation polls it at a time (`CHRONOGOLF_LANE` in `src/lib/batch.ts`); (2) **space per-request, not per-poll** — enforce the minimum interval before *every* HTTP request including pagination, in the adapter (`CHRONOGOLF_MIN_REQUEST_INTERVAL_MS` + the `throttle()` reservation gate in `src/adapters/chronogolf.ts`). Add a wall-clock deadline (`CHRONOGOLF_LANE_BUDGET_MS` in `src/lib/cron-handler.ts`) so the single lane never runs past its own next cron firing, which would re-introduce the concurrency. Note the corollary: the subrequest-budget weight (`platformWeight`) intentionally under-counts paginated requests — the **wall-clock deadline**, not the subrequest budget, is the binding guard on the lane. If one polite lane genuinely can't keep up, escalate to a shared cross-invocation coordinator (Durable Object) or a second egress IP (the documented Lambda-proxy fallback) — but confirm one lane is insufficient first; IP-rotation is circumvention, not a fix.

**The Lesson:** Match the throttle's scope to the limit's scope. A local delay cannot enforce a global limit; a per-poll sleep cannot enforce a per-request rate. When "we added a sleep and it still rate-limits under load," suspect a scope mismatch — not an insufficient delay. (Full design + volume math: `docs/plans/2026-06-08-chronogolf-rate-limit-pacing-plan.md`.)

---

### Review Checklist {#section-2c}

- [ ] **No `process.env` for bindings/secrets** — uses `getCloudflareContext()` (or `scheduled()`'s `env`) (CF-1)
- [ ] **Local secrets present in `.dev.vars`** for any new secret binding added to `env.d.ts` (CF-2)
- [ ] **Platform-behavior claims verified** against Cloudflare docs / `docs/research/cloudflare-limits.md`, not assumed (CF-3)
- [ ] **Rate-limited external APIs are throttled at the limit's scope** — per-IP limits need single-lane serialization + per-request (not per-poll) spacing across overlapping cron invocations, not an in-process `sleep()` (CF-4)

---

# Section 3: Database & D1

> **Reader context:** I'm writing SQL, changing the schema, or touching the seed script.

---

### DB-1: Never Use `datetime()` in SQL Comparisons — Use `sqliteIsoNow()`

**The Flaw:** SQLite's `datetime()` returns a space-separated timestamp (`2026-03-11 12:00:00`), but JavaScript's `toISOString()` returns a `T`-separated one (`2026-03-11T12:00:00.000Z`). Lexicographic comparison between the two formats is **always wrong** (`' '` is `0x20`, `'T'` is `0x54`).

**Why It Matters:** Freshness checks, cooldowns, and TTL purges silently compare mismatched formats and produce wrong results — data looks fresh when it's stale, or rows that should be purged survive. No error is raised.

**The Fix:** Use `sqliteIsoNow()` from `src/lib/db.ts` — it returns a `strftime()` expression that produces ISO 8601 (`T`-separated) output that compares correctly against JS `toISOString()` values.

**The Lesson:** Any SQL timestamp compared against a JS-produced ISO string must be emitted in the *same* ISO format. Never let `datetime()` meet `toISOString()`.

---

### DB-2: Never Hard-Delete Courses — `CASCADE` Destroys User Data

**The Flaw:** `user_favorites` and `booking_clicks` have `ON DELETE CASCADE` foreign keys to `courses`. A `DELETE FROM courses` silently destroys all associated user data.

**Why It Matters:** This is irreversible user-data loss with no warning — exactly the kind of mistake that looks fine in a dev DB with no users.

**The Fix:** Never hard-delete a course. Set `disabled = 1` (in `courses.json`) for permanent removal, or let `is_active` handle seasonal closure automatically (see COURSE-1).

**The Lesson:** Before deleting any parent row, check what cascades. On this schema, courses are never deleted. (Verification: testing-pitfalls.md §8 "Constraint cascade awareness".)

---

### DB-3: The Seed Script Overwrites D1 on Every Deploy

**The Flaw:** `scripts/seed.ts` runs `INSERT ... ON CONFLICT DO UPDATE` for every course in `courses.json` on every deploy. Any column in the `UPDATE SET` clause is reset to the `courses.json` value.

**Why It Matters:** Manual D1 edits to seeded columns (`disabled`, `display_notes`, `platform_config`) are silently overwritten on the next deploy. Someone "fixes" a course directly in D1, and the fix vanishes at the next merge to main.

**The Fix:** Make changes to seeded columns in `courses.json`, not just in D1. `courses.json` is the source of truth for everything the seed `UPDATE SET` touches.

**The Lesson:** When a deploy step re-asserts state from a checked-in file, that file — not the live DB — is authoritative for those columns.

---

### DB-4: Never Rewrite Cached Rows Unconditionally — Compare First, Skip When Unchanged

**The Flaw:** Caching availability with an unconditional `DELETE + N×INSERT` on every poll — rewriting every row regardless of whether anything changed. `upsertTeeTimes` did exactly this: each poll deleted and re-inserted the full `tee_times` set for a `(course_id, date)`, even when the fetched set was byte-identical to what was already stored.

**Why It Matters:** D1 bills *rows written*, and reads are ~1000× cheaper — so an unconditional rewrite is the most expensive possible shape. Worse, `tee_times` is indexed on `(course_id, date)`, and an index charges **+1 write per row** on top of the base-table write. With 5-minute polling of today/tomorrow across ~74 courses at ~75 rows each, that is ~175M rows written/month → a ~$125/month overage on an app whose data barely changes between polls. The cost is invisible in dev (no volume) and invisible in tests (no billing) — it only shows up on the production invoice.

**The Fix:** **Compare-then-replace.** Before writing, `SELECT` the current rows, build a normalized multiset of both the stored and the freshly-fetched set, and **skip the write entirely when they are equal** (`upsertTeeTimes` returns `false`). Canonicalization MUST be conservative — when in doubt, declare *changed*; a wrongly-equal skip shows users stale availability, the only dangerous direction. So `null` MUST serialize distinctly from `0` and `""` (the canonical key is a `JSON.stringify`'d *ordered array*, never an object — object key-order is unstable). When the set *has* changed, the write MUST stay a single full atomic `db.batch([DELETE, ...INSERT])` over the whole set — **never a partial diff**: a whole-set replace makes a skip decided against a stale concurrent read benign (last-writer-wins, never torn), whereas a partial diff reintroduces the race. A read error in the comparison `SELECT` MUST propagate as an exception — never swallow it into `return false`, which would be a silent skip logged as success while showing stale data.

**The Lesson:** On a metered row-store, "just overwrite it" is the most expensive option — gate every scheduled rewrite on an actual content change. And once writes are change-gated, per-row write time no longer means "last checked": freshness display MUST read `poll_log.polled_at` (last *checked*), not the row's `fetched_at` (which now means last *changed* and would show a false "stale" badge on a stably-polled date). (Verification: testing-pitfalls.md §4 "Delete-then-insert atomicity" and "Table growth bounds" / "Query performance with large tables" cover the atomicity-and-growth side.)

---

### Review Checklist {#section-3c}

- [ ] **No `datetime()` in any comparison against a JS ISO timestamp** — uses `sqliteIsoNow()` (DB-1)
- [ ] **No `DELETE FROM courses`** — uses `disabled = 1` or `is_active` (DB-2)
- [ ] **Seeded-column changes made in `courses.json`**, not just D1 (DB-3)
- [ ] **Cached-row writes are change-gated** — `upsertTeeTimes` reads current rows and skips the DELETE+INSERT when the fetched set is unchanged; the changed path stays one atomic batch (DB-4)

---

# Section 4: Course Catalog & Lifecycle

> **Reader context:** I'm adding a course, or changing how courses are activated/skipped for polling.

---

### COURSE-1: `disabled` and `is_active` Are Independent — Don't Conflate Them

**The Flaw:** Treating the two course flags as interchangeable, or setting `is_active` by hand.

**Why It Matters:** They control polling for different reasons and have different owners:

- **`disabled`** (manual, permanent): set in `courses.json`. Means "the adapter can't work for this course" (bot protection, no API). Cron skips disabled courses entirely (`WHERE disabled = 0`). The UI shows a default amber message, greyed-out date buttons, and no tee-time list; a custom `display_notes` overrides the default message.
- **`is_active`** (automatic, seasonal): managed **entirely by cron, never by humans**. Auto-deactivates after 30 days with no tee times (winter). Auto-reactivates when an hourly probe of today+tomorrow finds tee times (spring). The seed script does **not** touch `is_active` for existing courses.

**The Fix:** Use `disabled` for permanent/manual exclusion via `courses.json`; leave `is_active` to the cron lifecycle. Never hand-set `is_active`.

**The Lesson:** "Why isn't this course polling?" has two independent answers — check both flags and remember who owns each.

---

### COURSE-2: New Courses Need Three Data Fields

A new course in `courses.json` needs `latitude`/`longitude` (geocode from the address) and `googlePlaceId` (look up via `scripts/lookup-place-ids.ts`, which requires `GOOGLE_MAPS_API_KEY` in `.dev.vars`). Without these, proximity filtering and Google Maps links break for that course — and the breakage is course-specific, so it slips past a smoke test of other courses.

---

### COURSE-3: A Misconfigured Course Fails as Silent `no_data`, Not `error` — Verify Platform Against the Live Site

**The Flaw:** Reading a course that polls `no_data` (poll succeeded, zero tee times parsed) as "empty inventory," when it's actually pointed at the wrong booking platform or a stale endpoint.

**Why It Matters:** A wrong-platform course fails **silently as `no_data`, never as `error`** — so it never trips error monitoring or the `/check-logs` error queries. The stale endpoint (e.g. a CPS `*.cps.golf` v4 subdomain after the course migrated to ForeUp) still answers `200` with an empty teesheet. The course shows "no tee times" to users indefinitely: `last_had_tee_times` stays `null`, zero successes across the entire retention window, and nothing *looks* broken. Real example (2026-06-09): all Oak Glen + Gem Lake entries were tagged `cps_golf` but actually book on ForeUp — 0 successes ever, ~2,800 `no_data` rows each. Same class as `831d66e` (Greenhaven was tagged Chronogolf, actually ForeUp).

**The Fix:** When adding **or** auditing a course, verify `platform` + `platformConfig` against the **live booking site** — don't trust the catalog. Detect existing cases with the never-succeeded audit:

```sql
SELECT id, platform FROM courses
WHERE last_had_tee_times IS NULL AND is_active = 1 AND disabled = 0;
```

Any row active for more than a few days with zero successes is a misconfiguration suspect, not a quiet course. Reproduce the adapter's exact API call to confirm the correct endpoint before editing config (ForeUp is fetched directly — no proxy — so it reproduces from any host). The platform flip then propagates to prod through the seed UPSERT, which updates `platform`/`platform_config` (DB-3) — no migration needed for the flip itself.

**The Lesson:** `no_data` that never flips to `success` is a bug signal, not a quiet course. Silence is the most dangerous failure shape — a misconfig that errored would have been caught weeks earlier.

*See Also:* COURSE-4 (orphan rows from splits), DB-3 (seed UPSERT propagates `platform`).

---

### COURSE-4: Splitting or Removing a Course Orphans Its D1 Row — Retire It With a Migration, Never DELETE

**The Flaw:** Splitting a multi-course facility into separate catalog entries (or removing any course from `courses.json`) and assuming the old row disappears from prod D1.

**Why It Matters:** The seed UPSERT (`scripts/seed.ts`) only INSERTs/UPDATEs ids **present in `courses.json`** — it never deactivates or deletes ids that were removed. The pre-split combined row keeps `is_active = 1, disabled = 0` and gets polled forever, usually as silent `no_data` (COURSE-3). Real example: splitting Oak Glen → `oak-glen-championship` + `oak-glen-executive` (commit `6ae31fe`) left an orphan `oak-glen` row (`courseIds "6,7"`); likewise `gem-lake-hills` (`"8,9"`). Both kept polling dead endpoints, invisible to the seed.

**The Fix:** When removing, renaming, or splitting a course, add a migration to retire the old row: `UPDATE courses SET disabled = 1 WHERE id IN (...)`. **Never `DELETE`** — `ON DELETE CASCADE` on `user_favorites`/`booking_clicks` destroys user data (DB-2). The seed cannot do this for you, because the id is already gone from the JSON.

**The Lesson:** Removing a course from `courses.json` is only half the job; the orphaned D1 row needs its own retire migration.

*See Also:* DB-2 (never hard-delete), DB-3 (seed overwrites), COURSE-3 (silent `no_data`).

---

### Review Checklist {#section-4c}

- [ ] **`is_active` not set by hand** in seed/migration/manual edits — cron owns it (COURSE-1)
- [ ] **Permanent exclusion uses `disabled = 1` in `courses.json`** (COURSE-1)
- [ ] **New course has `latitude`, `longitude`, and `googlePlaceId`** populated (COURSE-2)
- [ ] **`platform`/`platformConfig` verified against the live booking site** (not just the catalog); never-succeeded audit clean (COURSE-3)
- [ ] **Removed/renamed/split courses retired via `UPDATE … SET disabled = 1` migration** — never DELETE; the seed won't do it (COURSE-4)

---

# Section 5: Auth & Sessions

> **Reader context:** I'm touching authentication, session cookies, or the OAuth flow.

---

### AUTH-1: Authenticate in Route Handlers via `authenticateRequest()`, Not Middleware

**The Flaw:** Putting auth in Next.js middleware on this stack.

**Why It Matters:** Middleware can't reliably access D1 on OpenNext / Cloudflare Workers, so a middleware-based guard either fails or silently lets requests through.

**The Fix:** Use the `authenticateRequest()` utility inside the route handlers that need protection.

**The Lesson:** On OpenNext/CF, D1-dependent logic belongs in handlers, not middleware. (Verification: testing-pitfalls.md §9 "Auth bypass on API routes".)

---

### AUTH-2: All App Cookies Use the `tct-` Prefix

Every app cookie is namespaced with `tct-`: `tct-session`, `tct-refresh`, `tct-oauth-state`, `tct-oauth-verifier`. New cookies follow the same prefix so they're greppable and don't collide with platform cookies.

---

### Review Checklist {#section-5c}

- [ ] **Protected routes call `authenticateRequest()`** — no D1-dependent auth in middleware (AUTH-1)
- [ ] **New cookies carry the `tct-` prefix** with `Secure` / `HttpOnly` / `SameSite` set (AUTH-2)

---

# Section 6: Deploy & Infrastructure

> **Reader context:** I'm changing CI/CD or the Lambda fetch proxy.

---

### DEPLOY-1: The Lambda Proxy Is Deployed from Source by CI — Never Hotfix It Live

**The Flaw:** Editing the deployed Lambda directly (e.g. `aws lambda update-function-code`).

**Why It Matters:** The deploy workflow (`.github/workflows/deploy.yml`) redeploys the Lambda from `lambda/fetch-proxy/` on every merge to `main`. Any live hotfix is silently overwritten on the next deploy — the fix appears to work, then "regresses" mysteriously.

**The Fix:** Always update `lambda/fetch-proxy/index.py` in the repo and let CI deploy it.

**The Lesson:** When CI deploys an artifact from source on every merge, the repo is the only durable place to change it. No out-of-band edits.

---

### DEPLOY-2: CPS Golf's v5 Reservation API Is Behind a Cloudflare Challenge — the Proxy Must Impersonate a Browser

**The Flaw:** Calling CPS Golf's v5 reservation API (`/onlineres/onlineapi/*`) with a plain HTTP client (Node `fetch`/undici, Python `requests`). Every call returns a 403 "Just a moment..." Cloudflare managed-challenge interstitial (header `cf-mitigated: challenge`), which the adapter would otherwise surface as the misleading `CPS Golf transaction registration failed`.

**Why It Matters:** CPS migrated its v5 facilities (all Minneapolis Parks, St. Paul, Chaska, Highland, Pioneer Creek, Victory Links, and the SD JC Golf test courses) behind Cloudflare Bot Management. The challenge is **fingerprint-gated, not JS-gated**: it inspects the TLS handshake (JA3/JA4) and HTTP/2 frame ordering, not just headers — so spoofing User-Agent/headers does nothing, and the AWS proxy IP is challenged just like a residential one. A real browser TLS fingerprint passes silently. The token endpoint (`/identityapi/*`) is NOT behind the challenge, which is why the break manifests only at the first reservation call (registration). v4 facilities (Edinburgh, Brookview, Gem, Oak Glen) are on a legacy origin (`server: hide`) and are unaffected.

**The Fix:** The fetch proxy (`lambda/fetch-proxy/index.py`) supplies a browser TLS fingerprint via `curl_cffi`, cascading over versionless vendor-diverse aliases (`challenge.py::PROFILES` = `chrome`, `safari`, `firefox`) until one clears, time-bounded by the proxy budget. The CPS adapter classifies the challenge (`cf-mitigated: challenge` or the body signature) and throws a distinct `CPS Golf reservation API blocked by Cloudflare challenge (HTTP 403)` error so it is recognizable in `poll_log`/`check-logs` instead of masquerading as an auth failure.

**Rotation (recurring maintenance):** Cloudflare allowlists *current* browser fingerprints, so a pinned profile ages out — pinned `chrome124`/`chrome131` already get challenged while the versionless `chrome` alias passes. Use versionless aliases; do NOT pin a `chromeNNN`/`safariNN` profile. Two layers handle rotation: (1) the proxy cascades over `chrome`/`safari`/`firefox` so a single de-allowlisted vendor self-heals with no redeploy; (2) the **`CPS profile rotation` workflow** (`.github/workflows/cps-profile-rotation.yml`) live-probes `jcgsc5.cps.golf` daily and, when the pinned `curl_cffi` is challenged and a newer version both live-clears the real challenge **and** cross-vendors for the Lambda, **auto-merges** a bump to `main` + `dev` and triggers a deploy — unattended (Sam's call, 2026-06-08). It leaves an auto-merged PR + a deploy run as the audit record. **Break-glass / fast-track (still valid):** bump `curl_cffi` in `lambda/fetch-proxy/requirements.txt` and redeploy by hand. Full design: `docs/plans/2026-06-08-cps-profile-rotation-design.md`.

**The Lesson:** A 403 carrying `cf-mitigated: challenge` is an anti-bot *fingerprint* block, not an auth or API-contract bug. Header spoofing won't clear it; only a real TLS fingerprint (`curl_cffi impersonate=`) or a solved JS challenge will. Verify with impersonation before concluding a CPS endpoint is unreachable.

---

### DEPLOY-3: A Workflow's `permissions:` Block Doesn't Grant PR Creation — the Repo Governor Must Allow It Too

**The Flaw:** Shipping a workflow that opens a PR via `gh pr create` (or `peter-evans/create-pull-request`, or the GraphQL `createPullRequest`) authenticated with the default `GITHUB_TOKEN`, while the repository setting **"Allow GitHub Actions to create and approve pull requests"** is off.

**Why It Matters:** `GITHUB_TOKEN`'s effective capability is the **intersection** of the workflow's `permissions:` block and the repo/org governor settings — declaring `pull-requests: write` is necessary but not sufficient. With the governor off (API field `can_approve_pull_request_reviews: false`, under Settings → Actions → General → Workflow permissions), the step fails *at runtime* with `GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)` even though the YAML looks complete and CI is green. The CPS rotation (DEPLOY-2) hit exactly this on its first forced run: probe → decide → deployability-gate all passed, then the rotate step died at `gh pr create`, so the unattended self-heal could never open its bump PR. The failure is **silent until a rotation is actually warranted** — the first real Cloudflare fingerprint-aging event, months out — with CPS broken in the interim.

**The Fix:** Enable the governor — `gh api -X PUT repos/<owner>/<repo>/actions/permissions/workflow -F can_approve_pull_request_reviews=true -f default_workflow_permissions=read` (or the UI toggle), or switch the step to a PAT. On this repo the security delta is negligible: there is no branch protection and Actions already merges to `main` and deploys via `GITHUB_TOKEN`, so "create a PR" is strictly less powerful than what it already does. Live-verified after the flip: the rotation opened + merged its bump PR and dispatched a successful `workflow_dispatch` deploy end to end.

**The Lesson:** `GITHUB_TOKEN` capability = intersection(workflow `permissions:`, repo/org governor). Any Actions step that creates or approves a PR needs the repo "Allow GitHub Actions to create and approve pull requests" governor on (or a PAT) — the `permissions:` block alone won't do it. And prove unattended-automation paths by *forcing the path end to end*; a green YAML and green CI don't exercise the create-PR/dispatch legs.

---

### Review Checklist {#section-6c}

- [ ] **Lambda changes made in `lambda/fetch-proxy/index.py`**, not via the AWS console/CLI on the live function (DEPLOY-1)
- [ ] **CPS v5 reservation calls go through the impersonating fetch proxy**; a 403 with `cf-mitigated: challenge` means the impersonation profile needs rotation (bump `curl_cffi`, redeploy), not an auth fix (DEPLOY-2)
- [ ] **Workflows that open a PR via `gh pr create`/`GITHUB_TOKEN` require the repo "Allow GitHub Actions to create and approve pull requests" governor** (`can_approve_pull_request_reviews=true`) — the workflow `permissions:` block alone is insufficient (DEPLOY-3)

---

## Orchestration

Pitfalls that arise when a session dispatches parallel subagents and consolidates their output. The canonical rules live in `docs/git-strategy.md` → §Multi-agent coordination → Output persistence. This section is the discovery hook for plan writers who arrive here via the `writing-plans-enhanced` (or equivalent) mandated-read path — it does NOT restate the rules in full.

### ORCH-1: Analysis Dispatches Must Persist Findings Before Returning

**Trigger:** Your plan dispatches parallel subagents (bug hunts, audits, phased analysis, parallel investigations) whose findings would be expensive to regenerate if lost.

**What you need to do:** Every such dispatched subagent MUST write its complete report to a persistent file BEFORE returning; the response message is not the sole record.

**Read the full rule:** `docs/git-strategy.md` → §Multi-agent coordination → Output persistence. That section carries the copy-pasteable prompt block (with `<PERSISTENCE_PATH>` substitution), file-path conventions, orchestrator commit cadence, and the cases where the rule doesn't apply.

**Why this is in implementation-pitfalls:** because the plan-writing skill mandates reading this file, and this rule has to be noticed at plan-write time (when the dispatch prompts are being drafted), not at execution time (when it's too late). The failure mode — orchestrator context compacting mid-consolidation and lossily dropping findings — is predictable and preventable if the plan author builds persistence into the dispatch prompts from the start.

### Review Checklist {#orchestrationc}

- [ ] **Dispatch prompts include the mandatory-persistence block** — copy from `docs/git-strategy.md` §Output persistence; substitute `<PERSISTENCE_PATH>` with a durable per-subagent path (ORCH-1)
- [ ] **Plan specifies exact persistence paths, not "write somewhere useful"** — ambiguous paths default to `/tmp` under pressure, which doesn't survive (ORCH-1)
- [ ] **Orchestrator commits subagent artifacts wave-by-wave** — committed files land on the campaign branch before consolidation begins (ORCH-1)

---

# Appendix A: Historical Changelog

## 2026-06-09 — COURSE-3 & COURSE-4 added (silent `no_data` misconfig + orphan rows)

- Added **COURSE-3** (a misconfigured course fails as silent `no_data`, never `error`; verify `platform`/`platformConfig` against the live booking site and audit with the never-succeeded query) and **COURSE-4** (splitting/removing a course orphans its pre-split D1 row because the seed UPSERT only touches ids present in `courses.json`; retire via `UPDATE … SET disabled=1`, never DELETE) to Course Catalog & Lifecycle. Surfaced during a `/check-logs` deep-dive: Oak Glen + Gem Lake (4 schedules) were tagged `cps_golf` but actually book on ForeUp (live-reproduced: `22986/12514`, `22986/12527`, `22985/12529`, `22985/12528`), and the facility split left orphan `oak-glen` + `gem-lake-hills` rows still polling. TOC range, §4.C checklist, and Appendix B updated alongside. Status VALIDATED (mechanism reproduced live; detection query proven). The Oak Glen + Gem Lake catalog remediation itself is tracked separately and in progress at the time of writing.

## 2026-06-09 — DEPLOY-3 added (Actions PR-create governor)

- Added **DEPLOY-3** (a workflow's `permissions:` block doesn't grant PR creation — the repo governor `can_approve_pull_request_reviews` must also be on) to Deploy & Infrastructure, surfaced by the post-merge live verification of the CPS rotation (DEPLOY-2). Forcing a real rotation exposed that the rotate step's `gh pr create` failed with "GitHub Actions is not permitted to create or approve pull requests"; enabling the repo governor fixed it, and the rotation then opened + merged its bump PR and dispatched a successful `workflow_dispatch` deploy end to end (also confirming the recursion-guard exception the deploy-trigger leg relies on). TOC range, §6.C checklist, and Appendix B updated alongside. Status VALIDATED.

## 2026-06-08 — CF-4 added

- Added **CF-4** (per-invocation pacing cannot bound a per-IP rate limit) to the Cloudflare Workers Runtime section, from the Chronogolf HTTP 429 pacing fix (`docs/plans/2026-06-08-chronogolf-rate-limit-pacing-plan.md`). Root cause: `sleepAfterPoll` paced each cron invocation locally, but Chronogolf's ~1 req/sec limit is per egress IP, summed across 5 overlapping staggered batches; the adapter's pagination compounded it. Status VALIDATED — the single-lane + per-request-throttle + wall-clock-deadline fix shipped and is tested in the same PR. TOC range, §2.C checklist, and Appendix B updated alongside.

## 2026-06-08 — DEPLOY-2 added (CPS Cloudflare challenge)

- Added **DEPLOY-2** (CPS's v5 reservation API is behind a fingerprint-gated Cloudflare challenge; the fetch proxy must supply a browser TLS fingerprint via `curl_cffi`) to Deploy & Infrastructure, from the CPS polling-failure fix. Root cause: CPS moved its v5 facilities behind Cloudflare Bot Management, so all ~13 v5 courses failed every poll with the misleading "transaction registration failed". The Lambda proxy was rewritten Node→Python+`curl_cffi` (`impersonate="chrome"`), and the adapter now throws a distinct "blocked by Cloudflare challenge" error as the rotation canary. Also corrected DEPLOY-1's stale `index.mjs` reference to `index.py`. TOC range, §6.C checklist, and Appendix B updated alongside. Status VALIDATED — live-verified (16+ real tee times returned through the proxy).

## 2026-06-08 — DB-4 added

- Added **DB-4** (never rewrite cached rows unconditionally — compare-then-replace) to the Database & D1 section, from the D1 write-amplification fix (`docs/plans/2026-06-07-d1-write-amplification-fix.md`). Root cause: `upsertTeeTimes` ran an unconditional `DELETE + N×INSERT` every poll, driving ~175M D1 rows written/month (~$125 overage). Status VALIDATED — the compare-then-replace fix shipped and is tested in the same PR. TOC range, §3.C checklist, and Appendix B updated alongside.

## 2026-06-07 — Initial population

- Created from the `pitfalls-docs-init` template during the project-docs modernization.
- Migrated the 11 implementation gotchas previously inlined in `CLAUDE.md` into structured domain sections: TIME-1, CF-1/2/3, DB-1/2/3, COURSE-1/2, AUTH-1/2, DEPLOY-1. `CLAUDE.md` now carries a top-5 summary plus a pointer here (single source of truth).
- ORCH-1 (§Orchestration) carried in from the template; forward-reference to `docs/git-strategy.md` now resolves (git-strategy adopted in the same modernization).

---

# Appendix B: Unified Summary Table

| ID | Title | Severity | Status | Domain |
|----|-------|----------|--------|--------|
| TIME-1 | Derive dates from `todayCT()`, never raw `Date` | HIGH | VALIDATED | Time & Timezones |
| CF-1 | Read bindings via `getCloudflareContext()`, not `process.env` | HIGH | VALIDATED | CF Runtime |
| CF-2 | Local secrets in `.dev.vars` | MEDIUM | VALIDATED | CF Runtime |
| CF-3 | Verify CF platform behavior, never guess | MEDIUM | VALIDATED | CF Runtime |
| CF-4 | Per-invocation pacing can't bound a per-IP rate limit | HIGH | VALIDATED | CF Runtime |
| DB-1 | Never `datetime()` in comparisons — use `sqliteIsoNow()` | HIGH | VALIDATED | Database & D1 |
| DB-2 | Never hard-delete courses (`CASCADE` data loss) | CRITICAL | VALIDATED | Database & D1 |
| DB-3 | Seed script overwrites D1 on every deploy | MEDIUM | VALIDATED | Database & D1 |
| DB-4 | Never rewrite cached rows unconditionally — compare-then-replace | MEDIUM | VALIDATED | Database & D1 |
| COURSE-1 | `disabled` vs `is_active` are independent | MEDIUM | VALIDATED | Course Lifecycle |
| COURSE-2 | New courses need lat/lng + `googlePlaceId` | MEDIUM | VALIDATED | Course Lifecycle |
| COURSE-3 | Misconfigured course fails as silent `no_data`, not error — verify platform vs live site | HIGH | VALIDATED | Course Lifecycle |
| COURSE-4 | Splitting/removing a course orphans its D1 row — retire via migration, never DELETE | MEDIUM | VALIDATED | Course Lifecycle |
| AUTH-1 | Authenticate via `authenticateRequest()`, not middleware | HIGH | VALIDATED | Auth & Sessions |
| AUTH-2 | App cookies use `tct-` prefix | LOW | VALIDATED | Auth & Sessions |
| DEPLOY-1 | Lambda proxy deployed from source by CI | MEDIUM | VALIDATED | Deploy & Infra |
| DEPLOY-2 | CPS v5 API behind Cloudflare challenge — proxy must impersonate a browser | HIGH | VALIDATED | Deploy & Infra |
| DEPLOY-3 | Actions can't create PRs unless the repo governor (`can_approve_pull_request_reviews`) allows it | HIGH | VALIDATED | Deploy & Infra |
| ORCH-1 | Analysis dispatches must persist findings | HIGH | VALIDATED | Orchestration |

Severity levels: `CRITICAL` (production data loss / security), `HIGH` (correctness bug under predictable conditions), `MEDIUM` (correctness bug under edge cases), `LOW` (cleanliness / clarity).

Status values: `VALIDATED` (prescribed fix is implemented and tested), `UNIMPLEMENTED` (pitfall documented but fix not yet in code), `SUPERSEDED` (replaced by another entry or no longer applicable).

---

# Appendix C: Document Maintenance Guide

## When to Update This Document

| Trigger | Action |
|---------|--------|
| Bug hunt finds a generalizable pattern | Add a pitfall to the appropriate domain section |
| Health review flags a cross-cutting issue | Add or strengthen a pitfall |
| Implementation reveals a prescribed fix was wrong | Update the existing pitfall to match reality — the code is the source of truth |
| Code review catches a pitfall already documented here | Strengthen the entry with the new example |
| A pitfall's prescribed fix is implemented | Update the entry's status in Appendix B |
| A feature is removed or an approach abandoned | Mark the pitfall as SUPERSEDED with a note explaining why |
| testing-pitfalls.md adds a new section | Check if a cross-reference should be added here |

**Do NOT update this document for:** one-off implementation bugs that don't generalize, style/formatting choices, or performance optimizations without correctness implications.

## How to Add a Pitfall

1. **Choose the domain section.** If it spans two, place it where the reader is most likely to look, and add a "See Also" cross-reference in the other.
2. **Assign the next ID** sequentially within the section (`DB-4`, `AUTH-3`, …). Use the section's short uppercase prefix.
3. **Write the entry.** Full *Flaw → Why → Fix → Lesson* when the reader needs to understand WHY to apply the fix correctly; a single condensed paragraph when a one-line description suffices.
4. **Update the section's Review Checklist** (§X.C) with the corresponding pass/fail check.
5. **Update the Table of Contents** entry range (e.g. `DB-1 – DB-3` → `DB-1 – DB-4`).
6. **Update Appendix B** with the new row (ID, title, severity, status, domain).
7. **Check cross-references:** does testing-pitfalls.md need a matching verification entry? Does the pattern exist elsewhere — grep for other instances?

## Completeness Checklist

**A pitfall update is not complete until ALL of these are done.** Partial updates are how this document drifts — and a drifted document is worse than none, because it creates false confidence.

- [ ] Entry written in the correct domain section with the correct format
- [ ] Entry has the next sequential ID for its section
- [ ] TOC entry range updated
- [ ] Appendix B summary table row added/updated
- [ ] Review checklist (§X.C) updated with the corresponding check item
- [ ] Cross-references checked: testing-pitfalls.md, other domain sections, See Also block
- [ ] If the pattern could exist elsewhere: grepped for other instances
- [ ] Appendix A changelog updated with date and source

## Voice and Style Reference

Pitfall entries use authority and concrete failure modes to ensure they're followed under pressure. Prefer "MUST / Never / Always — without it, Y happens" over "consider X". A pitfall that says "consider using X" will be ignored under pressure; one that says "MUST use X — without it, Y happens every time" will be followed. The full persuasion-principles framework lives in the `superpowers:writing-skills` skill.
