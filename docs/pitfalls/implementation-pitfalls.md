# Twin Cities Tee Times — Implementation Pitfalls & Review Findings

> **Purpose:** Document implementation traps, design flaws, and corrected decisions that would cause production failures, security vulnerabilities, or data correctness bugs if shipped. This document is the primary code review reference for the Twin Cities Tee Times codebase.
>
> **Relationship to testing-pitfalls.md:** This document specifies *what* to implement and *why*. `docs/pitfalls/testing-pitfalls.md` specifies *how to verify* those implementations work correctly. They are complementary — cross-references are noted inline.
>
> **Last validated against codebase:** 2026-06-07

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
| 2 | [Cloudflare Workers Runtime](#section-2-cloudflare-workers-runtime) | Bindings, secrets, env access, runtime APIs | CF-1 – CF-3 | §2.C |
| 3 | [Database & D1](#section-3-database--d1) | SQL queries, schema, seeding | DB-1 – DB-3 | §3.C |
| 4 | [Course Catalog & Lifecycle](#section-4-course-catalog--lifecycle) | courses.json, polling flags, onboarding | COURSE-1 – COURSE-2 | §4.C |
| 5 | [Auth & Sessions](#section-5-auth--sessions) | Authentication, cookies, OAuth | AUTH-1 – AUTH-2 | §5.C |
| 6 | [Deploy & Infrastructure](#section-6-deploy--infrastructure) | CI/CD, the Lambda fetch proxy | DEPLOY-1 | §6.C |
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

### Review Checklist {#section-2c}

- [ ] **No `process.env` for bindings/secrets** — uses `getCloudflareContext()` (or `scheduled()`'s `env`) (CF-1)
- [ ] **Local secrets present in `.dev.vars`** for any new secret binding added to `env.d.ts` (CF-2)
- [ ] **Platform-behavior claims verified** against Cloudflare docs / `docs/research/cloudflare-limits.md`, not assumed (CF-3)

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

### Review Checklist {#section-3c}

- [ ] **No `datetime()` in any comparison against a JS ISO timestamp** — uses `sqliteIsoNow()` (DB-1)
- [ ] **No `DELETE FROM courses`** — uses `disabled = 1` or `is_active` (DB-2)
- [ ] **Seeded-column changes made in `courses.json`**, not just D1 (DB-3)

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

### Review Checklist {#section-4c}

- [ ] **`is_active` not set by hand** in seed/migration/manual edits — cron owns it (COURSE-1)
- [ ] **Permanent exclusion uses `disabled = 1` in `courses.json`** (COURSE-1)
- [ ] **New course has `latitude`, `longitude`, and `googlePlaceId`** populated (COURSE-2)

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

**The Fix:** Always update `lambda/fetch-proxy/index.mjs` in the repo and let CI deploy it.

**The Lesson:** When CI deploys an artifact from source on every merge, the repo is the only durable place to change it. No out-of-band edits.

---

### Review Checklist {#section-6c}

- [ ] **Lambda changes made in `lambda/fetch-proxy/index.mjs`**, not via the AWS console/CLI on the live function (DEPLOY-1)

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
| DB-1 | Never `datetime()` in comparisons — use `sqliteIsoNow()` | HIGH | VALIDATED | Database & D1 |
| DB-2 | Never hard-delete courses (`CASCADE` data loss) | CRITICAL | VALIDATED | Database & D1 |
| DB-3 | Seed script overwrites D1 on every deploy | MEDIUM | VALIDATED | Database & D1 |
| COURSE-1 | `disabled` vs `is_active` are independent | MEDIUM | VALIDATED | Course Lifecycle |
| COURSE-2 | New courses need lat/lng + `googlePlaceId` | MEDIUM | VALIDATED | Course Lifecycle |
| AUTH-1 | Authenticate via `authenticateRequest()`, not middleware | HIGH | VALIDATED | Auth & Sessions |
| AUTH-2 | App cookies use `tct-` prefix | LOW | VALIDATED | Auth & Sessions |
| DEPLOY-1 | Lambda proxy deployed from source by CI | MEDIUM | VALIDATED | Deploy & Infra |
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
