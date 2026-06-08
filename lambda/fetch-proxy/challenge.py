# ABOUTME: Pure CPS Cloudflare-challenge classifier shared by the proxy and the rotation probe.
# ABOUTME: No network and no curl_cffi import, so it is unit-testable anywhere.

# Ordered impersonation profiles tried in cascade. The versionless "chrome"
# alias leads (DEPLOY-2: never pin a chromeNNN — pinned profiles age out of
# Cloudflare's allowlist). Subsequent entries give a de-allowlisted primary a
# chance of another installed fingerprint still clearing, though same-release
# siblings tend to age out together (so this is cheap insurance, not a fix —
# see docs/plans/2026-06-08-cps-profile-rotation-design.md). Every entry MUST be
# a profile the vendored curl_cffi build supports; an unsupported profile raises
# at request time. The exact list is confirmed empirically (see the design's
# Task 2.3).
PROFILES = ("chrome", "safari17_0")


class Outcome:
    """Three-way probe result. ERROR is inconclusive and MUST NOT drive a
    rotation (a transient CPS outage is not an aged-out fingerprint)."""

    CLEARED = "CLEARED"  # reached the CPS origin — fingerprint accepted
    CHALLENGED = "CHALLENGED"  # Cloudflare managed-challenge interstitial
    ERROR = "ERROR"  # network/transport failure — inconclusive


def is_cf_challenge(status, headers, body):
    """Mirror of src/adapters/cps-golf.ts::isCloudflareChallenge. `headers` keys
    are matched case-insensitively."""
    for k, v in (headers or {}).items():
        if str(k).lower() == "cf-mitigated" and str(v).lower() == "challenge":
            return True
    return status == 403 and any(
        marker in (body or "")
        for marker in (
            "Just a moment",
            "challenges.cloudflare.com",
            "cdn-cgi/challenge-platform",
            "__cf_chl",
        )
    )


def classify(status, headers, body):
    """Map a completed HTTP response to CLEARED or CHALLENGED. Transport
    failures never reach here — the caller maps exceptions to Outcome.ERROR."""
    return Outcome.CHALLENGED if is_cf_challenge(status, headers, body) else Outcome.CLEARED
