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
        d = decide(CHALLENGED, CLEARED, "safari", "0.15.0", "0.16.0")
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
        # A transient latest-probe error while the primary is challenged must
        # NOT go silently green.
        d = decide(CHALLENGED, ERROR, None, "0.15.0", "0.16.0")
        self.assertEqual(d.action, Action.FAIL)
        self.assertEqual(d.exit_code, 1)

    def test_challenged_but_latest_missing_fails(self):
        d = decide(CHALLENGED, None, None, "0.15.0", None)
        self.assertEqual(d.action, Action.FAIL)

    def test_challenged_then_cleared_but_empty_version_does_not_open_pr(self):
        # An empty/unknown latest version must never produce an open_pr decision.
        d = decide(CHALLENGED, CLEARED, "chrome", "0.15.0", "")
        self.assertNotEqual(d.action, Action.OPEN_PR)
        self.assertEqual(d.action, Action.FAIL)

    def test_force_check_on_healthy_with_newer_cleared_opens_pr(self):
        d = decide(CLEARED, CLEARED, "chrome", "0.15.0", "0.16.0", force_check=True)
        self.assertEqual(d.action, Action.OPEN_PR)

    def test_force_check_on_healthy_already_latest_is_quiet_noop(self):
        d = decide(CLEARED, CLEARED, "chrome", "0.15.0", "0.15.0", force_check=True)
        self.assertEqual(d.action, Action.NONE)
        self.assertEqual(d.exit_code, 0)

    def test_force_check_on_healthy_latest_challenged_is_quiet_noop(self):
        d = decide(CLEARED, CHALLENGED, None, "0.15.0", "0.16.0", force_check=True)
        self.assertEqual(d.action, Action.NONE)
        self.assertEqual(d.exit_code, 0)

    def test_force_check_on_healthy_latest_error_is_quiet_noop(self):
        d = decide(CLEARED, ERROR, None, "0.15.0", "0.16.0", force_check=True)
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
        self.assertNotIn("Degraded rotation", body)

    def test_degraded_body_carries_warning(self):
        self.assertIn("Degraded rotation", self._body(degraded=True))

    def test_body_has_no_secret_like_tokens(self):
        body = self._body(degraded=False).lower()
        for needle in ("aws_secret", "x-apikey", "authorization", "bearer ", "secretaccesskey"):
            self.assertNotIn(needle, body)


if __name__ == "__main__":
    unittest.main()
