# Automating the CPS `curl_cffi` impersonation-profile rotation — design

**Date:** 2026-06-08
**Status:** Implemented on `feat/cps-profile-rotation` (PR to `dev`) — proxy cascade + live probe + pure decision + scheduled workflow shipped and locally live-verified. The full `workflow_dispatch` end-to-end run is deferred to post-merge-to-`main` (GitHub only dispatches workflows present on the default branch). See `docs/implementation-log.md` (2026-06-08 rotation entry) and `docs/plans/2026-06-08-cps-profile-rotation-plan.md`.
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

Today `lambda/fetch-proxy/index.py` tries `PRIMARY_PROFILE = "chrome"`, then one `FALLBACK_PROFILE = "safari17_0"`. Generalize to an **ordered list** of current vendor profiles (`chrome` first, then vendor-diverse alternates `curl_cffi==0.15.0` actually ships — the exact list is pinned to what the installed build supports, verified empirically). Try each in order until one clears the challenge, **bounded by `TOTAL_BUDGET`** so we never blow the Worker's 12 s abort / Lambda 15 s ceiling.

- Keeps the existing challenge detector (`_is_cf_challenge`) and the response contract.
- Keeps the versionless `chrome` as the first profile (DEPLOY-2: never pin `chromeNNN`).
- Cost: each *additional* attempt is one extra upstream request, incurred **only when earlier profiles are challenged** (the healthy path still clears on the first try). Time-bound the **first** request too, so a stalled upstream can't consume the budget before the cascade even starts.
- **Honest scope (this is the axis-1/axis-2 conflation guarding against itself):** the cascade self-heals **only when a same-release sibling fingerprint is still allowlisted** while the primary is de-allowlisted — and as the realism check above notes, sibling fingerprints from one `curl_cffi` release tend to age out together, so *often it won't help*. It is cheap insurance, **not** a substitute for axis 2. It is also effective only when the challenge returns **fast** (Cloudflare 403s typically do, ~200–500 ms): under a slow/stalled upstream the time budget collapses the cascade to a single attempt. Worker-observed latency also includes Lambda cold start, which is outside the proxy's `time.monotonic()` budget — keep the profile list short.

### Component B — scheduled rotation workflow with a live smoke gate (axis 2, the centerpiece)

A new scheduled GitHub Actions workflow (`.github/workflows/cps-profile-rotation.yml`) that runs a **self-contained live probe** and opens a ready-to-merge PR when (and only when) rotation is both needed and verified to work.

**The probe** (`lambda/fetch-proxy/probe.py`, Python + `curl_cffi`, sharing `challenge.py` with the proxy): given a profile, **POST `RegisterTransactionId`** (the exact first reservation call the adapter makes, and the call the root-cause doc proved clears with `200 body=true` under `impersonate=chrome`) for the SD test facility `jcgsc5.cps.golf`, using the **same `requests.request(method, headers, data, impersonate=…)` call shape and a browser-like header set the proxy sends**, then classify into three buckets that mirror `index.py::is_cf_challenge` and `src/adapters/cps-golf.ts::isCloudflareChallenge`:

- **CLEARED** — reached the CPS origin (not a Cloudflare interstitial). The fingerprint is accepted. *No CPS credentials needed:* the challenge fires at the Cloudflare edge **before** origin auth, so the request returns either the cf interstitial (bad fingerprint) or a genuine origin response (good fingerprint). We distinguish the two; we don't need a 200-with-data.
- **CHALLENGED** — the `cf-mitigated: challenge` / "Just a moment…" interstitial. The fingerprint aged out.
- **ERROR** — network/timeout/transport failure (or an unsupported-profile error). **Inconclusive** — never drives a rotation.

> **Load-bearing assumption that MUST be live-verified before trusting the gate** (review finding): that an *unauthenticated* `RegisterTransactionId` cleanly distinguishes a good fingerprint (non-challenge origin response) from a bad one (cf interstitial), and that the bare-but-browser-like header shape produces the *same* challenge verdict production sees. The implementation plan makes this a hard verification step (probe `chrome` → expect CLEARED; probe known-aged-out `chrome124` → expect CHALLENGED) with the actual response inspected, not assumed. If an unauthenticated probe does not cleanly distinguish, the fallback is to extend the probe through the token + register flow.

**The decision is a pure function, unit-tested over the full matrix** (review finding #3 — a sprawling GitHub Actions `if:` chain left silent holes where CPS was broken but the run went green). `rotate.py::decide(...)` takes the pinned/candidate verdicts + versions and returns a `Decision {action, exit_code, reason, degraded}`; the workflow is a thin actuator. Every combination below is a test case, so "broken-but-green" is impossible by construction.

**The detector probes the *primary* (`chrome`) only;** the candidate probe runs the *full cascade* and reports which profile cleared. Probing chrome-only as the trigger means "the primary aged out" fires a (low-urgency) rotation even while the in-proxy cascade still covers production — which is exactly when you want to refresh, before the fallback ages out too.

**The workflow logic** (cron, plus `workflow_dispatch` with a `dry_run` input and a `force_check` input for manual verification):

1. **Idempotency guard (first):** if an open `chore/cps-curl-cffi-bump-*` PR already exists, **exit 0** ("rotation already proposed: #N") — no daily duplicate-PR churn while a bump awaits merge.
2. Read the pinned version; install **pinned** `curl_cffi`; probe `chrome` → `PINNED_VERDICT`.
3. `decide()` matrix:
   - `PINNED == CLEARED` (and not `force_check`) → **healthy, exit 0** (common case).
   - `PINNED == ERROR` → **inconclusive, exit 0 + warning** (transient CPS downtime must not spawn a spurious PR).
   - `PINNED == CHALLENGED` (or `force_check`) → install **latest** `curl_cffi`; probe the cascade → `LATEST_VERDICT` + `cleared_profile`:
     - `LATEST == CLEARED` **and** latest ≠ pinned → **deployability gate, then open PR** (below). If `cleared_profile != chrome`, the PR body carries a prominent **degraded-rotation** warning (chrome still challenged even on latest; only a fallback clears).
     - `LATEST == CLEARED` **and** latest == pinned → already newest; no newer fingerprint exists → **fail loud, exit 1** (the genuine manual terminal case — wait for `curl_cffi` upstream).
     - `LATEST == CHALLENGED` → newer package doesn't help → **fail loud, exit 1**.
     - `LATEST == ERROR` → couldn't evaluate the fix while the primary is challenged → **fail loud, exit 1** (re-runs next cron; never silently green).
4. **Deployability gate (before any PR):** reproduce the deploy's exact vendoring command (`pip install --target … --platform manylinux2014_x86_64 --implementation cp --python-version 3.14 --only-binary=:all: curl_cffi==<latest>`). If the candidate can't be cross-vendored for the Lambda runtime, **fail the gate** — "clears the challenge on the runner" is not "deployable to the Lambda" (review finding #11).
5. **Open PR:** bump `requirements.txt`, branch `chore/cps-curl-cffi-bump-<version>`, body built into a **file** and passed via `--body-file` (never a shell heredoc that command-substitutes probe output — review finding #1/#9). Evidence = version, cleared profile, verdicts, subdomain — **IDs only, no secrets/PII**. `dry_run` prints the body + intended bump instead of creating the PR (so the PR path is verifiable without a spurious bump — review finding #5).

**Fail-closed invariants:** a PR is opened **only** on positive confirmation — pinned-`chrome` `CHALLENGED` **and** latest `CLEARED` **and** the candidate version is **deployable**. Every other pinned-`CHALLENGED` outcome exits non-zero (loud), never silently green. We never propose a version not live-verified against the real CPS challenge **and** not vendor-deployable.

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
