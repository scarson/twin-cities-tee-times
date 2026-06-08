# CPS Golf v5 polling break — root cause and fix (2026-06-08)

**Status:** Fixed (PR to `dev`). Live-verified.
**Symptom:** All ~13 CPS Golf "v5" courses failed every poll with `CPS Golf transaction registration failed` — ~42k errors over the 7-day `poll_log` window, uniform across every v5 facility, zero successful CPS data, continuous since at least 2026-06-01.

---

## TL;DR

CPS moved its v5 reservation API (`/onlineres/onlineapi/*`) behind **Cloudflare Bot Management with a managed challenge**. Every headless call returns a 403 "Just a moment…" interstitial (`cf-mitigated: challenge`). The challenge is **fingerprint-gated, not JS-gated**: a request carrying a real browser TLS fingerprint (JA3/JA4 + HTTP/2 frame order) passes silently; Node `fetch`/undici and plain Python `requests` do not, regardless of headers or IP.

Fix: the AWS Lambda fetch-proxy was rewritten Node → Python + `curl_cffi` so it sends a Chrome TLS fingerprint (`impersonate="chrome"`, fallback `"safari17_0"`). The CPS adapter now classifies the challenge and throws a distinct error so `poll_log`/`check-logs` flags it. Live-verified: chaska 16 / phalen 61 real tee times through the proxy.

---

## Investigation chain (how we got to the root cause)

1. **Localized the break to the registration step, not auth.** `poll_log` showed the dominant error was `transaction registration failed`; the `token request failed` errors were a handful of transient 503 blips. So token acquisition (`/identityapi/`) succeeds; the *first reservation call* fails.

2. **The failure partitions perfectly by auth path, not geography.** Production D1 + `poll_log`:
   - **v5 path** (no `authType`): chaska, como, phalen, highland-9/national, pioneer-creek, theodore-wirth, columbia, gross-national, hiawatha, hidden-haven, meadowbrook, **victory-links** → thousands of registration errors each.
   - **v4 path** (`authType: v4`): edinburgh, brookview, gem, oak-glen → **zero** registration errors (only transient proxy timeouts).
   - `victory-links` was `v4` in `courses.json` but `null` in production D1 — `checkV4Upgrades` had already flipped it to v5, and it then failed.

3. **Direct live probe revealed the challenge.** Hitting `RegisterTransactionId` from a residential IP returned `403 server=cloudflare cf-mitigated=challenge`, body = `<title>Just a moment…</title>` (markers `_cf_chl_opt`, `cType:'managed'`, `/cdn-cgi/challenge-platform`). A per-facility sweep:
   - v5 (chaska, phalen, theodore-wirth, victorylinksmn, **jcgsc5 SD**): `403 server=cloudflare cf-mitigated=challenge`.
   - v4 (edinburghusa, brookview, gem, oakglen): `400 server=hide` "Invalid componentid request header" — the **real CPS origin** rejecting deliberately-incomplete headers.
   - The token endpoint (`/identityapi/`) returns 200 for everyone — not behind the challenge.

4. **Refuted the task's SD-vs-MN hypothesis.** SD `jcgsc5` is challenged *identically* to MN v5 facilities. The real split is **v4-legacy-origin (`server: hide`, no Cloudflare) vs v5-Cloudflare-fronted**. SD courses only "worked" earlier because the challenge had not yet been enabled.

5. **Proved the challenge is fingerprint-gated, not JS-gated.** `curl_cffi` with `impersonate="chrome"` (and `"safari17_0"`) returned `200 body=true` on `RegisterTransactionId` and real tee-time data on `TeeTimes`; `impersonate=None` and pinned `chrome124`/`chrome131` got the 403 challenge. So a current browser TLS fingerprint clears it — no JS execution / `cf_clearance` cookie needed.

---

## Considered and ruled out

- **Header / User-Agent spoofing** — does nothing. The challenge fingerprints the TLS handshake, not headers. The earlier diagnostic and an adversarial reviewer both tried full browser client-hints and still got 403; that is why this looked unfixable at first.
- **An API-key bypass** (the v4 `x-apikey`) — the challenge fires at the Cloudflare edge *before* origin auth, so no application credential can satisfy it. The v4 `x-apikey` "works" only because v4 facilities aren't behind Cloudflare at all.
- **Headless browser / FlareSolverr / `cf_clearance` replay** — heavyweight, slow cold starts, fragile. Unnecessary because the challenge is fingerprint-gated, so a lightweight TLS-impersonating client suffices. (Would only be needed if the challenge were truly JS-gated.)
- **A managed unblocker API** (ScraperAPI/ZenRows) — ongoing per-request cost, a third party sees our traffic, new external dependency. Rejected in favor of `curl_cffi` in our own proxy.
- **Treating registration as optional** (the v4 404-tolerant trick) — does not help: the *entire* reservation path is challenged (`TeeTimes`, `GetAllOptions`, everything under `/onlineres/`), so skipping registration just moves the 403 to the next call.

---

## The fix

1. **Proxy (`lambda/fetch-proxy/index.py`):** rewritten Node → Python + `curl_cffi`. Sends `impersonate="chrome"`, retries once with `"safari17_0"` (time-bounded) if a challenge is detected. Hardened during review: apex/subdomain allowlist matching (closed an SSRF hole), transport-header stripping to protect the fingerprint, and dropping `content-encoding`/`content-length` from the decompressed response. Response contract (`{status, lowercased headers, body}` / `proxyError`) is preserved.
2. **Deploy (`.github/workflows/deploy.yml`):** runtime `nodejs24.x` → `python3.14`, memory 128 → 256 MB, plus a vendoring step that cross-targets manylinux x86_64 cp314 wheels (`curl_cffi` cp310-abi3 + `cffi` cp314). Deps are vendored at deploy time, not committed.
3. **Canary (`src/adapters/cps-golf.ts`):** `doFetch` classifies the challenge (`cf-mitigated: challenge` or body signature); token, registration (v5 + v4), and TeeTimes all throw a distinct `blocked by Cloudflare challenge` error — the early-warning that the impersonation profile has aged out.

See `docs/pitfalls/implementation-pitfalls.md` DEPLOY-2 for the read-before-you-code summary and the rotation runbook.

---

## Maintenance tail (must know)

Cloudflare allowlists **current** browser fingerprints, so the impersonation profile will eventually age out (pinned `chrome124`/`chrome131` already get challenged today; the versionless `chrome` alias passes). When `poll_log` starts logging "blocked by Cloudflare challenge" again: **bump `curl_cffi` in `lambda/fetch-proxy/requirements.txt` and redeploy.** This is not set-and-forget.

## Open items for the human

- **IAM precondition (verify before/at first deploy):** the runtime flip `nodejs24.x → python3.14` makes `aws-lambda-deploy` call `UpdateFunctionConfiguration`. The `AWS_DEPLOY_ROLE_ARN` role must hold `lambda:UpdateFunctionConfiguration` + `lambda:GetFunctionConfiguration` (not just `UpdateFunctionCode`), or CI goes green while the Lambda silently runs Python under the Node runtime.
- **`checkV4Upgrades` caveat (accepted, documented):** it promotes v4→v5 on a token-endpoint-200, which proves the v5 identity service exists but not that the (Cloudflare-fronted) reservation API is reachable. If the profile ages out, a promoted course fails with the challenge error until the profile is refreshed; promotion is not auto-reverted. The canary surfaces it. The v4 population is small and promotion is gated on CPS migrating a facility, so this was accepted rather than gating promotion on a full proxied reservation probe.

## Dependency

The D1 write-amplification dedup (`upsertTeeTimes` compare-then-replace, PR #119) is live on `main`, so the resumed CPS writes are absorbed without re-introducing the write-amplification bill. Watch the post-deploy write rate as the ~13 v5 courses come back online.
