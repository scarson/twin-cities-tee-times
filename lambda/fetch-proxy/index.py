# ABOUTME: HTTPS forward proxy for AWS Lambda that supplies a browser TLS fingerprint (curl_cffi).
# ABOUTME: CPS Golf fronts its reservation API with a Cloudflare bot-challenge only a trusted fingerprint clears.
import base64
import json
import time
from urllib.parse import urlparse

from curl_cffi import requests

# Hostnames the proxy may reach. A host matches an entry when it equals the
# entry's apex or is a subdomain of it — never merely ends with the string
# (which would let an attacker-registered "evilteewire.app" through).
ALLOWED_HOSTS = ("cps.golf", "teesnap.net", "teewire.app")

# Request headers the upstream HTTP client must own; forwarding the caller's
# copies corrupts the body (stale content-length) or weakens the impersonated
# fingerprint (accept-encoding / connection / host).
STRIP_REQUEST_HEADERS = frozenset(
    {"host", "content-length", "connection", "accept-encoding", "transfer-encoding"}
)

# Response headers that describe the pre-decompression body. curl_cffi returns
# an already-decompressed body, so forwarding these would misdescribe it.
STRIP_RESPONSE_HEADERS = frozenset({"content-encoding", "content-length"})

# curl_cffi impersonation profile. The versionless "chrome" alias tracks the
# newest Chrome fingerprint the installed curl_cffi build supports. Cloudflare
# allowlists current browser fingerprints, so an aging pinned profile (e.g.
# "chrome124") gets challenged while "chrome" is accepted — keep curl_cffi
# reasonably fresh (see requirements.txt) and redeploy when poll_log starts
# logging "blocked by Cloudflare challenge" again. If the primary profile is
# challenged, fall back to a different vendor fingerprint before giving up.
PRIMARY_PROFILE = "chrome"
FALLBACK_PROFILE = "safari17_0"

# Per-upstream-attempt timeout, and the total upstream budget across the
# primary + one challenge fallback. TOTAL_BUDGET stays under the Worker's 12s
# client abort (proxy-fetch.ts) and the Lambda's 15s ceiling, so the fallback
# is bounded by remaining time rather than blindly adding a second full 10s.
UPSTREAM_TIMEOUT = 10
TOTAL_BUDGET = 11


def _host_allowed(hostname):
    return any(
        hostname == apex or hostname.endswith("." + apex) for apex in ALLOWED_HOSTS
    )


def _is_cf_challenge(status, headers, body):
    """Detect a Cloudflare managed-challenge interstitial (mirrors the adapter's
    classifier in src/adapters/cps-golf.ts)."""
    if str(headers.get("cf-mitigated", "")).lower() == "challenge":
        return True
    return status == 403 and any(
        marker in body
        for marker in ("Just a moment", "challenges.cloudflare.com", "cdn-cgi/challenge-platform", "__cf_chl")
    )


def _clean_request_headers(headers):
    return {k: v for k, v in headers.items() if k.lower() not in STRIP_REQUEST_HEADERS}


def _response_headers(headers):
    """Lowercase keys (matches the previous undici `headers.entries()` contract
    the Worker relies on) and drop headers that describe the compressed body."""
    return {
        str(k).lower(): v
        for k, v in headers.items()
        if str(k).lower() not in STRIP_RESPONSE_HEADERS
    }


def _request(profile, url, method, headers, body, timeout=UPSTREAM_TIMEOUT):
    return requests.request(
        method,
        url,
        headers=headers,
        data=body,
        impersonate=profile,
        timeout=timeout,
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
        headers = _clean_request_headers(req.get("headers", {}))
        body = req.get("body")

        hostname = urlparse(url).hostname or ""
        if not _host_allowed(hostname):
            return {
                "statusCode": 403,
                "body": json.dumps(
                    {"proxyError": True, "message": f"Host not allowed: {hostname}", "url": url}
                ),
            }

        start = time.monotonic()
        resp = _request(PRIMARY_PROFILE, url, method, headers, body)
        resp_headers = _response_headers(resp.headers)

        # If the trusted fingerprint has aged out of Cloudflare's allowlist the
        # primary profile gets challenged; try one alternate vendor fingerprint
        # with whatever time is left before the caller aborts, then surface the
        # block (the adapter classifies it as a distinct error either way).
        if _is_cf_challenge(resp.status_code, resp_headers, resp.text):
            remaining = TOTAL_BUDGET - (time.monotonic() - start)
            if remaining >= 2:
                resp = _request(
                    FALLBACK_PROFILE, url, method, headers, body,
                    timeout=min(UPSTREAM_TIMEOUT, remaining),
                )
                resp_headers = _response_headers(resp.headers)

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
