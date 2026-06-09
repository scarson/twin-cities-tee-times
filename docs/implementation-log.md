# Implementation Log

Running record of substantive implementation work: what was built, key decisions, gotchas discovered, and quality-check results. Newest entries at the top. This is the primary mechanism for preserving context across compacted sessions (see `CLAUDE.md` §Development Workflow).

---

## 2026-06-08 — CPS `curl_cffi` impersonation-profile rotation (self-healing)

**Branch:** `feat/cps-profile-rotation` → PR targets `dev` (Review-class — CI/infra + the proxy critical path; Sam merges). Design + reasoning: `docs/plans/2026-06-08-cps-profile-rotation-design.md`. Plan: `docs/plans/2026-06-08-cps-profile-rotation-plan.md`. Follow-up to the CPS Cloudflare-challenge fix (DEPLOY-2).

### Problem

The CPS fix clears Cloudflare's fingerprint-gated challenge with a vendored `curl_cffi` browser fingerprint, but the pin freezes at deploy time and Cloudflare ages out *current* fingerprints (pinned `chrome124`/`chrome131` already get challenged). When the pinned alias ages out, all ~13 v5 CPS courses break and recovery was a manual "bump `curl_cffi` + redeploy" runbook.

### The version-vs-profile axis (the trap this design had to get right)

- **Axis 1 — profile *selection*** among fingerprints the *installed* `curl_cffi` already ships: pure config, **no redeploy**.
- **Axis 2 — a *newer* fingerprint** than the installed `curl_cffi` knows: **requires a package bump + redeploy**. No config/DB value can conjure it. This is the only axis that truly future-proofs.

A "rolling version pin in the DB" (one option Sam floated) only solves axis 1; it was **not built** (the in-proxy cascade already auto-selects among installed profiles, so a DB pin adds Worker+D1 plumbing for no axis it doesn't already cover).

### What shipped

- **Axis 1 — multi-vendor cascade in the proxy** (`lambda/fetch-proxy/index.py` + shared `challenge.py`). The single `chrome`→`safari17_0` fallback became a time-bounded loop over **versionless** vendor-diverse aliases `PROFILES = ("chrome", "safari", "firefox")`, every attempt (incl. the first) bounded by the remaining `TOTAL_BUDGET`. A single de-allowlisted vendor self-heals instantly, no redeploy. Live-verified against `curl_cffi==0.15.0`/`jcgsc5.cps.golf`: chrome/safari/firefox all clear; edge/chrome_android were challenged and excluded.
- **Axis 2 — scheduled auto-deploy rotation workflow** (`.github/workflows/cps-profile-rotation.yml`). Daily live-probe of `jcgsc5.cps.golf`. When the pinned `curl_cffi` is challenged **and** the latest version both live-clears the real challenge **and** cross-vendors for the Lambda (`manylinux2014/cp314` deployability gate), it **auto-merges** a `requirements.txt` bump to `main` + `dev` (each off its own tip, idempotent, kept in lockstep) and triggers `deploy.yml` on `main` via `workflow_dispatch`. Fail-closed, `concurrency`-guarded, needs **no secrets** (challenge fires pre-auth; PR/merge/dispatch via `github.token` — `workflow_dispatch` is exempt from GitHub's recursion guard, so no PAT). `deploy.yml` gained a `workflow_dispatch` trigger.
- **The decision is a pure, exhaustively unit-tested function** (`rotate.py::decide`, 15 tests over the full pinned×latest×version-equal×profile×force matrix) — so the "CPS-broken-but-CI-green" holes a sprawling workflow `if:`-chain would leave are impossible by construction. Classifier shared with the proxy (`challenge.py`, 14 tests).
- **`proxy-tests` CI job** (`ci.yml`) runs the pure-logic tests on every PR (they were otherwise ungated until the post-merge rotation run).
- **Canary unchanged** (`src/adapters/cps-golf.ts::isCloudflareChallenge`) — still the production early-warning. **No `src/` changes** in this PR.

### Key decisions

- **Unattended auto-deploy (Sam, 2026-06-08), not a human-gated PR.** Initially surfaced as a human-gated PR per the prompt; Sam chose auto-deploy ("I'd merge those 100% of the time… don't want to babysit and have it fail until I click Merge"). Human-gating leaves the very failure it fixes broken until someone acts. The safety kept: merge+deploy happens **only** after the candidate live-clears the real challenge AND is proven vendor-deployable; the auto-merged PR + deploy run are the audit trail. Mechanism shaped by the two-branch gitflow (deploy fires on push to `main`; `GITHUB_TOKEN` pushes don't fire `push` triggers → dispatch `deploy.yml` via `workflow_dispatch`).
- **The probe needs no credentials and POSTs `RegisterTransactionId`** (the adapter's first reservation call, the exact call the root-cause doc proved clears) with browser-like headers, mirroring `index.py`'s `requests.request` shape. **Load-bearing assumption live-verified:** an unauthenticated probe cleanly distinguishes a good fingerprint (`chrome` → origin `400` = CLEARED) from an aged-out one (`chrome124` → `403` cf interstitial = CHALLENGED).
- **"Clears the challenge" ≠ "deployable."** The deployability gate reproduces the deploy's exact cross-vendoring command, so a version that clears on the runner but can't vendor for the Lambda is never proposed.

### Quality checks

29 Python unit tests green (`test_challenge` 14 + `test_rotate` 15). Live-verified locally with `curl_cffi==0.15.0`: probe (chrome CLEARED / chrome124 CHALLENGED), the deployability-gate command (exit 0), and the healthy-path sequence (decide → `none`). Both workflow YAMLs parse. Plan survived a 4-round adversarial `plan-review-cycle` (19 findings) + an independent reviewer.

### Deferred / owed

- **Live `workflow_dispatch` runs deferred to post-merge.** GitHub only dispatches a `workflow_dispatch` workflow present on the **default branch** (`dev` here). After merge to `dev`: trigger the rotation (default inputs = healthy no-op; `force_check:true, dry_run:true` = exercises the auto-rotate path without merging/deploying) and confirm green.
- **Deploy-trigger leg works only after publication to `main`.** `gh workflow run deploy.yml --ref main` needs `deploy.yml`'s `workflow_dispatch` to exist on `main`, which lands when this feature is published `dev`→`main`. Until then a rotation would bump `main` but the dispatch fails loudly (red) → manual deploy. One-time transient during this feature's own rollout.
- **Load-bearing platform assumption to confirm on first real rotation:** that `gh workflow run deploy.yml` (a `workflow_dispatch` from `GITHUB_TOKEN`) actually starts the deploy — it's the documented exception to the recursion guard, but verify on the first live fire.

## 2026-06-08 — D1 write-amplification fix (compare-then-replace)

**Branch:** `fix/d1-write-amplification` → PR targets `dev` (Review-class — Sam merges). Plan: `docs/plans/2026-06-07-d1-write-amplification-fix.md`. Decision rationale and rejected alternatives: `memory/project_d1_bill_write_amplification.md`.

### Problem

`upsertTeeTimes` ran an unconditional `DELETE + N×INSERT` on every poll, rewriting the full `tee_times` set for each `(course_id, date)` even when nothing changed. D1 bills *rows written*; the `(course_id, date)` index charges +1 write/row on top of the base write. At 5-minute polling of today/tomorrow across ~74 courses × ~75 rows, that measured at ~10.07M inserts/week → ~175M rows written/month → a ~$125/month overage on data that barely changes between polls. Reads are ~1000× cheaper and were never a factor.

### What shipped (Phases 1–5)

- **Phase 1 — Compare-then-replace in `upsertTeeTimes` (`src/lib/db.ts`).** Before writing, `SELECT` the current rows, build a conservative canonical multiset of stored vs. freshly-fetched, and skip the write entirely when equal. `upsertTeeTimes` now returns `boolean` (`true` = wrote/changed, `false` = skipped/unchanged). The changed path stays a single atomic `db.batch([DELETE, ...INSERT])` — never a partial diff — so a skip decided against a stale concurrent read is benign (last-writer-wins). A read error in the comparison `SELECT` propagates as an exception (never swallowed into `return false`, which would be a silent stale-data skip logged as success). Canonicalization is conservative: `null` serializes distinctly from `0`/`""` via a `JSON.stringify`'d ordered array; HH:MM normalization is shared by the comparison and the INSERT so a stored value matches its own canonical key.
- **Phase 2 — Measurability: `poll_log.content_changed` (migration `0010_add_poll_content_changed.sql`).** Additive `INTEGER NOT NULL DEFAULT 0` column threaded through `logPoll`/`pollCourse` (trailing optional param, default `false`) so the true set-change rate — including `open_slots`/`price` churn at constant row count — becomes measurable. Telemetry only; never surfaced in any API response.
- **Phase 3 — Freshness migration to `poll_log.polled_at`.** Skipping writes makes per-row `tee_times.fetched_at` mean "last *changed*", so a stably-polled date would show a false `* stale` badge. `/api/tee-times` now returns per-`(course,date)` `polled_at` (windowed LEFT JOIN with a 24h filter to avoid a full `poll_log` scan); the stale badge (`tee-time-list.tsx`) and "Last updated" header (`course-header.tsx`) read poll time, not row write time. `isStale(null)` is treated as stale; the age suffix is null-guarded to avoid the epoch trap.
- **Phase 4 — Past-date `tee_times` prune.** `cleanupPastTeeTimes(db, todayStr)` deletes rows for dates before today (CT), wired into batch-0 cron housekeeping alongside `cleanupOldPolls`, wrapped in try/catch so a failed cleanup never aborts the poll cycle. Clears ~90 dates of accumulated dead rows (the "stale entries" Sam reported). `todayStr` is CT-derived; lexicographic `<` on `YYYY-MM-DD` is correct (no `datetime()`, per DB-1).
- **Phase 5 — Pitfall + verification docs.** Added **DB-4** to `docs/pitfalls/implementation-pitfalls.md` (never rewrite cached rows unconditionally — compare-then-replace) with full Appendix C maintenance (TOC, §3.C checklist, Appendix B VALIDATED row, Appendix A changelog, testing-pitfalls.md §4 cross-ref). This implementation-log entry.

### Key decisions

- **Conservative canonicalization (the one load-bearing rule):** the only dangerous error is a *wrongly-equal* skip → stale availability shown to users. So "when in doubt, declare changed" — `null` never equals `0`/`""`, `NaN`/throw forces "changed". Ordered-array `JSON.stringify`, never an object (object key-order is unstable).
- **Whole-set atomic replace, not a row-level diff.** Rejected in design review (see memory). A partial diff would reintroduce a concurrent-writer race that the full-set replace makes benign.
- **Freshness display belongs on `poll_log.polled_at` (last checked), not per-row write time.** This is the structural consequence of change-gating writes, not a cosmetic tweak — captured in DB-4's Lesson.

### Quality checks

Per-phase: full `npm test` suite + `npx tsc --noEmit` + `npm run lint` green at each phase (suite grew 719 → 737 tests across phases 1–4; only the 3 pre-existing lint warnings remain). Each phase ran a multi-round review gate. Finalization additionally runs the OpenNext production build (`npx @opennextjs/cloudflare build`) because the PR changes API routes and adds a migration.

### Post-deploy success criterion (own this after merge to `main`)

**Target: D1 rows written < 50M/month, confirmed over the week after merge to `main`.** Measure two ways:

1. **Change-rate from `poll_log`:** `SELECT AVG(content_changed) FROM poll_log WHERE status = 'success'` gives the fraction of successful polls that actually wrote. Multiply by the current write volume (rows/poll × polls/month, including the index's +1/row) to project monthly rows written. Pre-fix baseline was ~175M/month at a 100%-write rate; the fix only writes when `content_changed = 1`.
2. **Cloudflare D1 dashboard:** confirm the projected number against actual billed rows-written for the week.

**Revisit trigger (concrete, not open-ended):** *only if* the sustained set-change rate keeps writes above 50M/month does a finer-grained approach (row-level diff) get reconsidered. If writes land under 50M, close this out — do not pursue row-level diffing speculatively (it was rejected in design review for the concurrency-race cost).

## 2026-06-08 — CPS Golf Cloudflare-challenge fix (browser TLS impersonation)

**Branch:** `fix/cps-cloudflare-impersonation` → PR targets `dev` (Review-class — architecture/infra + security-sensitive proxy; Sam merges). Root-cause writeup: `docs/research/2026-06-08-cps-cloudflare-challenge.md`. Pitfall: DEPLOY-2.

### Problem

All ~13 CPS "v5" courses failed every poll with `CPS Golf transaction registration failed` (~42k errors/week, uniform, zero CPS data). Root cause: CPS moved its v5 reservation API (`/onlineres/onlineapi/*`) behind **Cloudflare Bot Management with a managed challenge** (403 "Just a moment…", `cf-mitigated: challenge`). The challenge is **fingerprint-gated, not JS-gated** — a real browser TLS fingerprint (JA3/JA4 + HTTP/2 frame order) passes; Node `fetch`/undici does not, regardless of headers or IP. The token endpoint (`/identityapi/`) is not behind the challenge, so the break surfaces only at the first reservation call. v4 facilities are on a legacy origin and unaffected. The task's SD-vs-MN hypothesis was refuted: SD `jcgsc5` is challenged identically — the split is v4-legacy vs v5-Cloudflare.

### What shipped

- **Proxy rewrite (`lambda/fetch-proxy/index.py`, was `index.mjs`).** Node → Python + `curl_cffi` with `impersonate="chrome"` (fallback `"safari17_0"`, time-bounded under an 11s budget). Review-hardened: apex/subdomain allowlist matching (closed an SSRF hole carried from the Node proxy), transport-header stripping (`host`/`content-length`/`connection`/`accept-encoding`/`transfer-encoding`) to protect the fingerprint, and dropping `content-encoding`/`content-length` from the decompressed response. Response contract (`{status, lowercased headers, body}` / `proxyError`) preserved. Deps vendored at deploy time, not committed (`lambda/fetch-proxy/.gitignore`).
- **Deploy (`.github/workflows/deploy.yml`).** Runtime `nodejs24.x` → `python3.14`, memory 128 → 256 MB, plus a vendoring step cross-targeting manylinux x86_64 cp314 wheels (`curl_cffi` cp310-abi3 + `cffi` cp314; pre-flighted locally with `--only-binary=:all:`, no source builds).
- **Canary (`src/adapters/cps-golf.ts`).** `doFetch` classifies the challenge (`cf-mitigated: challenge` or body signature); token, v5/v4 registration, and TeeTimes throw a distinct `CPS Golf reservation API blocked by Cloudflare challenge (HTTP 403)` error. TDD: 5 new adapter tests.
- **Smoke test (`cps-golf.smoke.test.ts`).** Now accepts real data OR the distinct challenge error and rejects any other error — captures the live contract instead of masking the outage; verified Level 1 passes by detecting the real challenge.
- **Docs.** DEPLOY-2 pitfall (with rotation runbook), `checkV4Upgrades` caveat comment, root-cause research doc, this log entry.

### Key decisions

- **TLS impersonation over header spoofing / API key / headless browser / unblocker service.** The challenge is fingerprint-gated, so a lightweight TLS-impersonating client is sufficient and correct; the alternatives were ruled out (see research doc). Vehicle chosen with Sam: Python 3.14 + `curl_cffi`, versionless `chrome` profile.
- **Maintenance tail accepted explicitly.** Cloudflare allowlists current fingerprints, so the profile ages out (`chrome124`/`chrome131` already challenged). Recovery = bump `curl_cffi`, redeploy; the canary is the early-warning. Not set-and-forget.
- **`checkV4Upgrades` documented, not restructured.** Token-200 doesn't prove the (Cloudflare-fronted) reservation API is reachable; if the profile ages out a promoted course fails with the challenge error. Accepted (small v4 population, gated on CPS migration, canary-visible) rather than risk a prod cron-path change.

### Quality checks

`npm test` (742 passing) + `npx tsc --noEmit` (clean) + `npm run lint` (0 errors; 3 pre-existing warnings) green. Proxy verified live end-to-end through `handler()`: token 200 → register 200 → TeeTimes 200 with 16–17 real tee times; teesnap path and host allowlist unaffected; SSRF host-matching verified (evil variants blocked). Three adversarial review rounds (R1 found SSRF + header + content-encoding issues; R2 found challenge-blind token + unbounded fallback + missing caveat; R3 clean) — all must/should-fix items addressed.

### Open items (own before/at first deploy to `main`)

- **IAM precondition:** the runtime flip makes `aws-lambda-deploy` call `UpdateFunctionConfiguration`. Confirm `AWS_DEPLOY_ROLE_ARN` holds `lambda:UpdateFunctionConfiguration` + `lambda:GetFunctionConfiguration`, else CI is green while the Lambda runs Python under the Node runtime.
- **Post-deploy watch:** confirm the ~13 v5 CPS courses return to `success` in `poll_log`, and watch the D1 write rate (dedup PR #119 absorbs the resumed writes).
