# CPS `curl_cffi` Impersonation-Profile Rotation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the CPS Cloudflare-challenge defense self-heal — an in-proxy multi-vendor profile cascade (instant, no redeploy) plus a scheduled, live-smoke-gated workflow that opens a `curl_cffi` bump PR when the pinned fingerprint ages out.

**Architecture:** Two axes (see `docs/plans/2026-06-08-cps-profile-rotation-design.md`). **Axis 1 (profile selection, no redeploy):** generalize the proxy's `chrome`→`safari17_0` fallback into a time-bounded ordered cascade over the profiles the *installed* `curl_cffi` already ships. **Axis 2 (newer fingerprint, needs redeploy):** a scheduled GitHub Actions workflow runs a self-contained live probe against a real CPS v5 facility (`jcgsc5.cps.golf`); if the pinned `curl_cffi` is challenged **and** the latest version live-clears the real challenge, it opens a human-gated PR bumping `requirements.txt`. A pure-Python challenge classifier is shared (DRY) between the proxy and the probe.

**Tech Stack:** Python 3.14 + `curl_cffi` (Lambda proxy), GitHub Actions (cron + `gh` PR), Python stdlib `unittest` (pure-logic tests). No new secrets; no Worker/`src/` changes; no Cloudflare-platform surface added (the existing Worker cron is untouched).

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
| 1 — Shared classifier + proxy cascade (axis 1) | ⬜ Not started | — | — |
| 2 — Live probe script (axis 2 detector/gate) | ⬜ Not started | — | — |
| 3 — Scheduled rotation workflow (axis 2) | ⬜ Not started | — | — |
| 4 — Docs (runbook, log, statuses) | ⬜ Not started | — | — |

---

## Pitfall & rule reminders (read before any task)

- **DEPLOY-2** (`docs/pitfalls/implementation-pitfalls.md`): CPS v5 is behind a fingerprint-gated Cloudflare challenge; use the **versionless `chrome`** alias, never a pinned `chromeNNN`. A 403 with `cf-mitigated: challenge` is a fingerprint block, not auth.
- **No secrets in logs/CLI flags; no PII.** The probe logs version/profile/status/course-subdomain only — never credentials. The probe needs **no** credentials (the challenge fires pre-auth).
- **Never ship a profile/version not live-verified to clear the real CPS challenge.** The workflow's PR gate is fail-closed: a PR is opened ONLY when the pinned version is `CHALLENGED` AND the candidate version is `CLEARED` by a live probe.
- **Keep the canary** (`src/adapters/cps-golf.ts::isCloudflareChallenge`) and the response contract of the proxy intact.
- **Git:** worktree `.claude/worktrees/cps-profile-rotation`, branch `feat/cps-profile-rotation`, PR targets **`dev`**. Conventional Commits.
- **Reference facts:**
  - CPS v5 reservation base URL: `https://<subdomain>.cps.golf/onlineres/onlineapi/api/v1/onlinereservation` (`src/adapters/cps-golf.ts:37`). The challenge fires on *any* path under it.
  - Test facility: `jcgsc5` (Encinitas Ranch, SD), challenged identically to MN v5 facilities (`docs/research/2026-06-08-cps-cloudflare-challenge.md`).
  - Pinned dep: `lambda/fetch-proxy/requirements.txt` → `curl_cffi==0.15.0`.
  - Deploy bundles the whole `lambda/fetch-proxy/` dir (`.github/workflows/deploy.yml` `code-artifacts-dir`), so any `.py` added there ships with the Lambda (inert if not imported by `index.handler`).

---

## Phase 1 — Shared challenge classifier + proxy multi-vendor cascade (axis 1)

**Execution Status:** ⬜ NOT STARTED

Extract the challenge-detection + outcome-classification logic into a pure module with **zero `curl_cffi` import** (so it is unit-testable anywhere, including Windows local), then (a) have `index.py` consume it and (b) generalize the single fallback into a time-bounded ordered cascade.

> Why a shared module: `index.py` (the proxy) and `probe.py` (Phase 2) both need identical challenge detection. DRY — one classifier, one set of tests, no drift between proxy and probe.

### Task 1.1 — Pure challenge classifier module (test-first)

**Files:**
- Create: `lambda/fetch-proxy/challenge.py`
- Create (test): `lambda/fetch-proxy/test_challenge.py`

**BEFORE starting work:**
1. Invoke `superpowers:test-driven-development`.
2. Read `docs/pitfalls/testing-pitfalls.md`.
Follow TDD: write failing test → implement → verify green.

**Step 1: Write the failing test** — `lambda/fetch-proxy/test_challenge.py`:

```python
# ABOUTME: Unit tests for the pure CPS Cloudflare-challenge classifier (no network, no curl_cffi).
# ABOUTME: Mirrors the detection contract in src/adapters/cps-golf.ts::isCloudflareChallenge.
import unittest

from challenge import PROFILES, Outcome, classify, is_cf_challenge


class IsCfChallenge(unittest.TestCase):
    def test_cf_mitigated_header_is_challenge(self):
        self.assertTrue(is_cf_challenge(403, {"cf-mitigated": "challenge"}, ""))

    def test_cf_mitigated_header_case_insensitive(self):
        self.assertTrue(is_cf_challenge(403, {"cf-mitigated": "CHALLENGE"}, ""))

    def test_403_with_just_a_moment_body(self):
        self.assertTrue(is_cf_challenge(403, {}, "<title>Just a moment...</title>"))

    def test_403_with_challenge_platform_marker(self):
        self.assertTrue(is_cf_challenge(403, {}, "x /cdn-cgi/challenge-platform y"))

    def test_origin_403_without_markers_is_not_challenge(self):
        # A genuine origin 403 (no cf markers) must NOT be misread as a challenge.
        self.assertFalse(is_cf_challenge(403, {}, '{"error":"forbidden"}'))

    def test_200_is_not_challenge(self):
        self.assertFalse(is_cf_challenge(200, {}, "ok"))

    def test_401_is_not_challenge(self):
        self.assertFalse(is_cf_challenge(401, {}, "unauthorized"))


class Classify(unittest.TestCase):
    def test_cleared_on_origin_200(self):
        self.assertEqual(classify(200, {}, "ok"), Outcome.CLEARED)

    def test_cleared_on_origin_401(self):
        # Reached the origin (no fingerprint problem) — fingerprint is accepted.
        self.assertEqual(classify(401, {}, "unauthorized"), Outcome.CLEARED)

    def test_challenged_on_cf_interstitial(self):
        self.assertEqual(
            classify(403, {"cf-mitigated": "challenge"}, "Just a moment..."),
            Outcome.CHALLENGED,
        )

    def test_error_outcome_is_distinct(self):
        # Network/transport failures are represented as ERROR, never CLEARED/CHALLENGED.
        self.assertEqual(Outcome.ERROR, "ERROR")
        self.assertNotEqual(Outcome.ERROR, Outcome.CLEARED)


class Profiles(unittest.TestCase):
    def test_chrome_alias_is_first_and_versionless(self):
        # DEPLOY-2: the versionless "chrome" alias must lead; never a pinned chromeNNN.
        self.assertEqual(PROFILES[0], "chrome")
        for p in PROFILES:
            self.assertNotRegex(p, r"chrome\d", "no pinned chromeNNN profile (DEPLOY-2)")

    def test_profiles_are_unique_and_nonempty(self):
        self.assertTrue(len(PROFILES) >= 2)
        self.assertEqual(len(PROFILES), len(set(PROFILES)))


if __name__ == "__main__":
    unittest.main()
```

**Step 2: Run test to verify it fails**

Run: `cd lambda/fetch-proxy && python -m unittest test_challenge -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'challenge'`.

**Step 3: Write minimal implementation** — `lambda/fetch-proxy/challenge.py`:

```python
# ABOUTME: Pure CPS Cloudflare-challenge classifier shared by the proxy and the rotation probe.
# ABOUTME: No network and no curl_cffi import, so it is unit-testable anywhere.

# Ordered impersonation profiles tried in cascade. The versionless "chrome"
# alias leads (DEPLOY-2: never pin a chromeNNN — pinned profiles age out of
# Cloudflare's allowlist). Vendor diversity gives a single de-allowlisted JA3 a
# chance of another installed fingerprint still clearing. Every entry MUST be a
# profile the vendored curl_cffi build actually supports — verify before adding
# (Task 1.3 / Phase 2 live check); an unsupported profile raises at request time.
PROFILES = ("chrome", "safari17_0")


class Outcome:
    """Three-way result of a challenge probe. ERROR is inconclusive and MUST
    NOT drive a rotation (a transient CPS outage is not an aged-out profile)."""
    CLEARED = "CLEARED"      # reached the CPS origin — fingerprint accepted
    CHALLENGED = "CHALLENGED"  # Cloudflare managed-challenge interstitial
    ERROR = "ERROR"          # network/transport failure — inconclusive


def is_cf_challenge(status, headers, body):
    """Mirror of src/adapters/cps-golf.ts::isCloudflareChallenge and
    index.py::_is_cf_challenge. `headers` keys are matched case-insensitively."""
    mitigated = ""
    for k, v in (headers or {}).items():
        if str(k).lower() == "cf-mitigated":
            mitigated = str(v).lower()
            break
    if mitigated == "challenge":
        return True
    return status == 403 and any(
        marker in (body or "")
        for marker in ("Just a moment", "challenges.cloudflare.com", "cdn-cgi/challenge-platform", "__cf_chl")
    )


def classify(status, headers, body):
    """Map a completed HTTP response to CLEARED or CHALLENGED. Transport
    failures never reach here — the caller maps exceptions to Outcome.ERROR."""
    return Outcome.CHALLENGED if is_cf_challenge(status, headers, body) else Outcome.CLEARED
```

**Step 4: Run test to verify it passes**

Run: `cd lambda/fetch-proxy && python -m unittest test_challenge -v`
Expected: PASS (all cases).

**Step 5: Commit**

```bash
git add lambda/fetch-proxy/challenge.py lambda/fetch-proxy/test_challenge.py
git commit -m "feat(proxy): add shared CPS Cloudflare-challenge classifier"
```

**BEFORE marking this task complete:**
1. Review tests against `docs/pitfalls/testing-pitfalls.md` (error paths covered: origin-403-not-challenge, ERROR distinctness).
2. Confirm green.

### Task 1.2 — Consume the classifier and generalize the cascade in `index.py`

**Files:**
- Modify: `lambda/fetch-proxy/index.py` (replace the inline `_is_cf_challenge`, `PRIMARY_PROFILE`/`FALLBACK_PROFILE`, and the single-fallback block in `handler`).

**Step 1: Replace the profile constants + inline detector with the shared module.**

Remove the inline `_is_cf_challenge` (lines ~50–58) and the `PRIMARY_PROFILE`/`FALLBACK_PROFILE` constants (~33–34). Add at the top with the other imports:

```python
from challenge import PROFILES, is_cf_challenge
```

Keep `UPSTREAM_TIMEOUT` and `TOTAL_BUDGET`. Keep the comment block above the (now-removed) constants' intent by moving the rationale onto `PROFILES` in `challenge.py` (already done in Task 1.1).

**Step 2: Replace the handler's primary+single-fallback block with a time-bounded cascade.**

Current (`index.py` ~110–125):

```python
        start = time.monotonic()
        resp = _request(PRIMARY_PROFILE, url, method, headers, body)
        resp_headers = _response_headers(resp.headers)

        if _is_cf_challenge(resp.status_code, resp_headers, resp.text):
            remaining = TOTAL_BUDGET - (time.monotonic() - start)
            if remaining >= 2:
                resp = _request(
                    FALLBACK_PROFILE, url, method, headers, body,
                    timeout=min(UPSTREAM_TIMEOUT, remaining),
                )
                resp_headers = _response_headers(resp.headers)
```

Desired:

```python
        # Cascade over installed impersonation profiles: stop at the first that
        # is NOT challenged (a cleared origin response — including non-2xx origin
        # errors, which no fingerprint change would fix). If every profile is
        # challenged the trusted fingerprints have all aged out; return the last
        # (challenged) response so the adapter's canary surfaces it. Bounded by
        # TOTAL_BUDGET so a fully-challenged cascade fails fast under the Worker's
        # 12s abort / Lambda 15s ceiling rather than serially burning the budget.
        start = time.monotonic()
        resp = _request(PROFILES[0], url, method, headers, body)
        resp_headers = _response_headers(resp.headers)
        for profile in PROFILES[1:]:
            if not is_cf_challenge(resp.status_code, resp_headers, resp.text):
                break
            remaining = TOTAL_BUDGET - (time.monotonic() - start)
            if remaining < 2:
                break
            resp = _request(
                profile, url, method, headers, body,
                timeout=min(UPSTREAM_TIMEOUT, remaining),
            )
            resp_headers = _response_headers(resp.headers)
```

**Step 3: Verify the response contract is unchanged.** The `return {"status": ..., "headers": resp_headers, "body": resp.text}` block and `proxyError` path stay exactly as-is.

**Step 4: Live-verify the proxy logic locally (if `curl_cffi` installs on this machine) OR defer to Phase 2 probe.** Minimum: confirm `python -c "import index"` succeeds with `curl_cffi` present (no syntax/import errors) and `python -m unittest test_challenge` still passes. Full live verification of the cascade against `jcgsc5` happens via the Phase 2 probe.

> NOTE: `index.py` imports `curl_cffi` at module top, so `import index` requires `curl_cffi` installed. The classifier test (`test_challenge.py`) does NOT import `index` and runs without `curl_cffi`.

**Step 5: Commit**

```bash
git add lambda/fetch-proxy/index.py
git commit -m "feat(proxy): cascade over installed impersonation profiles"
```

**BEFORE marking this task complete:**
1. Confirm the healthy path still issues exactly ONE upstream request (first profile clears → loop body never entered).
2. Confirm `is_cf_challenge` / response-contract behavior matches the old inline version (the classifier test covers detection; eyeball the contract).
3. Confirm DEPLOY-2: `PROFILES[0] == "chrome"` (versionless).

### Task 1.3 — Verify profile validity against the pinned `curl_cffi`

**Files:** none (verification only; may update `PROFILES` in `challenge.py` if a candidate is invalid).

This depends on Phase 2's probe existing for a clean live check, so it is completed during Phase 2 (see Task 2.3). Placeholder here to keep the axis-1 story complete: the final `PROFILES` list MUST contain only profiles `curl_cffi==0.15.0` supports (an unsupported profile raises at request time and would break the cascade). Seed = `("chrome", "safari17_0")` (both already used by the shipped proxy, so known-valid). Additional vendor-diverse profiles are added ONLY after Task 2.3 confirms they are valid in 0.15.0.

**After completing Phase 1 (Tasks 1.1–1.2):**
Review the batch from multiple perspectives. Minimum 3 review rounds. Probe: does the cascade ever exceed the time budget? Does a non-challenge non-2xx origin response correctly stop the cascade? Is the healthy path still single-request? Did detection semantics drift from the TS canary?

---

## Phase 2 — Live probe script (axis 2 detector + gate)

**Execution Status:** ⬜ NOT STARTED

A self-contained CLI that, for a given `curl_cffi` (whatever is installed in the environment) and facility, probes the real CPS challenge endpoint with each cascade profile and emits a machine-readable verdict. Used by the Phase 3 workflow both to **detect** (is the pinned version challenged?) and to **gate** (does the candidate version clear?).

### Task 2.1 — The probe CLI (live verification is the test)

**Files:**
- Create: `lambda/fetch-proxy/probe.py`

> Located alongside `challenge.py` so it can `from challenge import ...` with no path hacks. It ships with the Lambda bundle but is never invoked by `index.handler` (inert). This is the accepted DRY tradeoff (Phase-1 note).

**Step 1: Implement** — `lambda/fetch-proxy/probe.py`:

```python
# ABOUTME: Live CPS Cloudflare-challenge probe — checks whether the installed curl_cffi
# ABOUTME: clears the real challenge for each impersonation profile. Used by the rotation workflow.
import argparse
import json
import sys

import curl_cffi
from curl_cffi import requests

from challenge import PROFILES, Outcome, classify

# Any path under the reservation API is Cloudflare-challenged pre-auth, so the
# probe needs NO CPS credentials — it only distinguishes "reached origin" from
# "got the interstitial". Mirrors src/adapters/cps-golf.ts:37.
RESERVATION_PATH = "/onlineres/onlineapi/api/v1/onlinereservation/TeeTimes"
PROBE_TIMEOUT = 10


def probe_profile(url, profile):
    try:
        resp = requests.get(url, impersonate=profile, timeout=PROBE_TIMEOUT)
    except Exception as err:  # network/transport/unsupported-profile → inconclusive
        return {"profile": profile, "outcome": Outcome.ERROR, "detail": str(err)}
    headers = {str(k).lower(): v for k, v in resp.headers.items()}
    return {
        "profile": profile,
        "outcome": classify(resp.status_code, headers, resp.text),
        "status": resp.status_code,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Probe CPS for the Cloudflare challenge.")
    parser.add_argument("--subdomain", default="jcgsc5", help="CPS facility subdomain (default: jcgsc5 / Encinitas Ranch SD test course)")
    parser.add_argument("--profiles", default=",".join(PROFILES), help="comma-separated impersonation profiles to try in order")
    args = parser.parse_args(argv)

    url = f"https://{args.subdomain}.cps.golf{RESERVATION_PATH}"
    profiles = [p.strip() for p in args.profiles.split(",") if p.strip()]

    results = [probe_profile(url, p) for p in profiles]
    cleared = next((r for r in results if r["outcome"] == Outcome.CLEARED), None)
    challenged_any = any(r["outcome"] == Outcome.CHALLENGED for r in results)

    if cleared:
        verdict = Outcome.CLEARED
    elif challenged_any:
        verdict = Outcome.CHALLENGED
    else:
        verdict = Outcome.ERROR  # all profiles errored — inconclusive

    out = {
        "curl_cffi_version": curl_cffi.__version__,
        "subdomain": args.subdomain,
        "verdict": verdict,
        "cleared_profile": cleared["profile"] if cleared else None,
        "results": results,
    }
    json.dump(out, sys.stdout)
    sys.stdout.write("\n")
    # Exit code: 0 CLEARED, 1 CHALLENGED, 2 ERROR — lets the workflow branch in shell too.
    return {Outcome.CLEARED: 0, Outcome.CHALLENGED: 1, Outcome.ERROR: 2}[verdict]


if __name__ == "__main__":
    sys.exit(main())
```

**Step 2: Verify it runs (no-network smoke).** Run `cd lambda/fetch-proxy && python probe.py --help` — confirm argparse usage prints (works without network). If `curl_cffi` is not installed locally, this import-fails; that's expected — the live run happens in CI / an environment with `curl_cffi`.

**Step 3: Commit**

```bash
git add lambda/fetch-proxy/probe.py
git commit -m "feat(proxy): add live CPS Cloudflare-challenge probe CLI"
```

### Task 2.2 — Live-verify the probe against the real CPS challenge

**Files:** none (verification).

In an environment with `curl_cffi==0.15.0` installed (CI scratch, a Linux box, or `workflow_dispatch` once Phase 3 exists), run:

```bash
cd lambda/fetch-proxy
pip install curl_cffi==0.15.0
python probe.py --subdomain jcgsc5
```

Expected with the current (non-aged-out) profile: `verdict: "CLEARED"`, `cleared_profile: "chrome"` (exit 0). To confirm the CHALLENGED path is real (not a false-clear), also probe a known-aged-out pinned profile:

```bash
python probe.py --subdomain jcgsc5 --profiles chrome124
```

Expected: `verdict: "CHALLENGED"` (exit 1) — proving the probe actually distinguishes a dead fingerprint from a live one. Record both outputs in the PR description as the live-gate evidence.

> If `curl_cffi` cannot be installed in this session's environment, DEFER live verification to the Phase 3 `workflow_dispatch` run (the workflow installs `curl_cffi` itself) and note it in the PR. Do NOT mark the probe "verified" without real output.

### Task 2.3 — Finalize the cascade profile list (closes Task 1.3)

Using the live probe, enumerate which vendor-diverse profiles `curl_cffi==0.15.0` actually supports (a profile it doesn't support returns `Outcome.ERROR` with an unsupported-profile detail). For each candidate beyond `chrome`/`safari17_0` (e.g. `safari_ios`, a firefox alias if present), run `python probe.py --profiles <candidate>`; include in `PROFILES` ONLY those that do NOT error. Update `challenge.py::PROFILES` and re-run `test_challenge`. Commit any change:

```bash
git add lambda/fetch-proxy/challenge.py
git commit -m "feat(proxy): confirm vendor-diverse cascade profiles for curl_cffi 0.15.0"
```

**After completing Phase 2:**
Review from multiple perspectives. Minimum 3 rounds. Probe: can the probe emit CLEARED on a transient origin error that *looks* cleared but isn't really the CPS origin? Does ERROR correctly absorb network flakiness so the workflow won't open spurious PRs? Is the exit-code contract (0/1/2) consistent with the JSON `verdict`?

---

## Phase 3 — Scheduled rotation workflow (axis 2 automation)

**Execution Status:** ⬜ NOT STARTED

A GitHub Actions workflow that runs the probe on a schedule and, on the fail-closed positive-confirmation path only, opens a human-gated `curl_cffi` bump PR to `dev`.

### Task 3.1 — The workflow file

**Files:**
- Create: `.github/workflows/cps-profile-rotation.yml`

**Step 1: Implement** — `.github/workflows/cps-profile-rotation.yml`:

```yaml
# Detects whether CPS's Cloudflare challenge has aged out the pinned curl_cffi
# fingerprint and, only when a newer curl_cffi LIVE-clears the real challenge,
# opens a human-gated PR bumping requirements.txt. Fail-closed: never proposes a
# version not proven against the real CPS challenge. See
# docs/plans/2026-06-08-cps-profile-rotation-design.md.
name: CPS profile rotation

on:
  schedule:
    - cron: "30 13 * * *" # daily ~07:30 CT; fires rarely (~3-9mo), so daily is ample
  workflow_dispatch:
    inputs:
      force_pr:
        description: "Open a bump PR even if the pinned version still clears (manual rotation)"
        type: boolean
        default: false

permissions:
  contents: write
  pull-requests: write

jobs:
  probe-and-rotate:
    name: Probe CPS challenge & propose curl_cffi bump
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-python@v6
        with:
          python-version: "3.14" # match the Lambda runtime

      - name: Run classifier unit tests
        working-directory: lambda/fetch-proxy
        run: python -m unittest test_challenge -v

      - name: Read pinned curl_cffi version
        id: pinned
        run: |
          PINNED=$(sed -n 's/^curl_cffi==//p' lambda/fetch-proxy/requirements.txt)
          echo "version=$PINNED" >> "$GITHUB_OUTPUT"
          echo "Pinned curl_cffi: $PINNED"

      - name: Probe with pinned curl_cffi
        id: probe_pinned
        working-directory: lambda/fetch-proxy
        run: |
          python -m pip install --quiet "curl_cffi==${{ steps.pinned.outputs.version }}"
          set +e
          python probe.py --subdomain jcgsc5 | tee pinned.json
          echo "exit=$?" >> "$GITHUB_OUTPUT"
          set -e
          echo "verdict=$(python -c 'import json;print(json.load(open("pinned.json"))["verdict"])')" >> "$GITHUB_OUTPUT"

      - name: Healthy — pinned version still clears
        if: steps.probe_pinned.outputs.verdict == 'CLEARED' && !inputs.force_pr
        run: echo "✅ Pinned curl_cffi ${{ steps.pinned.outputs.version }} still clears the CPS challenge. No rotation needed."

      - name: Inconclusive — CPS probe errored
        if: steps.probe_pinned.outputs.verdict == 'ERROR' && !inputs.force_pr
        run: echo "::warning::CPS probe was inconclusive (network/transport). No rotation; will retry next run."

      - name: Probe with latest curl_cffi
        id: probe_latest
        if: steps.probe_pinned.outputs.verdict == 'CHALLENGED' || inputs.force_pr
        working-directory: lambda/fetch-proxy
        run: |
          python -m pip install --quiet --upgrade curl_cffi
          LATEST=$(python -c 'import curl_cffi;print(curl_cffi.__version__)')
          echo "version=$LATEST" >> "$GITHUB_OUTPUT"
          set +e
          python probe.py --subdomain jcgsc5 | tee latest.json
          set -e
          echo "verdict=$(python -c 'import json;print(json.load(open("latest.json"))["verdict"])')" >> "$GITHUB_OUTPUT"

      - name: Terminal — latest curl_cffi also challenged
        if: steps.probe_latest.outputs.verdict == 'CHALLENGED'
        run: |
          echo "::error::Latest curl_cffi (${{ steps.probe_latest.outputs.version }}) is ALSO challenged by CPS. No newer fingerprint available — manual intervention required (wait for curl_cffi upstream to ship a newer profile)."
          exit 1

      - name: Open bump PR (live-gated, fail-closed)
        if: steps.probe_latest.outputs.verdict == 'CLEARED' && steps.probe_latest.outputs.version != steps.pinned.outputs.version
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          LATEST="${{ steps.probe_latest.outputs.version }}"
          BRANCH="chore/cps-curl-cffi-bump-${LATEST}"
          sed -i "s/^curl_cffi==.*/curl_cffi==${LATEST}/" lambda/fetch-proxy/requirements.txt
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git checkout -b "$BRANCH"
          git add lambda/fetch-proxy/requirements.txt
          git commit -m "chore(proxy): bump curl_cffi to ${LATEST} (CPS fingerprint rotation)"
          git push -u origin "$BRANCH"
          gh pr create --base dev --head "$BRANCH" \
            --title "chore(proxy): rotate CPS curl_cffi to ${LATEST}" \
            --body "$(cat <<EOF
          Automated CPS impersonation-profile rotation (DEPLOY-2 runbook).

          The pinned \`curl_cffi==${{ steps.pinned.outputs.version }}\` is now **challenged** by CPS's Cloudflare bot-management, but \`curl_cffi==${LATEST}\` **live-cleared** the real challenge against \`jcgsc5.cps.golf\`.

          **Live-gate evidence (pinned — CHALLENGED):**
          \`\`\`json
          $(cat lambda/fetch-proxy/pinned.json)
          \`\`\`
          **Live-gate evidence (latest — CLEARED):**
          \`\`\`json
          $(cat lambda/fetch-proxy/latest.json)
          \`\`\`

          Merge to \`dev\`, then publish \`dev\` → \`main\` to deploy (deploy re-vendors curl_cffi). Fast-track if CPS polling is actively down. See \`docs/pitfalls/implementation-pitfalls.md\` DEPLOY-2 and \`docs/plans/2026-06-08-cps-profile-rotation-design.md\`.
          EOF
          )"
```

> **Subagent guardrails (do NOT drift):**
> - PR base is **`dev`**, never `main` (CLAUDE.md branch rule).
> - The bump step runs ONLY on `verdict == 'CLEARED' && latest != pinned` — this is the fail-closed gate. Do not loosen the `if:`.
> - No secrets are referenced anywhere; the probe needs none and PR creation uses the built-in `github.token`. Do NOT add CPS/AWS/CF secrets.
> - Use the versionless `chrome` in `PROFILES` (DEPLOY-2). The workflow never pins a `chromeNNN`.
> - `${{ steps.probe_latest.outputs.version }} != ${{ steps.pinned.outputs.version }}` guards the already-newest case (pinned challenged but no newer release) — that falls through to no-op, complementing the "Terminal" branch which handles latest-also-challenged.

**Step 2: Lint the YAML.** Run `npx --yes @action-validator/cli .github/workflows/cps-profile-rotation.yml` if available, else validate via `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/cps-profile-rotation.yml'))"`. Expected: parses clean.

**Step 3: Commit**

```bash
git add .github/workflows/cps-profile-rotation.yml
git commit -m "feat(ci): scheduled CPS curl_cffi profile-rotation workflow"
```

### Task 3.2 — Live-verify the workflow end to end via `workflow_dispatch`

**Files:** none (verification — happens after the PR branch is pushed so the workflow file exists on a ref GitHub can run).

After pushing the branch (or once merged), trigger a manual run and confirm the **healthy path** (pinned still clears → "No rotation needed", green) and, with `force_pr: true`, the **PR-open path** produces a bump PR with the two JSON evidence blocks. If `curl_cffi==0.15.0` currently clears (expected), the natural run is the no-op; `force_pr` exercises the latest-probe + PR-creation path. Record the run URL + outcome in the PR description.

> This is the live verification mandated by the prompt ("smoke-test the chosen mechanism against a real CPS facility"). If it cannot run before merge (workflow not yet on a runnable ref), state so explicitly and run it immediately post-merge, before declaring DONE.

**After completing Phase 3:**
Review from multiple perspectives. Minimum 3 rounds. Probe: can a transient CPS outage (ERROR) ever reach the PR-open step? (It must not.) Does the `if:` chain handle all four verdict combinations (pinned CLEARED / ERROR / CHALLENGED→latest CLEARED / CHALLENGED→latest CHALLENGED / CHALLENGED→latest==pinned)? Could the `gh pr create` heredoc inject shell from the JSON? (The JSON is our own probe output — but confirm no command substitution risk.) Does a bot-`github.token` PR skip downstream CI, and is that acceptable for a deps-only change?

---

## Phase 4 — Documentation

**Execution Status:** ⬜ NOT STARTED

### Task 4.1 — Update the DEPLOY-2 rotation runbook

**Files:**
- Modify: `docs/pitfalls/implementation-pitfalls.md` (the DEPLOY-2 "Rotation (recurring maintenance)" paragraph, ~line 275).

Add a sentence pointing the manual runbook at the automation: the `CPS profile rotation` workflow (`.github/workflows/cps-profile-rotation.yml`) probes daily and opens a live-gated bump PR automatically; the manual "bump `curl_cffi` + redeploy" remains the fallback / fast-track. Do NOT remove the manual instructions (they are the break-glass path). Keep the existing DEPLOY-2 entry's voice.

### Task 4.2 — Update implementation log, design-doc status, and Prompt 5 status

**Files:**
- Modify: `docs/implementation-log.md` (append an entry: what was built, the version-vs-profile axis, the human-gate decision, live-gate evidence).
- Modify: `docs/plans/2026-06-08-cps-profile-rotation-design.md` (flip Status to reflect implementation).
- Modify: `docs/plans/2026-06-08-followup-prompts.md` (Prompt 5 status → implemented / PR open).

**Commit (Phase 4):**

```bash
git add docs/
git commit -m "docs: wire DEPLOY-2 runbook to the rotation automation; log + statuses"
```

**After completing Phase 4:**
Review the docs for the project's cross-reference rule (self-identifying links, no opaque session shorthand) and DEPLOY-2 voice consistency.

---

## Final gate (before PR)

1. `cd lambda/fetch-proxy && python -m unittest test_challenge -v` → green.
2. The probe live-verified against `jcgsc5` (CLEARED on `chrome`, CHALLENGED on `chrome124`) — or an explicit deferral note if `curl_cffi` was uninstallable in-session.
3. The workflow YAML parses and the `if:` verdict-matrix is complete.
4. **Adversarial review (≥3 rounds):** `superpowers:requesting-code-review` + `feature-dev:code-reviewer`. Every round probes: can a blind/unverified profile reach prod? self-heal latency? cascade time-budget? spurious-PR on transient outage? secret/PII leak? Record rounds in the PR description.
5. Open PR to `dev`. Subscribe/watch CI.

## Execution strategy recommendation

**Execute in-session by the context-holding agent (not fresh subagents).** Rationale: the tasks are tightly sequential and coupled (`challenge.py` → `index.py` → `probe.py` → workflow → docs), each touches a distinct file (low conflict, but also low parallelism), and the live-verification + version-vs-profile reasoning benefits from the deep context already loaded this session. Fresh subagents would re-derive the CPS challenge mechanics at cost. Use `feature-dev:code-reviewer` as the independent adversarial reviewer at the review gate.
