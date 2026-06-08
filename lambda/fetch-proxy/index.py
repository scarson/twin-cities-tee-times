# ABOUTME: HTTPS forward proxy for AWS Lambda using browser TLS impersonation (curl_cffi).
# ABOUTME: CPS Golf fronts its reservation API with a Cloudflare bot-challenge that only a
#          trusted browser TLS fingerprint clears; this proxy supplies that fingerprint.
import base64
import json
from urllib.parse import urlparse

from curl_cffi import requests

ALLOWED_HOSTS = (".cps.golf", ".teesnap.net", "teewire.app")

# curl_cffi impersonation profile. The versionless "chrome" alias tracks the
# newest Chrome fingerprint the installed curl_cffi build supports. Cloudflare
# allowlists current browser fingerprints, so an aging pinned profile (e.g.
# "chrome124") gets challenged while "chrome" is accepted — keep curl_cffi
# reasonably fresh (see requirements.txt) and redeploy when poll_log starts
# logging "blocked by Cloudflare challenge" again. If the primary profile is
# challenged, fall back to a different vendor fingerprint before giving up.
PRIMARY_PROFILE = "chrome"
FALLBACK_PROFILE = "safari17_0"

UPSTREAM_TIMEOUT = 10  # seconds; the Lambda itself has a 15s ceiling


def _is_cf_challenge(status, headers, body):
    """Detect a Cloudflare managed-challenge interstitial."""
    if str(headers.get("cf-mitigated", "")).lower() == "challenge":
        return True
    return status == 403 and (
        "Just a moment" in body or "challenges.cloudflare.com" in body
    )


def _lower_headers(headers):
    """Lowercase header keys so callers can look them up case-insensitively
    (matches the previous undici `headers.entries()` contract)."""
    return {str(k).lower(): v for k, v in headers.items()}


def _request(profile, url, method, headers, body):
    return requests.request(
        method,
        url,
        headers=headers,
        data=body,
        impersonate=profile,
        timeout=UPSTREAM_TIMEOUT,
    )


def _parse_event_body(event):
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    return json.loads(raw)


def handler(event, _context):
    try:
        req = _parse_event_body(event)
        url = req["url"]
        method = req.get("method", "GET")
        headers = req.get("headers", {})
        body = req.get("body")

        hostname = urlparse(url).hostname or ""
        if not any(hostname.endswith(suffix) for suffix in ALLOWED_HOSTS):
            return {
                "statusCode": 403,
                "body": json.dumps(
                    {"proxyError": True, "message": f"Host not allowed: {hostname}", "url": url}
                ),
            }

        resp = _request(PRIMARY_PROFILE, url, method, headers, body)
        resp_headers = _lower_headers(resp.headers)

        # If the trusted fingerprint has aged out of Cloudflare's allowlist the
        # primary profile gets challenged; try one alternate vendor fingerprint
        # before surfacing the block to the caller.
        if _is_cf_challenge(resp.status_code, resp_headers, resp.text):
            resp = _request(FALLBACK_PROFILE, url, method, headers, body)
            resp_headers = _lower_headers(resp.headers)

        return {
            "statusCode": 200,
            "headers": {"content-type": "application/json"},
            "body": json.dumps(
                {"status": resp.status_code, "headers": resp_headers, "body": resp.text}
            ),
        }
    except Exception as err:  # noqa: BLE001 — the proxy must always answer its caller
        url = "unknown"
        try:
            url = _parse_event_body(event).get("url", "unknown")
        except Exception:
            pass
        return {
            "statusCode": 200,
            "headers": {"content-type": "application/json"},
            "body": json.dumps({"proxyError": True, "message": str(err), "url": url}),
        }
