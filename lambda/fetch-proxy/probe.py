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


def _headers(subdomain):
    # A browser-like header shape so the probe's challenge verdict matches what
    # production (which forwards the adapter's headers) sees. No credentials.
    return {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": f"https://{subdomain}.cps.golf",
        "Referer": f"https://{subdomain}.cps.golf/onlineresweb/",
        "x-requestid": str(uuid.uuid4()),
    }


def probe_profile(url, subdomain, profile):
    # Import curl_cffi lazily so `--help` and importing this module don't require
    # the native wheel; the workflow installs curl_cffi before a real probe.
    try:
        from curl_cffi import requests
    except Exception as err:  # pragma: no cover - environment guard
        return {"profile": profile, "outcome": Outcome.ERROR, "detail": f"curl_cffi import failed: {err}"}
    try:
        # Mirror index.py's call shape: requests.request(method, url, headers, data, impersonate).
        resp = requests.request(
            "POST",
            url,
            headers=_headers(subdomain),
            data=json.dumps({"transactionId": str(uuid.uuid4())}),
            impersonate=profile,
            timeout=PROBE_TIMEOUT,
        )
    except Exception as err:  # network/transport/unsupported-profile → inconclusive
        return {"profile": profile, "outcome": Outcome.ERROR, "detail": str(err)}
    headers = {str(k).lower(): v for k, v in resp.headers.items()}
    return {
        "profile": profile,
        "outcome": classify(resp.status_code, headers, resp.text),
        "status": resp.status_code,
    }


def run(subdomain, profiles):
    url = f"https://{subdomain}.cps.golf{RESERVATION_PATH}"
    results = [probe_profile(url, subdomain, p) for p in profiles]
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
    parser.add_argument(
        "--subdomain",
        default="jcgsc5",
        help="CPS facility subdomain (default: jcgsc5 / Encinitas Ranch SD test course)",
    )
    parser.add_argument(
        "--profiles",
        default=",".join(PROFILES),
        help="comma-separated impersonation profiles, tried in order",
    )
    parser.add_argument("--out", help="write the JSON verdict to this file in addition to stdout")
    args = parser.parse_args(argv)

    profiles = [p.strip() for p in args.profiles.split(",") if p.strip()]
    # Top-level guard: ALWAYS emit a JSON verdict, even on an unexpected failure,
    # so the workflow never reads a truncated/empty file.
    try:
        out = run(args.subdomain, profiles)
    except Exception as err:  # pragma: no cover - defensive
        out = {
            "subdomain": args.subdomain,
            "verdict": Outcome.ERROR,
            "cleared_profile": None,
            "results": [{"outcome": Outcome.ERROR, "detail": str(err)}],
        }
    payload = json.dumps(out)
    sys.stdout.write(payload + "\n")
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(payload)
    return {Outcome.CLEARED: 0, Outcome.CHALLENGED: 1, Outcome.ERROR: 2}[out["verdict"]]


if __name__ == "__main__":
    sys.exit(main())
