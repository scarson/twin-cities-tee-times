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
