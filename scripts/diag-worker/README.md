# CPS Golf 525 Diagnostic Worker

Standalone Worker for diagnosing the HTTP 525 SSL Handshake error
when calling CPS Golf from Cloudflare Workers.

## Deploy

```bash
cd scripts/diag-worker
npx wrangler deploy
```

Deploys to: `https://cps-diag.<subdomain>.workers.dev/`

## Usage

Visit the URL in your browser. Returns JSON with results for:
- CPS Golf SD (jcgsc5) token request
- CPS Golf TC (Theodore Wirth) token request
- CPS Golf TC (Phalen) token request
- ForeUp (control — known working)
- TeeItUp (control — known working)
- CPS Golf with cache bypass

## Cleanup

```bash
npx wrangler delete --name cps-diag
```
