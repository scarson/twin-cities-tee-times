# Automating the CPS `curl_cffi` impersonation-profile rotation — design

**Date:** 2026-06-08
**Status:** Design — recommended approach, awaiting implementation (Sam delegated execution of the recommended method).
**Follow-up to:** `docs/research/2026-06-08-cps-cloudflare-challenge.md` (the CPS Cloudflare-challenge fix, PR #125) and `docs/pitfalls/implementation-pitfalls.md` DEPLOY-2.

---

## Problem

CPS Golf's v5 reservation API (`/onlineres/onlineapi/*`) sits behind a Cloudflare managed challenge that is **fingerprint-gated**. The Lambda fetch-proxy (`lambda/fetch-proxy/index.py`) clears it by sending a browser TLS fingerprint via `curl_cffi` (`impersonate="chrome"`, fallback `"safari17_0"`). But Cloudflare allowlists only *current* browser fingerprints, and the vendored `curl_cffi` version is frozen at deploy time. So the fingerprint eventually **ages out** of Cloudflare's allowlist (pinned `chrome124`/`chrome131` already get challenged today; the versionless `chrome` still passes). When it does, **all ~13 v5 CPS courses break every poll** and recovery is a manual runbook: bump `curl_cffi` in `requirements.txt` → redeploy.

This task makes that recovery self-healing / self-updating with a safe gate.

## The conceptual split that drives the whole design

There are **two separable problems**. Conflating them produces a wrong design (this is the named trap in the originating prompt).

| Axis | What it is | Cost to change | Can a DB/config value solve it? |
|------|------------|----------------|---------------------------------|
| **1 — profile *selection*** | Choose among fingerprints the *installed* `curl_cffi` already ships (e.g. `chrome` vs `safari17_0` vs `firefox`). | Runtime config — **no Lambda redeploy.** | Yes. |
| **2 — newer fingerprint** | Obtain a fingerprint *newer* than the installed `curl_cffi` knows. | **Package bump + Lambda redeploy.** | **No** — no config value can conjure a fingerprint the vendored library does not contain. |

A "rolling version pin in the database" only addresses **axis 1**. True future-proofing against Cloudflare advancing past *every* installed profile **requires axis 2** (automated rebuild + redeploy). The proxy's current `chrome`→`safari17_0` fallback is a one-step axis-1 mechanism.

**Critical realism check on axis 1:** the fingerprints in a single `curl_cffi` release are all from roughly the same era. When Chrome's newest-known fingerprint ages out of Cloudflare's allowlist, the *other vendors'* fingerprints in the same release may already be aged out too. So an in-proxy cascade across vendors is **cheap insurance with an uncertain payoff** — it rescues the "Cloudflare de-prioritized one specific JA3 but not the others" case, but it is *not* a substitute for axis 2. Axis 2 is the only durable fix.

## How often does this actually fire? (the cadence question)

Reasoning, since it determines auto-deploy-vs-human-gate:

- **Chrome stable** ships a new major ~every 4 weeks.
- **`curl_cffi`** adds new impersonation targets periodically, lagging Chrome by weeks-to-months (it tracks `curl-impersonate` upstream).
- **Cloudflare's allowlist** tolerates *current* fingerprints and de-allowlists old ones with significant lag. Evidence from our own incident: `chrome124` **and** `chrome131` are both challenged *now*, while the versionless `chrome` (the newest fingerprint `curl_cffi==0.15.0` ships) still passes. That implies Cloudflare's tolerance window is on the order of **several months to ~a year** behind current.

**Estimate:** a frozen `curl_cffi` pin likely survives **~3–9 months** before its newest fingerprint ages out (absent proactive bumps). Forced rotations are **infrequent**. That favors a **monitored auto-PR with a human merge** over unattended auto-deploy of prod infrastructure — the MTTR saved by going unattended is small relative to the risk of auto-mutating the production Lambda without eyes on it.

## Decision: human-gated, not unattended auto-deploy

The originating prompt says to surface this as an explicit decision and not assume. **Chosen: human-gated PR.** The automation *detects + verifies + proposes*; a human *merges*. Rationale: (a) fires only every few months, (b) auto-deploying prod Lambda infra unattended is materially riskier than the low MTTR it buys, (c) the PR is gated on a **live smoke test that already proved the candidate clears the real CPS challenge**, so the merge is one click on a known-good change, and (d) it composes with the project's existing deliberate `dev` → `main` publication gate rather than bypassing it.

> If Sam prefers unattended auto-deploy (lower MTTR at the cost of an unattended prod-infra change), the same pipeline flips by replacing the "open PR" terminal step with a "commit to `main` + the existing deploy" step. The live-smoke gate stays either way — **we never ship a profile/version not live-verified against the real CPS challenge.**

## Recommended approach — a human-gated hybrid (axis 1 + axis 2)

### Component A — extend the proxy fallback into a short, time-bounded multi-vendor cascade (axis 1)

Today `lambda/fetch-proxy/index.py` tries `PRIMARY_PROFILE = "chrome"`, then one `FALLBACK_PROFILE = "safari17_0"`. Generalize to an **ordered list** of current vendor profiles (e.g. `chrome`, `safari17_0`, plus another vendor `curl_cffi==0.15.0` ships, such as `firefox`/`edge` — exact list pinned to what the installed build actually supports). Try each in order until one clears the challenge, **bounded by the existing `TOTAL_BUDGET`** so we never blow the Worker's 12 s abort / Lambda 15 s ceiling. Self-heals a single-vendor de-allowlisting **instantly, with no redeploy**.

- Keeps the existing challenge detector (`_is_cf_challenge`) and the response contract.
- Keeps the versionless `chrome` as the first profile (DEPLOY-2: never pin `chromeNNN`).
- Cost: each *additional* attempt is one extra upstream request, incurred **only when earlier profiles are challenged** (the healthy path still clears on the first try). Time-bounded so a fully-challenged cascade fails fast rather than serially burning the whole budget.

### Component B — scheduled rotation workflow with a live smoke gate (axis 2, the centerpiece)

A new scheduled GitHub Actions workflow (`.github/workflows/cps-profile-rotation.yml`) that runs a **self-contained live probe** and opens a ready-to-merge PR when (and only when) rotation is both needed and verified to work.

**The probe** (`scripts/cps_challenge_probe.py`, Python + `curl_cffi`): given a profile, hit a **real CPS v5 reservation endpoint** for the SD test facility `jcgsc5.cps.golf` (Encinitas Ranch) and classify the outcome into exactly three buckets, mirroring `lambda/fetch-proxy/index.py::_is_cf_challenge` and `src/adapters/cps-golf.ts::isCloudflareChallenge`:

- **CLEARED** — reached the CPS origin (not a Cloudflare interstitial). The fingerprint is accepted. *No CPS credentials needed:* the challenge fires at the Cloudflare edge **before** origin auth, so even an unauthenticated request to `/onlineres/onlineapi/*` returns either the cf interstitial (bad fingerprint) or a genuine origin response (good fingerprint). We distinguish the two, we don't need a 200-with-data.
- **CHALLENGED** — the `cf-mitigated: challenge` / "Just a moment…" interstitial. The fingerprint aged out.
- **ERROR** — network/timeout/5xx. **Inconclusive** — never drives a rotation.

**The workflow logic** (cron, plus `workflow_dispatch` for manual runs):

1. Read the pinned version from `lambda/fetch-proxy/requirements.txt`.
2. Install the **pinned** `curl_cffi`; probe with the primary profile → `PINNED_RESULT`.
3. If `PINNED_RESULT == CLEARED` → **healthy, exit 0** (no rotation; this is the common case).
4. If `PINNED_RESULT == ERROR` → **inconclusive, exit 0 with a warning** (transient CPS downtime must not spawn a spurious PR).
5. If `PINNED_RESULT == CHALLENGED` → install the **latest** `curl_cffi`; probe the cascade profiles → `LATEST_RESULT` + the profile that cleared.
   - `LATEST_RESULT == CLEARED` **and** latest version ≠ pinned → **open a PR** bumping `requirements.txt` to the verified version, branch `chore/cps-curl-cffi-bump-<version>`, PR body carries the probe evidence (which version, which profile, status, timestamp — IDs only, **no secrets/PII**).
   - `LATEST_RESULT == CLEARED` but latest == pinned → already newest; the cascade can't help → **emit a loud warning** (this is the genuinely-manual terminal case: wait for `curl_cffi` upstream to ship a newer fingerprint).
   - `LATEST_RESULT == CHALLENGED` → latest package also challenged → **emit a loud warning** (same terminal case).

**Fail-closed invariants:** a PR is opened **only** on positive confirmation (`CHALLENGED` pinned **and** `CLEARED` latest). Negative/inconclusive states never bump anything. We never propose a version that didn't pass the live gate.

### Component C — keep the canary, update the runbook docs

`src/adapters/cps-golf.ts::isCloudflareChallenge` (the distinct "blocked by Cloudflare challenge" error in `poll_log`) is the production early-warning and stays untouched. Update DEPLOY-2's rotation runbook to point at the automation, and record the design in `docs/implementation-log.md`.

## What this does NOT do (YAGNI / out of scope)

- **A D1-backed "rolling profile pin" (option B from the prompt).** The in-proxy cascade already auto-selects among installed profiles, so a manually-set DB pin adds Worker + D1 plumbing without covering a case the cascade doesn't. *Flagged, not built.* (If we later measure that re-trying an aged-out primary on every poll wastes meaningful upstream budget, a "remember last-known-good profile" optimization — warm-container global, or D1 — becomes worth it. Not now.)
- **Unattended auto-deploy of the Lambda.** Decided against (above); trivially reachable later by swapping the terminal step.
- **Re-solving the root cause** (done in PR #125) or a **headless browser** (the challenge is fingerprint-gated; impersonation suffices).

## Considered and ruled out

- **Trigger off the prod `poll_log` canary instead of a live CI probe.** Reading prod D1 from CI (`wrangler d1 execute --remote`) is possible and reflects true prod state, but (a) it couples the rotation job to prod D1 + the CF API token, and (b) it only tells us we're *broken*, not whether a *candidate fixes it* — we'd still need the live probe to gate the bump. The self-contained live probe is both detector and gate in one job, needs **no secrets**, and additionally verifies the fix. The `poll_log` canary remains the production alarm; wiring it as an *additional* early trigger is a possible future enhancement, not MVP.
- **Pinning a specific `chromeNNN` profile** — violates DEPLOY-2; pinned profiles are exactly what ages out. Use the versionless `chrome`.
- **A managed unblocker API (ScraperAPI/ZenRows)** — already rejected in the root-cause fix (ongoing per-request cost, third party sees our traffic). Out of scope here.

## Open considerations to flag in the PR (not blockers)

- **PR target & MTTR.** Per `CLAUDE.md` the rotation PR targets **`dev`** (never `main`). Deploy happens on push to `main`, so recovery = merge the bump to `dev` → the normal `dev` → `main` publication PR → deploy. For an active outage that is two human steps; the doc will recommend Sam fast-track a rotation PR. (Targeting `main` directly would cut MTTR but needs an explicit exception to the branch rule — not taken.)
- **CI on a bot-opened PR.** PRs opened with the built-in `GITHUB_TOKEN` do not trigger downstream workflow runs (GitHub's recursion guard). The bump is a Python-deps-only change already validated by the live gate, so app CI re-run is low-value; if we want it, store a PAT secret. Documented, MVP uses `GITHUB_TOKEN`.

## Testing & verification

- **TDD applies to any `src/` logic.** The current plan adds **no** `src/` production logic (the proxy is Python, the workflow/probe are CI). If implementation reveals a need for Worker-side profile config, TDD kicks in there.
- **The proxy cascade** (`index.py`) is outside the `src/` TDD mandate but MUST be **live-verified** against a real CPS facility (as PR #125 did via `handler()`).
- **The probe + workflow** MUST be **live-verified**: run the probe against `jcgsc5.cps.golf` and confirm it correctly returns CLEARED for a good fingerprint and CHALLENGED for a known-aged-out pinned profile (`chrome124`), and that the workflow opens a PR only on the positive-confirmation path.
- Verify Cloudflare/Workers platform assumptions (cron, subrequest budget) via the docs MCP — don't guess (CF-1, CF-3).

## Adversarial review plan (≥3 rounds, required)

- **Plan stage:** `plan-review-cycle` on the implementation plan; an independent reviewer attacks the **version-vs-profile distinction** — does the design future-proof against *all* installed profiles aging out (axis 2), or only rotate among them (axis 1)?
- **Implementation stage:** `superpowers:requesting-code-review` + `feature-dev:code-reviewer`.
- Every round MUST probe: can the mechanism ship a **blind/unverified** profile to prod? What is the **self-heal latency**? Does the cascade blow the `proxyFetch`/Lambda time budget? Does the workflow open **spurious PRs** on transient CPS downtime? Does it leak secrets/PII? Is the fail-closed gate actually fail-closed?
