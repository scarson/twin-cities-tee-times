# CPS `curl_cffi` Impersonation-Profile Rotation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the CPS Cloudflare-challenge defense self-heal — an in-proxy multi-vendor profile cascade (instant, no redeploy) plus a scheduled, live-smoke-gated workflow that opens a human-gated `curl_cffi` bump PR when the pinned fingerprint ages out.

**Architecture:** Two axes (see `docs/plans/2026-06-08-cps-profile-rotation-design.md`). **Axis 1 (profile selection, no redeploy):** generalize the proxy's `chrome`→`safari17_0` fallback into a time-bounded ordered cascade over the profiles the *installed* `curl_cffi` already ships. **Axis 2 (newer fingerprint, needs redeploy):** a scheduled GitHub Actions workflow runs a self-contained live probe against a real CPS v5 facility (`jcgsc5.cps.golf`); if the pinned `curl_cffi` is challenged **and** the latest version live-clears the real challenge **and** is vendor-deployable to the Lambda, it opens a human-gated PR bumping `requirements.txt`. The challenge classifier is a pure module shared (DRY) by the proxy and the probe; the rotation **decision** is a pure, exhaustively unit-tested function so the verdict matrix has no silent holes.

**Tech Stack:** Python 3.14 + `curl_cffi` (Lambda proxy + probe), GitHub Actions (cron + `gh` PR), Python stdlib `unittest` (pure-logic tests — no pip deps). No new secrets; no Worker/`src/` changes; no Cloudflare-platform surface added (the existing Worker cron is untouched).

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
| 2 — Live probe (axis 2 boundary) | ⬜ Not started | — | — |
| 3 — Pure decision + rotation workflow (axis 2) | ⬜ Not started | — | — |
| 4 — Docs (runbook, log, statuses) | ⬜ Not started | — | — |

---

## Pitfall & rule reminders (read before any task)

- **DEPLOY-2** (`docs/pitfalls/implementation-pitfalls.md`): CPS v5 is behind a fingerprint-gated Cloudflare challenge; use the **versionless `chrome`** alias, never a pinned `chromeNNN`. A 403 with `cf-mitigated: challenge` is a fingerprint block, not auth.
- **No secrets in logs/CLI flags; no PII.** The probe needs **no** credentials (the challenge fires pre-auth). Logs carry version/profile/verdict/course-subdomain only.
- **Never ship a profile/version not live-verified to clear the real CPS challenge AND vendor-deployable to the Lambda.** The PR gate is fail-closed: open a PR ONLY when pinned-`chrome` is `CHALLENGED`, latest is `CLEARED`, latest ≠ pinned, **and** the candidate cross-vendors for `manylinux2014_x86_64 / cp314`.
- **Keep the canary** (`src/adapters/cps-golf.ts::isCloudflareChallenge`) and the proxy's response contract intact.
- **Git:** worktree `.claude/worktrees/cps-profile-rotation`, branch `feat/cps-profile-rotation`, PR targets **`dev`**. Conventional Commits.
- **Reference facts:**
  - CPS v5 reservation base URL: `https://<subdomain>.cps.golf/onlineres/onlineapi/api/v1/onlinereservation` (`src/adapters/cps-golf.ts:37`); the adapter's first reservation call is `POST {base}/RegisterTransactionId` with body `{"transactionId": "<uuid>"}` and header `x-requestid` (`cps-golf.ts:163-171`). The challenge fires on *any* path under the reservation base, pre-auth.
  - Test facility: `jcgsc5` (Encinitas Ranch, SD), challenged identically to MN v5 facilities (`docs/research/2026-06-08-cps-cloudflare-challenge.md`).
  - Pinned dep: `lambda/fetch-proxy/requirements.txt` → `curl_cffi==0.15.0`.
  - Deploy vendoring (must be reproduced by the deployability gate): `.github/workflows/deploy.yml:62-70` → `pip install --target lambda/fetch-proxy --requirement … --platform manylinux2014_x86_64 --implementation cp --python-version 3.14 --only-binary=:all:`.
  - Deploy bundles the whole `lambda/fetch-proxy/` dir (`code-artifacts-dir`), so any `.py` added there ships with the Lambda (inert if not imported by `index.handler`).
  - Time budget: `index.py` `UPSTREAM_TIMEOUT=10`, `TOTAL_BUDGET=11`; the Worker aborts at 12 s (`src/lib/proxy-fetch.ts:48`); Lambda ceiling 15 s.

---

## Phase 1 — Shared challenge classifier + proxy multi-vendor cascade (axis 1)

**Execution Status:** ⬜ NOT STARTED

Extract challenge detection into a pure module (**zero `curl_cffi` import**, so it is unit-testable anywhere including Windows local), then (a) have `index.py` consume it and (b) generalize the single fallback into a time-bounded ordered cascade.

> Why a shared module: `index.py` (proxy) and `probe.py` (Phase 2) both need identical challenge detection. DRY — one classifier, one set of tests, no drift.

### Task 1.1 — Pure challenge classifier module (test-first)

**Files:**
- Create: `lambda/fetch-proxy/challenge.py`
- Create (test): `lambda/fetch-proxy/test_challenge.py`

**BEFORE starting work:** Invoke `superpowers:test-driven-development`; read `docs/pitfalls/testing-pitfalls.md`. Write failing test → implement → verify green.

**Step 1: Write the failing test** — `lambda/fetch-proxy/test_challenge.py`:

```python
# ABOUTME: Unit tests for the pure CPS Cloudflare-challenge classifier (no network, no curl_cffi).
# ABOUTME: Mirrors the detection contract in src/adapters/cps-golf.ts::isCloudflareChallenge.
import unittest

from challenge import PROFILES, Outcome, classify, is_cf_challenge


class IsCfChallenge(unittest.TestCase):
    def test_cf_mitigated_header_is_challenge(self):
        self.assertTrue(is_cf_challenge(403, {"cf-mitigated": "challenge"}, ""))

    def test_cf_mitigated_header_case_insensitive_key_and_value(self):
        self.assertTrue(is_cf_challenge(403, {"CF-Mitigated": "CHALLENGE"}, ""))

    def test_403_with_just_a_moment_body(self):
        self.assertTrue(is_cf_challenge(403, {}, "<title>Just a moment...</title>"))

    def test_403_with_challenge_platform_marker(self):
        self.assertTrue(is_cf_challenge(403, {}, "x /cdn-cgi/challenge-platform y"))

    def test_origin_403_without_markers_is_not_challenge(self):
        self.assertFalse(is_cf_challenge(403, {}, '{"error":"forbidden"}'))

    def test_200_is_not_challenge(self):
        self.assertFalse(is_cf_challenge(200, {}, "ok"))

    def test_401_is_not_challenge(self):
        self.assertFalse(is_cf_challenge(401, {}, "unauthorized"))


class Classify(unittest.TestCase):
    def test_cleared_on_origin_200(self):
        self.assertEqual(classify(200, {}, "ok"), Outcome.CLEARED)

    def test_cleared_on_origin_401(self):
        self.assertEqual(classify(401, {}, "unauthorized"), Outcome.CLEARED)

    def test_challenged_on_cf_interstitial(self):
        self.assertEqual(
            classify(403, {"cf-mitigated": "challenge"}, "Just a moment..."),
            Outcome.CHALLENGED,
        )

    def test_error_is_a_distinct_sentinel(self):
        self.assertNotEqual(Outcome.ERROR, Outcome.CLEARED)
        self.assertNotEqual(Outcome.ERROR, Outcome.CHALLENGED)


class Profiles(unittest.TestCase):
    def test_chrome_alias_is_first(self):
        self.assertEqual(PROFILES[0], "chrome")

    def test_no_pinned_chrome_version(self):
        # DEPLOY-2: the primary must be the versionless alias, never chromeNNN.
        for p in PROFILES:
            self.assertNotRegex(p, r"^chrome\d", "no pinned chromeNNN profile (DEPLOY-2)")

    def test_profiles_unique_and_at_least_two(self):
        self.assertGreaterEqual(len(PROFILES), 2)
        self.assertEqual(len(PROFILES), len(set(PROFILES)))


if __name__ == "__main__":
    unittest.main()
```

**Step 2: Run to verify it fails** — `cd lambda/fetch-proxy && python -m unittest test_challenge -v` → FAIL (`No module named 'challenge'`).

**Step 3: Implement** — `lambda/fetch-proxy/challenge.py`:

```python
# ABOUTME: Pure CPS Cloudflare-challenge classifier shared by the proxy and the rotation probe.
# ABOUTME: No network and no curl_cffi import, so it is unit-testable anywhere.

# Ordered impersonation profiles tried in cascade. The versionless "chrome"
# alias leads (DEPLOY-2: never pin a chromeNNN — pinned profiles age out of
# Cloudflare's allowlist). Subsequent entries give a de-allowlisted primary a
# chance of another installed fingerprint still clearing, though same-release
# siblings tend to age out together (so this is cheap insurance, not a fix —
# see the design doc). Every entry MUST be a profile the vendored curl_cffi
# build supports; an unsupported profile raises at request time. The exact list
# is confirmed empirically in Task 2.3.
PROFILES = ("chrome", "safari17_0")


class Outcome:
    """Three-way probe result. ERROR is inconclusive and MUST NOT drive a
    rotation (a transient CPS outage is not an aged-out fingerprint)."""
    CLEARED = "CLEARED"        # reached the CPS origin — fingerprint accepted
    CHALLENGED = "CHALLENGED"  # Cloudflare managed-challenge interstitial
    ERROR = "ERROR"            # network/transport failure — inconclusive


def is_cf_challenge(status, headers, body):
    """Mirror of src/adapters/cps-golf.ts::isCloudflareChallenge. `headers` keys
    are matched case-insensitively."""
    for k, v in (headers or {}).items():
        if str(k).lower() == "cf-mitigated" and str(v).lower() == "challenge":
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

**Step 4: Run to verify green** — `cd lambda/fetch-proxy && python -m unittest test_challenge -v` → PASS.

**Step 5: Commit**

```bash
git add lambda/fetch-proxy/challenge.py lambda/fetch-proxy/test_challenge.py
git commit -m "feat(proxy): add shared CPS Cloudflare-challenge classifier"
```

**BEFORE marking complete:** Review tests vs `docs/pitfalls/testing-pitfalls.md` §1 (error paths) and §13 (pristine output). Confirm the origin-403-not-challenge case and the case-insensitive header key are covered.

### Task 1.2 — Consume the classifier and generalize the cascade in `index.py`

**Files:**
- Modify: `lambda/fetch-proxy/index.py`.

**Step 1: Replace the inline detector + profile constants with the shared module.** Remove the inline `_is_cf_challenge` (`index.py:50-58`) and the `PRIMARY_PROFILE`/`FALLBACK_PROFILE` constants **together with their explanatory comment block** (`index.py:26-34`) — the profile-selection rationale now lives on `challenge.py::PROFILES` (Task 1.1), so this is moving the comment to its subject, not deleting documentation. Add to the imports:

```python
from challenge import PROFILES, is_cf_challenge
```

Keep `UPSTREAM_TIMEOUT` and `TOTAL_BUDGET`. Keep `_response_headers`, `_clean_request_headers`, `_host_allowed`, `_request`, `_parse_event_body` unchanged.

**Step 2: Replace the handler's primary+single-fallback block** (`index.py:110-125`) with a time-bounded cascade. Current:

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
        # is NOT challenged (a cleared origin response — including a non-2xx
        # origin error, which no fingerprint change would fix). If every profile
        # is challenged the trusted fingerprints have all aged out; return the
        # last (challenged) response so the adapter's canary surfaces it.
        # Every attempt — including the first — is time-bounded by the remaining
        # TOTAL_BUDGET so a stalled upstream can't blow the Worker's 12s abort.
        start = time.monotonic()
        resp = None
        resp_headers = None
        for profile in PROFILES:
            remaining = TOTAL_BUDGET - (time.monotonic() - start)
            if resp is not None and remaining < 2:
                break  # no budget left to try another fingerprint
            resp = _request(
                profile, url, method, headers, body,
                timeout=min(UPSTREAM_TIMEOUT, max(remaining, 2)),
            )
            resp_headers = _response_headers(resp.headers)
            if not is_cf_challenge(resp.status_code, resp_headers, resp.text):
                break  # cleared (or a non-challenge origin response) — done
```

> Note on the first iteration: `resp is None` so the `remaining < 2` guard is skipped and the first request always runs, but it is now `timeout=min(UPSTREAM_TIMEOUT, max(remaining, 2))` ≈ `UPSTREAM_TIMEOUT` at start — so the first request is time-bounded too (review finding #6). `max(remaining, 2)` guarantees a sane floor.

**Step 3: Confirm the response/`proxyError` contract is untouched** — the `return {"status": resp.status_code, "headers": resp_headers, "body": resp.text}` and the `except` block stay exactly as-is.

**Step 4: Verify** — `cd lambda/fetch-proxy && python -m unittest test_challenge` still green. If `curl_cffi` is installed locally, `python -c "import index"` must succeed (no syntax/import error). Full live cascade verification is Phase 2.

**Step 5: Commit**

```bash
git add lambda/fetch-proxy/index.py
git commit -m "feat(proxy): cascade over installed impersonation profiles"
```

**BEFORE marking complete:** Confirm (1) the healthy path issues exactly ONE upstream request (first profile clears → inner `break`); (2) a non-challenge non-2xx origin response stops the cascade; (3) `PROFILES[0] == "chrome"` (DEPLOY-2); (4) detection semantics match the old inline `_is_cf_challenge` (the classifier test covers this).

**After Phase 1 (Tasks 1.1–1.2):** Review the batch ≥3 rounds. Probe: cascade time-budget bound under all-challenged; healthy path still single-request; detection drift vs the TS canary; cold-start interaction (documented in the design as out-of-`time.monotonic()` scope — keep the list short).

---

## Phase 2 — Live probe (axis 2 boundary)

**Execution Status:** ⬜ NOT STARTED

A CLI that, for whatever `curl_cffi` is installed, probes the real CPS challenge endpoint per profile and emits a machine-readable verdict. It is the only network boundary; the decision logic (Phase 3) is pure.

### Task 2.1 — The probe CLI

**Files:**
- Create: `lambda/fetch-proxy/probe.py`

> Located alongside `challenge.py` so it shares the classifier with no path hacks. It ships in the Lambda bundle but is never invoked by `index.handler` (inert) — the accepted DRY tradeoff.

**Step 1: Implement** — `lambda/fetch-proxy/probe.py`:

```python
# ABOUTME: Live CPS Cloudflare-challenge probe — checks whether the installed curl_cffi
# ABOUTME: clears the real challenge per impersonation profile. Used by the rotation workflow.
import argparse
import json
import sys
import uuid

from challenge import PROFILES, Outcome, classify

# Mirrors the adapter's first reservation call (src/adapters/cps-golf.ts:37,163).
# Any path under the reservation base is Cloudflare-challenged pre-auth, so the
# probe needs NO CPS credentials — it only distinguishes "reached origin" from
# "got the interstitial".
RESERVATION_PATH = "/onlineres/onlineapi/api/v1/onlinereservation/RegisterTransactionId"
PROBE_TIMEOUT = 10

# A browser-like header shape so the probe's challenge verdict matches what
# production (which forwards the adapter's headers) sees. No credentials.
def _headers():
    return {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://jcgsc5.cps.golf",
        "Referer": "https://jcgsc5.cps.golf/onlineresweb/",
        "x-requestid": str(uuid.uuid4()),
    }


def probe_profile(url, profile):
    # Import curl_cffi lazily so `--help` and import of this module don't require
    # the native wheel; the workflow installs curl_cffi before a real probe.
    try:
        from curl_cffi import requests
    except Exception as err:  # pragma: no cover - environment guard
        return {"profile": profile, "outcome": Outcome.ERROR, "detail": f"curl_cffi import failed: {err}"}
    try:
        # Mirror index.py's call shape: requests.request(method, url, headers, data, impersonate).
        resp = requests.request(
            "POST", url,
            headers=_headers(),
            data=json.dumps({"transactionId": str(uuid.uuid4())}),
            impersonate=profile,
            timeout=PROBE_TIMEOUT,
        )
    except Exception as err:  # network/transport/unsupported-profile → inconclusive
        return {"profile": profile, "outcome": Outcome.ERROR, "detail": str(err)}
    headers = {str(k).lower(): v for k, v in resp.headers.items()}
    return {"profile": profile, "outcome": classify(resp.status_code, headers, resp.text), "status": resp.status_code}


def run(subdomain, profiles):
    url = f"https://{subdomain}.cps.golf{RESERVATION_PATH}"
    results = [probe_profile(url, p) for p in profiles]
    cleared = next((r for r in results if r["outcome"] == Outcome.CLEARED), None)
    if cleared:
        verdict = Outcome.CLEARED
    elif any(r["outcome"] == Outcome.CHALLENGED for r in results):
        verdict = Outcome.CHALLENGED
    else:
        verdict = Outcome.ERROR  # all profiles errored — inconclusive
    return {
        "subdomain": subdomain,
        "verdict": verdict,
        "cleared_profile": cleared["profile"] if cleared else None,
        "results": results,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Probe CPS for the Cloudflare challenge.")
    parser.add_argument("--subdomain", default="jcgsc5", help="CPS facility subdomain (default: jcgsc5 / Encinitas Ranch SD test course)")
    parser.add_argument("--profiles", default=",".join(PROFILES), help="comma-separated impersonation profiles, tried in order")
    parser.add_argument("--out", help="write the JSON verdict to this file in addition to stdout")
    args = parser.parse_args(argv)

    profiles = [p.strip() for p in args.profiles.split(",") if p.strip()]
    # Top-level guard: ALWAYS emit a JSON verdict, even on an unexpected failure,
    # so the workflow never reads a truncated/empty file (review finding #4).
    try:
        out = run(args.subdomain, profiles)
    except Exception as err:  # pragma: no cover - defensive
        out = {"subdomain": args.subdomain, "verdict": Outcome.ERROR, "cleared_profile": None,
               "results": [{"outcome": Outcome.ERROR, "detail": str(err)}]}
    payload = json.dumps(out)
    sys.stdout.write(payload + "\n")
    if args.out:
        with open(args.out, "w") as fh:
            fh.write(payload)
    return {Outcome.CLEARED: 0, Outcome.CHALLENGED: 1, Outcome.ERROR: 2}[out["verdict"]]


if __name__ == "__main__":
    sys.exit(main())
```

**Step 2: No-network smoke** — `cd lambda/fetch-proxy && python probe.py --help` prints usage (no `curl_cffi` needed thanks to the lazy import).

**Step 3: Commit**

```bash
git add lambda/fetch-proxy/probe.py
git commit -m "feat(proxy): add live CPS Cloudflare-challenge probe CLI"
```

### Task 2.2 — Live-verify the probe against the real CPS challenge (HARD GATE — the load-bearing assumption)

**Files:** none (verification). **This validates the design's core assumption** that an unauthenticated `RegisterTransactionId` cleanly distinguishes a good fingerprint from a bad one. Do NOT trust the gate until this passes.

In an environment with `curl_cffi==0.15.0` (CI scratch, a Linux box, or the Phase 3 `workflow_dispatch`):

```bash
cd lambda/fetch-proxy && pip install curl_cffi==0.15.0
python probe.py --subdomain jcgsc5 --profiles chrome      # expect verdict CLEARED (exit 0)
python probe.py --subdomain jcgsc5 --profiles chrome124   # expect verdict CHALLENGED (exit 1)
```

Inspect the actual responses: confirm `chrome` returns a **non-challenge** origin response (not a 200 Cloudflare interstitial, not a redirect-to-login that the classifier would misread) and `chrome124` returns the `cf-mitigated: challenge` interstitial. Record both JSON outputs as the PR's live-gate evidence.

> **Contingency (review finding #7):** if the unauthenticated probe does NOT cleanly distinguish (e.g. good-fingerprint also looks "challenged", or both look "cleared"), STOP and extend the probe through the token + register flow (`cps-golf.ts:136` token endpoint → registration) before proceeding. Do not relax the classifier to force a pass.

### Task 2.3 — Finalize the cascade profile list

Using the live probe, enumerate which vendor-diverse profiles `curl_cffi==0.15.0` actually supports — a profile it doesn't support returns `Outcome.ERROR` with an unsupported-profile `detail`. For each candidate beyond `chrome`/`safari17_0` (prefer a **versionless** `safari` alias over the pinned `safari17_0` if 0.15.0 exposes one — review finding #12; also consider a firefox/edge alias), run `python probe.py --profiles <candidate>`. Include in `PROFILES` ONLY entries that do NOT error. Keep the list short (cold-start + time-budget). Update `challenge.py::PROFILES`, re-run `test_challenge`, and document in a comment if `safari17_0` is retained because no versionless `safari` alias exists (it is itself subject to aging).

```bash
git add lambda/fetch-proxy/challenge.py
git commit -m "feat(proxy): confirm vendor-diverse cascade profiles for curl_cffi 0.15.0"
```

**After Phase 2:** Review ≥3 rounds. Probe: can the probe emit CLEARED on something that isn't really the CPS origin? Does ERROR absorb network flakiness so the workflow won't act on a blip? Is the exit-code/verdict contract consistent? Does the probe's request shape (POST + browser headers + `requests.request`) faithfully match production?

---

## Phase 3 — Pure rotation decision + scheduled workflow (axis 2)

**Execution Status:** ⬜ NOT STARTED

The decision over the verdict matrix is a **pure, exhaustively unit-tested function** (so the "broken-but-green" holes a sprawling YAML `if:` chain would leave are impossible). The workflow is a thin actuator.

### Task 3.1 — Pure decision module (test-first, full matrix)

**Files:**
- Create: `lambda/fetch-proxy/rotate.py`
- Create (test): `lambda/fetch-proxy/test_rotate.py`

**BEFORE starting work:** Invoke `superpowers:test-driven-development`; read `docs/pitfalls/testing-pitfalls.md`. The point of this task is exhaustive matrix coverage — every (pinned, latest, version-equal, cleared-profile, force) combination is a test case.

**Step 1: Write the failing test** — `lambda/fetch-proxy/test_rotate.py`:

```python
# ABOUTME: Exhaustive unit tests for the pure curl_cffi rotation decision.
# ABOUTME: Every (pinned, latest, version-equal, cleared-profile, force) combination is covered.
import unittest

from challenge import Outcome
from rotate import Action, decide

CLEARED, CHALLENGED, ERROR = Outcome.CLEARED, Outcome.CHALLENGED, Outcome.ERROR


class Decide(unittest.TestCase):
    def test_pinned_cleared_is_noop(self):
        d = decide(CLEARED, None, None, "0.15.0", None)
        self.assertEqual(d.action, Action.NONE)
        self.assertEqual(d.exit_code, 0)

    def test_pinned_error_is_noop_inconclusive(self):
        d = decide(ERROR, None, None, "0.15.0", None)
        self.assertEqual(d.action, Action.NONE)
        self.assertEqual(d.exit_code, 0)

    def test_challenged_then_newer_cleared_opens_pr(self):
        d = decide(CHALLENGED, CLEARED, "chrome", "0.15.0", "0.16.0")
        self.assertEqual(d.action, Action.OPEN_PR)
        self.assertEqual(d.exit_code, 0)
        self.assertFalse(d.degraded)

    def test_challenged_then_newer_cleared_via_fallback_is_degraded(self):
        d = decide(CHALLENGED, CLEARED, "safari17_0", "0.15.0", "0.16.0")
        self.assertEqual(d.action, Action.OPEN_PR)
        self.assertTrue(d.degraded)  # chrome still challenged on latest

    def test_challenged_then_latest_equals_pinned_fails_loud(self):
        d = decide(CHALLENGED, CLEARED, "chrome", "0.15.0", "0.15.0")
        self.assertEqual(d.action, Action.FAIL)
        self.assertEqual(d.exit_code, 1)

    def test_challenged_then_latest_also_challenged_fails_loud(self):
        d = decide(CHALLENGED, CHALLENGED, None, "0.15.0", "0.16.0")
        self.assertEqual(d.action, Action.FAIL)
        self.assertEqual(d.exit_code, 1)

    def test_challenged_then_latest_error_fails_loud(self):
        # review finding #3 hole #2: a transient latest-probe error while the
        # primary is challenged must NOT go silently green.
        d = decide(CHALLENGED, ERROR, None, "0.15.0", "0.16.0")
        self.assertEqual(d.action, Action.FAIL)
        self.assertEqual(d.exit_code, 1)

    def test_challenged_but_latest_missing_fails(self):
        d = decide(CHALLENGED, None, None, "0.15.0", None)
        self.assertEqual(d.action, Action.FAIL)

    def test_force_check_on_healthy_with_newer_cleared_opens_pr(self):
        # force_check on a healthy system probes latest; a newer cleared version is a proactive bump.
        d = decide(CLEARED, CLEARED, "chrome", "0.15.0", "0.16.0", force_check=True)
        self.assertEqual(d.action, Action.OPEN_PR)

    def test_force_check_on_healthy_already_latest_is_quiet_noop(self):
        # forced check + healthy + nothing newer is NOT a failure (exit 0).
        d = decide(CLEARED, CLEARED, "chrome", "0.15.0", "0.15.0", force_check=True)
        self.assertEqual(d.action, Action.NONE)
        self.assertEqual(d.exit_code, 0)

    def test_force_check_on_healthy_latest_challenged_is_quiet_noop(self):
        d = decide(CLEARED, CHALLENGED, None, "0.15.0", "0.16.0", force_check=True)
        self.assertEqual(d.action, Action.NONE)
        self.assertEqual(d.exit_code, 0)


class PrBody(unittest.TestCase):
    # Verifies the PR-body builder deterministically, so it is covered even when
    # no newer curl_cffi exists at run time (the live dry-run can't exercise it then).
    def _body(self, degraded):
        from rotate import Decision, _pr_body
        d = Decision(Action.OPEN_PR, "reason", degraded=degraded)
        pinned = {"verdict": "CHALLENGED", "cleared_profile": None, "subdomain": "jcgsc5"}
        latest = {"verdict": "CLEARED", "cleared_profile": "chrome", "subdomain": "jcgsc5"}
        return _pr_body(d, "0.15.0", "0.16.0", pinned, latest)

    def test_body_names_both_versions_and_runbook(self):
        body = self._body(degraded=False)
        self.assertIn("0.15.0", body)
        self.assertIn("0.16.0", body)
        self.assertIn("DEPLOY-2", body)
        self.assertNotIn("⚠️ **Degraded rotation:**", body)

    def test_degraded_body_carries_warning(self):
        self.assertIn("Degraded rotation", self._body(degraded=True))

    def test_body_has_no_secret_like_tokens(self):
        # Guards against accidental credential interpolation into the public PR body.
        body = self._body(degraded=False).lower()
        for needle in ("aws_secret", "x-apikey", "authorization", "bearer ", "secretaccesskey"):
            self.assertNotIn(needle, body)


if __name__ == "__main__":
    unittest.main()
```

**Step 2: Run to verify it fails** — `cd lambda/fetch-proxy && python -m unittest test_rotate -v` → FAIL (`No module named 'rotate'`).

**Step 3: Implement** — `lambda/fetch-proxy/rotate.py`:

```python
# ABOUTME: Pure decision for whether to propose a curl_cffi bump, plus a thin CLI the
# ABOUTME: rotation workflow calls. The decision over the verdict matrix is fully unit-tested.
import argparse
import json
import sys

from challenge import PROFILES, Outcome


class Action:
    NONE = "none"        # healthy or inconclusive — exit 0, no PR
    OPEN_PR = "open_pr"  # propose a bump — exit 0 (PR opened by the workflow)
    FAIL = "fail"        # CPS broken with no safe automatic action — exit 1 (loud)


class Decision:
    def __init__(self, action, reason, degraded=False):
        self.action = action
        self.reason = reason
        self.degraded = degraded

    @property
    def exit_code(self):
        return 1 if self.action == Action.FAIL else 0

    def to_dict(self):
        return {"action": self.action, "exit_code": self.exit_code,
                "reason": self.reason, "degraded": self.degraded}


def decide(pinned_verdict, latest_verdict, cleared_profile,
           pinned_version, latest_version, force_check=False):
    """Pure rotation decision. `latest_verdict` is None when the latest probe
    was not run (pinned healthy and not forced)."""
    if pinned_verdict == Outcome.CLEARED and not force_check:
        return Decision(Action.NONE, "Pinned curl_cffi still clears the CPS challenge.")
    if pinned_verdict == Outcome.ERROR:
        return Decision(Action.NONE, "Pinned probe inconclusive (transport); will retry next run.")

    pinned_broken = pinned_verdict == Outcome.CHALLENGED
    if latest_verdict is None:
        return Decision(Action.FAIL, "Latest curl_cffi was required but not evaluated.")

    if latest_verdict == Outcome.CLEARED and latest_version != pinned_version:
        return Decision(
            Action.OPEN_PR,
            f"curl_cffi {latest_version} clears the CPS challenge (profile {cleared_profile}).",
            degraded=(cleared_profile != PROFILES[0]),
        )

    # No actionable newer version. Loud (FAIL) ONLY if the pinned primary is
    # genuinely challenged; a forced check on a healthy system is a quiet no-op.
    terminal = Action.FAIL if pinned_broken else Action.NONE
    if latest_verdict == Outcome.ERROR:
        return Decision(terminal, "Latest curl_cffi probe inconclusive; cannot confirm a fix.")
    if latest_verdict == Outcome.CHALLENGED:
        return Decision(terminal, "Latest curl_cffi is also challenged — no newer fingerprint clears CPS; await upstream.")
    return Decision(terminal, "Already on the latest curl_cffi release; no newer fingerprint available.")


def _verdict(path):
    if not path:
        return None, None, None
    with open(path) as fh:
        data = json.load(fh)
    return data.get("verdict"), data.get("cleared_profile"), data


def _pr_body(decision, pinned_version, latest_version, pinned_data, latest_data):
    degraded_note = (
        "\n> ⚠️ **Degraded rotation:** the versionless `chrome` profile is still "
        "challenged even on this version; only a fallback fingerprint cleared. A "
        "fully-clean Chrome fingerprint isn't available yet — merge to restore "
        "coverage, but expect another rotation when one ships.\n"
        if decision.degraded else ""
    )
    return f"""Automated CPS impersonation-profile rotation (DEPLOY-2 runbook).

The pinned `curl_cffi=={pinned_version}` is **challenged** by CPS's Cloudflare bot-management, but `curl_cffi=={latest_version}` **live-cleared** the real challenge against `jcgsc5.cps.golf` and is vendor-deployable to the Lambda runtime.
{degraded_note}
**Live-gate evidence (pinned — CHALLENGED):**
```json
{json.dumps(pinned_data, indent=2)}
```
**Live-gate evidence (latest — CLEARED):**
```json
{json.dumps(latest_data, indent=2)}
```

Merge to `dev`, then publish `dev` → `main` to deploy (deploy re-vendors curl_cffi). Fast-track if CPS polling is actively down. See `docs/pitfalls/implementation-pitfalls.md` DEPLOY-2 and `docs/plans/2026-06-08-cps-profile-rotation-design.md`.
"""


def main(argv=None):
    parser = argparse.ArgumentParser(description="Decide whether to propose a curl_cffi rotation.")
    parser.add_argument("--pinned-json", required=True)
    parser.add_argument("--pinned-version", required=True)
    parser.add_argument("--latest-json")
    parser.add_argument("--latest-version")
    parser.add_argument("--force-check", action="store_true")
    parser.add_argument("--body-out", help="write the PR body here when action is open_pr")
    args = parser.parse_args(argv)

    pinned_verdict, _, pinned_data = _verdict(args.pinned_json)
    latest_verdict, cleared_profile, latest_data = _verdict(args.latest_json)
    decision = decide(pinned_verdict, latest_verdict, cleared_profile,
                      args.pinned_version, args.latest_version, args.force_check)

    if decision.action == Action.OPEN_PR and args.body_out:
        with open(args.body_out, "w") as fh:
            fh.write(_pr_body(decision, args.pinned_version, args.latest_version, pinned_data, latest_data))

    sys.stdout.write(json.dumps(decision.to_dict()) + "\n")
    return 0  # the workflow reads `action`/`exit_code` from the JSON; this CLI itself always succeeds


if __name__ == "__main__":
    sys.exit(main())
```

> The CLI's own exit is always 0 (it succeeded at *deciding*); the workflow reads `action` and `exit_code` from the JSON and acts. This keeps "did the decision tool run" separate from "what did it decide."

**Step 4: Run to verify green** — `cd lambda/fetch-proxy && python -m unittest test_rotate -v` → PASS (all matrix cases).

**Step 5: Commit**

```bash
git add lambda/fetch-proxy/rotate.py lambda/fetch-proxy/test_rotate.py
git commit -m "feat(proxy): pure curl_cffi rotation decision with exhaustive matrix tests"
```

**BEFORE marking complete:** Confirm the test enumerates every pinned×latest combination including the two review-#3 holes (latest==pinned, latest==ERROR while pinned CHALLENGED) and that both are FAIL/exit-1. Confirm no PII/secrets in `_pr_body` (it embeds only verdict JSON — version, profile, status, subdomain).

### Task 3.2 — The rotation workflow (thin actuator)

**Files:**
- Create: `.github/workflows/cps-profile-rotation.yml`

**Step 1: Implement** — `.github/workflows/cps-profile-rotation.yml`:

```yaml
# Detects whether CPS's Cloudflare challenge has aged out the pinned curl_cffi
# fingerprint and, only when a newer curl_cffi LIVE-clears the real challenge AND
# is vendor-deployable to the Lambda, opens a human-gated PR bumping
# requirements.txt. Fail-closed: never proposes an unverified or undeployable
# version. See docs/plans/2026-06-08-cps-profile-rotation-design.md.
name: CPS profile rotation

on:
  schedule:
    - cron: "30 13 * * *" # daily ~07:30 CT; fires rarely (~3-9mo), so daily is ample
  workflow_dispatch:
    inputs:
      force_check:
        description: "Probe latest even if the pinned version still clears"
        type: boolean
        default: false
      dry_run:
        description: "Build & print the PR body instead of opening a PR"
        type: boolean
        default: false

permissions:
  contents: write
  pull-requests: write

defaults:
  run:
    shell: bash

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

      - name: Run pure-logic unit tests
        working-directory: lambda/fetch-proxy
        run: python -m unittest test_challenge test_rotate -v

      - name: Idempotency guard — skip if a rotation PR is already open
        id: guard
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set -euo pipefail
          OPEN=$(gh pr list --state open --limit 100 --json number,headRefName \
            --jq '[.[] | select(.headRefName | startswith("chore/cps-curl-cffi-bump-"))] | length')
          if [ "$OPEN" != "0" ]; then
            echo "A rotation PR is already open; skipping." 
            echo "pending=true" >> "$GITHUB_OUTPUT"
          else
            echo "pending=false" >> "$GITHUB_OUTPUT"
          fi

      - name: Read pinned curl_cffi version
        id: pinned
        if: steps.guard.outputs.pending != 'true'
        run: |
          set -euo pipefail
          PINNED=$(sed -n 's/^curl_cffi==//p' lambda/fetch-proxy/requirements.txt)
          [ -n "$PINNED" ] || { echo "::error::could not parse pinned curl_cffi version"; exit 1; }
          echo "version=$PINNED" >> "$GITHUB_OUTPUT"

      - name: Probe pinned curl_cffi (chrome only — detect primary aging)
        id: probe_pinned
        if: steps.guard.outputs.pending != 'true'
        working-directory: lambda/fetch-proxy
        run: |
          set -euo pipefail
          python -m pip install --quiet "curl_cffi==${{ steps.pinned.outputs.version }}"
          # `|| true`: probe.py exits non-zero by design (CHALLENGED=1, ERROR=2) so a
          # plain shell could branch on it — but here the verdict is read from the JSON
          # file, so under `set -e` we MUST NOT let a CHALLENGED exit kill the step (that
          # would abort the workflow in exactly the case it exists to handle).
          python probe.py --subdomain jcgsc5 --profiles chrome --out pinned.json || true
          echo "verdict=$(python -c 'import json;print(json.load(open("pinned.json"))["verdict"])')" >> "$GITHUB_OUTPUT"

      - name: Probe latest curl_cffi (full cascade)
        id: probe_latest
        if: >-
          steps.guard.outputs.pending != 'true' &&
          (steps.probe_pinned.outputs.verdict == 'CHALLENGED' || inputs.force_check)
        working-directory: lambda/fetch-proxy
        run: |
          set -euo pipefail
          python -m pip install --quiet --upgrade curl_cffi
          LATEST=$(python -c 'import curl_cffi;print(curl_cffi.__version__)')
          echo "version=$LATEST" >> "$GITHUB_OUTPUT"
          python probe.py --subdomain jcgsc5 --out latest.json || true  # verdict read from JSON; don't let a CHALLENGED exit fail the step

      - name: Decide
        id: decide
        if: steps.guard.outputs.pending != 'true' && steps.probe_pinned.outcome == 'success'
        working-directory: lambda/fetch-proxy
        run: |
          set -euo pipefail
          ARGS=(--pinned-json pinned.json --pinned-version "${{ steps.pinned.outputs.version }}" --body-out pr_body.md)
          if [ -f latest.json ]; then
            ARGS+=(--latest-json latest.json --latest-version "${{ steps.probe_latest.outputs.version }}")
          fi
          if [ "${{ inputs.force_check }}" = "true" ]; then ARGS+=(--force-check); fi
          python rotate.py "${ARGS[@]}" | tee decision.json
          echo "action=$(python -c 'import json;print(json.load(open("decision.json"))["action"])')" >> "$GITHUB_OUTPUT"
          echo "exit_code=$(python -c 'import json;print(json.load(open("decision.json"))["exit_code"])')" >> "$GITHUB_OUTPUT"

      - name: Deployability gate — candidate must cross-vendor for the Lambda
        if: steps.decide.outputs.action == 'open_pr'
        run: |
          set -euo pipefail
          python3 -m pip install \
            --target /tmp/vendor-check \
            --platform manylinux2014_x86_64 \
            --implementation cp \
            --python-version 3.14 \
            --only-binary=:all: \
            "curl_cffi==${{ steps.probe_latest.outputs.version }}" \
            || { echo "::error::curl_cffi ${{ steps.probe_latest.outputs.version }} cleared the challenge but is NOT vendor-deployable to the Lambda (manylinux2014/cp314). Not proposing it."; exit 1; }

      - name: Open bump PR (live- and deploy-gated, fail-closed)
        if: steps.decide.outputs.action == 'open_pr' && inputs.dry_run != true
        env:
          GH_TOKEN: ${{ github.token }}
          LATEST: ${{ steps.probe_latest.outputs.version }}
        run: |
          set -euo pipefail
          [[ "$LATEST" =~ ^[0-9][0-9A-Za-z.+-]*$ ]] || { echo "::error::refusing unsafe version string: $LATEST"; exit 1; }
          BRANCH="chore/cps-curl-cffi-bump-${LATEST}"
          # Scheduled runs check out the DEFAULT branch (main); base the bump branch
          # explicitly on origin/dev so the PR diff is exactly the requirements bump.
          git fetch origin dev
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git checkout -b "$BRANCH" origin/dev
          sed -i "s|^curl_cffi==.*|curl_cffi==${LATEST}|" lambda/fetch-proxy/requirements.txt
          git add lambda/fetch-proxy/requirements.txt
          git commit -m "chore(proxy): bump curl_cffi to ${LATEST} (CPS fingerprint rotation)"
          git push -u origin "$BRANCH"
          gh pr create --base dev --head "$BRANCH" \
            --title "chore(proxy): rotate CPS curl_cffi to ${LATEST}" \
            --body-file lambda/fetch-proxy/pr_body.md

      - name: Dry run — print intended PR body
        if: steps.decide.outputs.action == 'open_pr' && inputs.dry_run == true
        working-directory: lambda/fetch-proxy
        run: |
          echo "DRY RUN — would bump curl_cffi to ${{ steps.probe_latest.outputs.version }} and open a PR with body:"
          cat pr_body.md

      - name: Surface the decision exit code (loud on terminal cases)
        if: steps.guard.outputs.pending != 'true' && steps.decide.outcome == 'success'
        run: |
          set -euo pipefail
          REASON=$(python -c 'import json;print(json.load(open("lambda/fetch-proxy/decision.json"))["reason"])')
          echo "Decision: ${{ steps.decide.outputs.action }} — $REASON"
          exit "${{ steps.decide.outputs.exit_code }}"
```

> **Subagent guardrails (do NOT drift):**
> - PR base is **`dev`**, never `main`.
> - The PR step runs ONLY on `decide.action == 'open_pr'` AND after the deployability gate passed — and `decide()` only returns `open_pr` on pinned-CHALLENGED + latest-CLEARED + newer version. Do not loosen any `if:`.
> - No secrets anywhere; the probe needs none and PR creation uses the built-in `github.token`. Do NOT add CPS/AWS/CF secrets.
> - `--body-file` (NOT a heredoc) — the body is a file written by `rotate.py`; never command-substitute probe output into shell.
> - Version string is regex-validated before use in `sed`/branch/commit.
> - Use `sed -i "s|...|...|"` with `|` delimiters so a `/` in a version can't break the substitution.

**Step 2: Validate the YAML** — `python -c "import yaml; yaml.safe_load(open('.github/workflows/cps-profile-rotation.yml'))"` → parses clean. (Optionally `npx --yes @action-validator/cli .github/workflows/cps-profile-rotation.yml`.)

**Step 3: Commit**

```bash
git add .github/workflows/cps-profile-rotation.yml
git commit -m "feat(ci): scheduled CPS curl_cffi profile-rotation workflow"
```

### Task 3.3 — Live-verify the workflow end to end via `workflow_dispatch`

**Files:** none (verification — runs once the branch is pushed so the workflow exists on a runnable ref).

After pushing the branch, trigger manual runs and confirm:
1. **Healthy path** (default inputs): pinned `chrome` clears → decide `none` → green, "still clears". Probe-latest skipped.
2. **PR-body path without side effects** (`force_check: true`, `dry_run: true`): probes latest, builds and prints the PR body, opens **no** PR. This exercises the open_pr code path and the body builder (review finding #5 — the dry-run makes the PR path verifiable even when latest==pinned, because `force_check`+healthy+newer→open_pr, and if latest==pinned it correctly reports none).
3. Confirm the **idempotency guard** short-circuits when a `chore/cps-curl-cffi-bump-*` PR is open.

Record run URLs + outcomes in the PR description. This is the prompt-mandated live verification of the mechanism against a real CPS facility.

> If the workflow cannot run before merge (not yet on a runnable ref / dispatch unavailable in this environment), state so explicitly and run it immediately post-merge before declaring DONE. Do NOT claim "verified" without a real run.

**After Phase 3:** Review ≥3 rounds. Probe: can ERROR ever reach the PR step? (No — decide returns none/fail, never open_pr, on ERROR.) Is the deployability gate truly before the PR? Does `--body-file` eliminate the injection surface? Does a `github.token` PR skip downstream CI, and is that acceptable for a deps-only change already deploy-gated? Does the idempotency guard prevent daily duplicate PRs?

---

## Phase 4 — Documentation

**Execution Status:** ⬜ NOT STARTED

### Task 4.1 — Update the DEPLOY-2 rotation runbook

**Files:** Modify `docs/pitfalls/implementation-pitfalls.md` (DEPLOY-2 "Rotation (recurring maintenance)" paragraph, ~line 275).

Add: the `CPS profile rotation` workflow (`.github/workflows/cps-profile-rotation.yml`) probes `jcgsc5.cps.golf` daily and opens a live- and deploy-gated `curl_cffi` bump PR automatically; the manual "bump `curl_cffi` + redeploy" stays as the break-glass / fast-track path. Do NOT remove the manual instructions. Keep DEPLOY-2's voice.

### Task 4.2 — Update implementation log, design-doc status, and Prompt 5 status

**Files:**
- Modify `docs/implementation-log.md` — append: what was built, the version-vs-profile axis, the human-gate decision, the live-gate + deployability-gate, and the live-verification evidence.
- Modify `docs/plans/2026-06-08-cps-profile-rotation-design.md` — flip Status to reflect implementation.
- Modify `docs/plans/2026-06-08-followup-prompts.md` — Prompt 5 status → implemented / PR open.

```bash
git add docs/
git commit -m "docs: wire DEPLOY-2 runbook to the rotation automation; log + statuses"
```

**After Phase 4:** Review docs for the cross-reference rule (self-identifying links, no opaque session shorthand) and DEPLOY-2 voice consistency.

---

## Final gate (before PR)

1. `cd lambda/fetch-proxy && python -m unittest test_challenge test_rotate -v` → green.
2. Probe live-verified against `jcgsc5` (CLEARED on `chrome`, CHALLENGED on `chrome124`), with the actual responses inspected — or an explicit deferral note if `curl_cffi` was uninstallable in-session (then verified via `workflow_dispatch`).
3. Workflow YAML parses; the decision matrix is exhaustively unit-tested (no broken-but-green path).
4. **Adversarial code review (≥3 rounds):** `superpowers:requesting-code-review` + `feature-dev:code-reviewer`. Every round probes: can a blind/unverified or undeployable version reach prod? self-heal latency? cascade time-budget/cold-start? spurious-PR on transient outage? secret/PII leak? injection via `--body-file`/version string? Record rounds in the PR description.
5. Open PR to `dev`. Subscribe/watch CI.

## Execution strategy recommendation

**Execute in-session by the context-holding agent (not fresh subagents).** The tasks are tightly sequential and coupled (`challenge.py` → `index.py` → `probe.py` → `rotate.py` → workflow → docs), each touches a distinct file, and the live-verification + version-vs-profile reasoning benefits from the deep context already loaded. Use `feature-dev:code-reviewer` as the independent adversarial reviewer at the review gate.
