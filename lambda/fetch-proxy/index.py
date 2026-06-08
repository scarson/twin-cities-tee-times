# ABOUTME: HTTPS forward proxy for AWS Lambda that supplies a browser TLS fingerprint (curl_cffi).
# ABOUTME: CPS Golf fronts its reservation API with a Cloudflare bot-challenge only a trusted fingerprint clears.
import base64
import json
import time
from urllib.parse import urlparse

from curl_cffi import requests

from challenge import PROFILES, is_cf_challenge

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

# Per-upstream-attempt timeout, and the total upstream budget across the
# profile cascade (challenge.PROFILES). TOTAL_BUDGET stays under the Worker's
# 12s client abort (proxy-fetch.ts) and the Lambda's 15s ceiling, so each
# fallback is bounded by remaining time rather than blindly adding a full 10s.
UPSTREAM_TIMEOUT = 10
TOTAL_BUDGET = 11


def _host_allowed(hostname):
    return any(
        hostname == apex or hostname.endswith("." + apex) for apex in ALLOWED_HOSTS
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

        # Cascade over installed impersonation profiles: stop at the first that
        # is NOT challenged (a cleared origin response — including a non-2xx
        # origin error, which no fingerprint change would fix). If every profile
        # is challenged the trusted fingerprints have all aged out; return the
        # last (challenged) response so the adapter's canary surfaces it. Every
        # attempt — including the first — is time-bounded by the remaining
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
