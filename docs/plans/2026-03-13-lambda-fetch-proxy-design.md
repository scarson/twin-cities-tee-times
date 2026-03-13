# Lambda Fetch Proxy Design

## Problem

Cloudflare Workers cannot reach CPS Golf's API due to HTTP 525 (SSL Handshake Failed). The failure is caused by CPS Golf's F5 BIG-IP load balancer rejecting TLS connections from Cloudflare's workerd/BoringSSL runtime. This affects all 13 CPS Golf courses in the Twin Cities catalog — the majority of the platform.

**Verified through systematic testing:**

| Provider | CPS Golf | ForeUp | TeeItUp |
|----------|---------|--------|---------|
| Local (Node.js/OpenSSL) | Works | Works | Works |
| CF Worker (workers.dev) | **525** | Works | Works |
| CF Worker (custom domain) | **525** | Works | Works |
| AWS Lambda (Node.js/OpenSSL) | **Works** | Works | Works |

Root cause: Cloudflare Workers' BoringSSL TLS fingerprint (JA3/JA4) is rejected by CPS Golf's F5 BIG-IP. This is a platform-level constraint — Workers provide no control over outbound TLS cipher suites, protocol version, or client fingerprint.

See `dev/research/production-debugging-2026-03-11.md` for the full investigation.

## Solution

A generic HTTPS forward proxy deployed as an AWS Lambda function. The Cloudflare Worker routes CPS Golf requests through the Lambda, which makes the request using Node.js's OpenSSL stack (accepted by CPS) and returns the response.

## Architecture

```
Cloudflare Worker                    AWS Lambda (us-west-2)
┌─────────────┐                     ┌───────────────────┐
│ CPS Adapter │──SigV4-signed POST──│ tee-times-fetch-  │──fetch──▶ *.cps.golf
│ proxyFetch()│◀─────JSON response──│ proxy             │◀────────
└─────────────┘                     └───────────────────┘
       │
       │ direct fetch (no proxy)
       ▼
  ForeUp / TeeItUp APIs
```

Only CPS Golf traffic goes through Lambda. ForeUp and TeeItUp continue making direct requests from the Worker.

## Lambda Proxy

A minimal Node.js 22 function (~30 lines) with a Function URL.

**Request (Worker → Lambda):**
```json
{
  "url": "https://jcgsc5.cps.golf/identityapi/myconnect/token/short",
  "method": "POST",
  "headers": {"Content-Type": "application/x-www-form-urlencoded"},
  "body": "client_id=onlinereswebshortlived"
}
```

**Response (Lambda → Worker):**
```json
{
  "status": 200,
  "headers": {"content-type": "application/json; charset=utf-8"},
  "body": "{\"access_token\":\"eyJ...\"}"
}
```

**Error (Lambda internal failure):**
```json
{
  "proxyError": true,
  "message": "Upstream request timed out after 10s",
  "url": "https://jcgsc5.cps.golf/..."
}
```

The `proxyError` field lets the Worker distinguish "Lambda itself failed" from "CPS returned an HTTP error" for logging purposes.

### Domain Allowlist

The Lambda validates that the target URL hostname matches an allowlist before forwarding:

```js
const ALLOWED_HOSTS = [".cps.golf"];
```

Requests to non-allowed hosts are rejected with 403. This prevents the proxy from being used as an open relay even if credentials are compromised.

### Timeout Layering

Three network hops require explicit timeout management:

| Hop | Timeout | Purpose |
|-----|---------|---------|
| Lambda → CPS Golf | 10s | Matches current adapter behavior |
| Worker → Lambda | 12s | 2s buffer for Lambda overhead |
| Lambda function (AWS) | 15s | Hard ceiling, catches everything |

`proxyFetch` sets its own 12s timeout on the Lambda call, overriding any `signal` from the adapter's original request.

## Authentication

The Lambda Function URL uses `AuthType: AWS_IAM`. The Worker signs requests using AWS SigV4 via the `aws4fetch` library (designed for Cloudflare Workers, uses Web Crypto APIs).

**IAM user for the Worker** — dedicated, least-privilege:
```json
{
  "Effect": "Allow",
  "Action": "lambda:InvokeFunctionUrl",
  "Resource": "arn:aws:lambda:us-west-2:<ACCOUNT>:function:tee-times-fetch-proxy"
}
```

**Worker secrets:** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (stored via `wrangler secret put`).

Benefits over Bearer token auth:
- Unauthenticated requests are rejected by AWS before invocation (no billing)
- IAM audit trail via CloudTrail
- Credentials are scoped to a single Lambda function

## Billing Protection

Defense in depth against abuse:

1. **IAM auth** — unsigned requests rejected before invocation, no billing
2. **Reserved concurrency: 5** — hard cap on simultaneous executions, even with valid credentials
3. **Domain allowlist** — proxy only forwards to `*.cps.golf`

Worst-case billing with valid credentials and reserved concurrency of 5: ~$4/month sustained 24/7. Realistic legitimate usage: ~4,000 invocations/day, well within free tier.

## Worker Integration

### PlatformAdapter Interface Change

Add optional `env` parameter:
```typescript
interface PlatformAdapter {
  platformId: string;
  fetchTeeTimes(config: CourseConfig, date: string, env?: CloudflareEnv): Promise<TeeTime[]>;
}
```

ForeUp and TeeItUp ignore the parameter. CPS adapter uses it for proxy config.

### proxyFetch Module

New `src/lib/proxy-fetch.ts` (~40 lines):
- Takes a request description (url, method, headers, body) + proxy config (url, AWS credentials)
- Signs the request with SigV4 via `aws4fetch`
- POSTs to Lambda Function URL
- Deserializes the response back into a standard-looking object
- Handles `proxyError` responses by throwing descriptive errors
- Sets 12s timeout on the Lambda call

### CPS Adapter Changes

Minimal. Replace three `fetch()` calls with `proxyFetch()` when `env?.FETCH_PROXY_URL` is set:
- `getToken()` — token endpoint
- `registerTransaction()` — transaction registration
- `fetchTeeTimes()` — tee times query

When `FETCH_PROXY_URL` is not set (local dev, tests), requests go direct.

### Env Bindings

New bindings in `env.d.ts`:
```typescript
interface CloudflareEnv {
  // ... existing bindings ...
  FETCH_PROXY_URL?: string;     // Lambda Function URL
  AWS_ACCESS_KEY_ID?: string;   // IAM user for SigV4
  AWS_SECRET_ACCESS_KEY?: string;
}
```

All optional — the proxy is opt-in. Without these bindings, CPS makes direct requests (which fail with 525 in production, but work locally).

## AWS Infrastructure

### Lambda Configuration

- **Name:** `tee-times-fetch-proxy`
- **Runtime:** Node.js 22 (`nodejs22.x`)
- **Memory:** 128MB (Lambda minimum)
- **Timeout:** 15s
- **Region:** us-west-2 (close to CPS Golf's GCP us-west1)
- **Reserved concurrency:** 5
- **Function URL:** enabled, `AuthType: AWS_IAM`

### IAM Resources

**OIDC Identity Provider** (for GitHub Actions deploy):
- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

**Deploy role** (`github-actions-tee-times-deploy`):
- Trust: only `repo:scarson/twin-cities-tee-times:ref:refs/heads/main`
- Permissions:
  - `lambda:UpdateFunctionCode`
  - `lambda:UpdateFunctionConfiguration`
  - `lambda:GetFunction`
  - `lambda:CreateFunction`
  - `lambda:GetFunctionConfiguration`
  - `lambda:PutFunctionConcurrency`
  - Scoped to `arn:aws:lambda:us-west-2:<ACCOUNT>:function:tee-times-fetch-proxy`

**Invoker user** (for Cloudflare Worker):
- `lambda:InvokeFunctionUrl` on the proxy function only

### One-Time Manual Setup

1. Create OIDC identity provider in IAM
2. Create deploy role with trust policy and permissions
3. Create invoker IAM user, generate access keys
4. Create Lambda function (first deploy can also be done via CI)
5. Store Lambda Function URL as CF secret (`FETCH_PROXY_URL`)
6. Store invoker credentials as CF secrets (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
7. Store deploy role ARN as GitHub secret (`AWS_ROLE_ARN`)

## GitHub Actions CI/CD

### Deploy Workflow Changes

New steps added to `.github/workflows/deploy.yml` before "Deploy Worker":

```yaml
- name: Configure AWS credentials
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-arn: ${{ secrets.AWS_ROLE_ARN }}
    aws-region: us-west-2

- name: Deploy Lambda proxy
  uses: aws-actions/aws-lambda-deploy@v1
  with:
    function-name: tee-times-fetch-proxy
    code-artifacts-dir: lambda/fetch-proxy
    handler: index.handler
    runtime: nodejs22.x
    timeout: 15
    memory-size: 128
    environment: ''  # no env vars needed with IAM auth
```

**Permissions:** Add `id-token: write` to the workflow permissions block (required for OIDC).

**Deploy order:** Lambda deploys before Worker (Worker depends on Lambda being available).

### CI Workflow

No changes. The Lambda is a single `.mjs` file with no dependencies. It gets exercised indirectly through `proxyFetch` unit tests.

## File Layout

```
lambda/
  fetch-proxy/
    index.mjs           # Lambda handler (~30 lines)
src/
  lib/
    proxy-fetch.ts      # SigV4-signed proxy fetch helper
    proxy-fetch.test.ts # Unit tests
  adapters/
    cps-golf.ts         # Modified: use proxyFetch when env has proxy config
  types/
    index.ts            # Modified: add env param to PlatformAdapter
```

## Observability

The Lambda is a dumb pipe. All logging flows through the existing Worker → D1 `poll_log` path:

- **CPS returns error:** Worker sees HTTP error in adapter → logged as `error` with CPS's error message
- **Lambda proxy fails:** Worker sees `proxyError: true` → logged as `error` with "Proxy: <message>"
- **Lambda unreachable:** Worker `fetch()` throws → logged as `error` with network error message

No logs need to be collected from Lambda/CloudWatch. All observability stays in D1.

## Cleanup

This PR also:
- Restores custom domain route in `wrangler.jsonc`
- Removes diagnostic scripts (`scripts/diag-worker/`, `scripts/diag-cps-tls.ts`, `scripts/diag-cps-lambda.mjs`, `scripts/diag-cps-lambda.zip`)
- Keeps `dev/research/production-debugging-2026-03-11.md` (investigation findings)

## Dependencies

One new npm dependency: `aws4fetch` (SigV4 signing for Workers).
