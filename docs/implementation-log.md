# Implementation Log

Running record of substantive implementation work: what was built, key decisions, gotchas discovered, and quality-check results. Newest entries at the top. This is the primary mechanism for preserving context across compacted sessions (see `CLAUDE.md` §Development Workflow).

---

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
