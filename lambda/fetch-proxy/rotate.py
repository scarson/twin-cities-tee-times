# ABOUTME: Pure decision for whether to propose a curl_cffi bump, plus a thin CLI the
# ABOUTME: rotation workflow calls. The decision over the verdict matrix is fully unit-tested.
import argparse
import json
import sys

from challenge import PROFILES, Outcome


class Action:
    NONE = "none"  # healthy or inconclusive — exit 0, no PR
    OPEN_PR = "open_pr"  # propose a bump — exit 0 (PR opened by the workflow)
    FAIL = "fail"  # CPS broken with no safe automatic action — exit 1 (loud)


class Decision:
    def __init__(self, action, reason, degraded=False):
        self.action = action
        self.reason = reason
        self.degraded = degraded

    @property
    def exit_code(self):
        return 1 if self.action == Action.FAIL else 0

    def to_dict(self):
        return {
            "action": self.action,
            "exit_code": self.exit_code,
            "reason": self.reason,
            "degraded": self.degraded,
        }


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

    if latest_verdict == Outcome.CLEARED and latest_version and latest_version != pinned_version:
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
        if decision.degraded
        else ""
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

This PR is opened and **auto-merged** by the rotation workflow (one to `main`, one to `dev`, kept in lockstep); merging `main` triggers a deploy that re-vendors curl_cffi. It is an audit record, not an action request — no review needed. See `docs/pitfalls/implementation-pitfalls.md` DEPLOY-2 and `docs/plans/2026-06-08-cps-profile-rotation-design.md`.
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
    decision = decide(
        pinned_verdict, latest_verdict, cleared_profile,
        args.pinned_version, args.latest_version, args.force_check,
    )

    if decision.action == Action.OPEN_PR and args.body_out:
        # utf-8 explicitly: the body contains non-ASCII (→, ⚠️) that the platform
        # default codec (cp1252 on Windows) can't encode.
        with open(args.body_out, "w", encoding="utf-8") as fh:
            fh.write(_pr_body(decision, args.pinned_version, args.latest_version, pinned_data, latest_data))

    sys.stdout.write(json.dumps(decision.to_dict()) + "\n")
    # The workflow reads `action`/`exit_code` from the JSON and acts; this CLI
    # itself always succeeds at *deciding*.
    return 0


if __name__ == "__main__":
    sys.exit(main())
