# ABOUTME: Pure CPS Cloudflare-challenge classifier shared by the proxy and the rotation probe.
# ABOUTME: No network and no curl_cffi import, so it is unit-testable anywhere.

# Ordered impersonation profiles tried in cascade, all VERSIONLESS aliases
# (DEPLOY-2: never pin a chromeNNN/safariNN — pinned profiles age out of
# Cloudflare's allowlist; the versionless aliases track the newest fingerprint
# the installed curl_cffi build ships). The vendor-diverse alternates give a
# de-allowlisted primary a chance of another fingerprint still clearing, though
# same-release siblings tend to age out together (cheap insurance, not a fix —
# see docs/plans/2026-06-08-cps-profile-rotation-design.md). Every entry MUST be
# an alias the vendored curl_cffi supports; an unsupported one raises at request
# time. Verified live against curl_cffi 0.15.0 / jcgsc5.cps.golf: chrome, safari,
# firefox all cleared; edge / chrome_android were challenged and excluded.
PROFILES = ("chrome", "safari", "firefox")


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
