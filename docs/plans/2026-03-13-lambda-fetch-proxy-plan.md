# Lambda Fetch Proxy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Route CPS Golf API requests through an AWS Lambda proxy to bypass Cloudflare Workers' TLS fingerprint rejection (HTTP 525).

**Architecture:** Generic HTTPS forward proxy on AWS Lambda with IAM SigV4 auth. Worker signs requests via `aws4fetch`, Lambda forwards to `*.cps.golf`, responses flow back through the Worker's existing `poll_log` observability path.

**Tech Stack:** AWS Lambda (Node.js 22), `aws4fetch` (SigV4 signing), GitHub Actions with OIDC federation (`aws-actions/configure-aws-credentials` + `aws-actions/aws-lambda-deploy`).

**Design doc:** `docs/plans/2026-03-13-lambda-fetch-proxy-design.md`

---

### Task 1: Install `aws4fetch` dependency

**Files:**
- Modify: `package.json`

**Step 1: Install the package**

Run: `npm install aws4fetch`

**Step 2: Verify installation**

Run: `npm ls aws4fetch`
Expected: `aws4fetch@x.x.x` listed

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add aws4fetch for SigV4 Lambda proxy signing"
```

---

### Task 2: Create the Lambda function

**Files:**
- Create: `lambda/fetch-proxy/index.mjs`

> **No test for this file.** This is a standalone `.mjs` file that runs on the AWS Lambda Node.js 22 runtime — it's outside our vitest scope and has no project dependencies. It gets exercised indirectly through `proxyFetch` unit tests (Task 3) and integration verification (Task 10). **Do NOT create a test file for it.**

**Step 1: Create the directory and write the Lambda handler**

Run: `mkdir -p lambda/fetch-proxy`

Then write `lambda/fetch-proxy/index.mjs`:

```javascript
// ABOUTME: Generic HTTPS forward proxy for AWS Lambda.
// ABOUTME: Validates domain allowlist, forwards requests, returns structured responses.
const ALLOWED_HOSTS = [".cps.golf"];

export const handler = async (event) => {
  try {
    const { url, method = "GET", headers = {}, body } = JSON.parse(event.body);

    const hostname = new URL(url).hostname;
    if (!ALLOWED_HOSTS.some((suffix) => hostname.endsWith(suffix))) {
      return {
        statusCode: 403,
        body: JSON.stringify({ proxyError: true, message: `Host not allowed: ${hostname}`, url }),
      };
    }

    const upstream = await fetch(url, {
      method,
      headers,
      body: body ?? undefined,
      signal: AbortSignal.timeout(10000),
    });

    const respBody = await upstream.text();
    const respHeaders = Object.fromEntries(upstream.headers.entries());

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: upstream.status, headers: respHeaders, body: respBody }),
    };
  } catch (err) {
    const parsed = (() => { try { return JSON.parse(event.body); } catch { return {}; } })();
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proxyError: true,
        message: err.message ?? String(err),
        url: parsed.url ?? "unknown",
      }),
    };
  }
};
```

**Step 2: Commit**

```bash
git add lambda/fetch-proxy/index.mjs
git commit -m "feat: add Lambda fetch proxy handler with domain allowlist"
```

---

### Task 3: Write `proxyFetch` — failing tests first

**Files:**
- Create: `src/lib/proxy-fetch.test.ts`
- Create: `src/lib/proxy-fetch.ts`

**Step 1: Write the failing tests**

```typescript
// ABOUTME: Tests for the SigV4-signed Lambda proxy fetch helper.
// ABOUTME: Covers request signing, response deserialization, proxy errors, and fallback.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { proxyFetch } from "./proxy-fetch";

// Mock aws4fetch
vi.mock("aws4fetch", () => ({
  AwsClient: vi.fn().mockImplementation(() => ({
    fetch: vi.fn(),
  })),
}));

import { AwsClient } from "aws4fetch";

const proxyConfig = {
  proxyUrl: "https://abc123.lambda-url.us-west-2.on.aws/",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

describe("proxyFetch", () => {
  let mockAwsFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAwsFetch = vi.fn();
    vi.mocked(AwsClient).mockImplementation(() => ({ fetch: mockAwsFetch }) as any);
  });

  it("sends signed POST to Lambda with request description", async () => {
    mockAwsFetch.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, headers: {}, body: '{"ok":true}' }))
    );

    const result = await proxyFetch(
      { url: "https://test.cps.golf/api", method: "GET", headers: { "x-test": "1" } },
      proxyConfig
    );

    expect(mockAwsFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockAwsFetch.mock.calls[0];
    expect(url).toBe(proxyConfig.proxyUrl);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      url: "https://test.cps.golf/api",
      method: "GET",
      headers: { "x-test": "1" },
    });

    expect(result.status).toBe(200);
    expect(result.body).toBe('{"ok":true}');
  });

  it("includes body in request description when provided", async () => {
    mockAwsFetch.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, headers: {}, body: "" }))
    );

    await proxyFetch(
      { url: "https://x.cps.golf/token", method: "POST", headers: {}, body: "client_id=foo" },
      proxyConfig
    );

    const sent = JSON.parse(mockAwsFetch.mock.calls[0][1].body);
    expect(sent.body).toBe("client_id=foo");
  });

  it("throws on proxyError response", async () => {
    mockAwsFetch.mockResolvedValue(
      new Response(JSON.stringify({ proxyError: true, message: "Host not allowed", url: "https://evil.com" }))
    );

    await expect(
      proxyFetch({ url: "https://evil.com", method: "GET", headers: {} }, proxyConfig)
    ).rejects.toThrow("Proxy: Host not allowed");
  });

  it("throws when Lambda returns non-OK HTTP status", async () => {
    mockAwsFetch.mockResolvedValue(new Response("Forbidden", { status: 403 }));

    await expect(
      proxyFetch({ url: "https://x.cps.golf/api", method: "GET", headers: {} }, proxyConfig)
    ).rejects.toThrow("Proxy HTTP 403");
  });

  it("throws when Lambda fetch fails (network error)", async () => {
    mockAwsFetch.mockRejectedValue(new Error("fetch failed"));

    await expect(
      proxyFetch({ url: "https://x.cps.golf/api", method: "GET", headers: {} }, proxyConfig)
    ).rejects.toThrow("fetch failed");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/proxy-fetch.test.ts`
Expected: FAIL — module `./proxy-fetch` not found

**Step 3: Write the implementation**

> **Design note:** A new `AwsClient` is created on every call. This is intentional — our volume (~12 calls per 5-minute cycle) doesn't justify caching, and per-call construction avoids stale credential bugs. **Do NOT refactor to cache the client.**

```typescript
// ABOUTME: SigV4-signed fetch helper that routes requests through the Lambda proxy.
// ABOUTME: Signs requests with aws4fetch, deserializes proxy responses, handles errors.
import { AwsClient } from "aws4fetch";

export interface ProxyRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface ProxyConfig {
  proxyUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export async function proxyFetch(
  request: ProxyRequest,
  config: ProxyConfig
): Promise<ProxyResponse> {
  const aws = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "lambda",
    region: "us-west-2",
  });

  const payload: Record<string, unknown> = {
    url: request.url,
    method: request.method,
    headers: request.headers,
  };
  if (request.body !== undefined) {
    payload.body = request.body;
  }

  const response = await aws.fetch(config.proxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Proxy HTTP ${response.status}`);
  }

  const data = await response.json() as ProxyResponse & { proxyError?: boolean; message?: string };

  if (data.proxyError) {
    throw new Error(`Proxy: ${data.message}`);
  }

  return { status: data.status, headers: data.headers, body: data.body };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/proxy-fetch.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add src/lib/proxy-fetch.ts src/lib/proxy-fetch.test.ts
git commit -m "feat: add proxyFetch helper with SigV4 signing and tests"
```

---

### Task 4: Add env bindings for proxy config

**Files:**
- Modify: `env.d.ts`

**Step 1: Add the three optional bindings**

In `env.d.ts`, add these three lines after `JWT_SECRET: string;`:

```typescript
  FETCH_PROXY_URL?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
```

The complete file should look like:

```typescript
// ABOUTME: Cloudflare Workers environment bindings declaration.
// ABOUTME: Augments CloudflareEnv with DB, secrets, and OAuth credentials.
interface CloudflareEnv {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  JWT_SECRET: string;
  FETCH_PROXY_URL?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
}
```

> **Do NOT modify `src/test/d1-mock.ts`** — `createMockEnv()` doesn't need these optional fields. When proxy env vars are absent, adapters fall back to direct fetch, which is the correct test behavior.

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add env.d.ts
git commit -m "feat: add FETCH_PROXY_URL and AWS credential env bindings"
```

---

### Task 5: Thread `env` through PlatformAdapter → poller → cron-handler

This is the plumbing task. We need `env` to flow from `worker.ts` → `runCronPoll` → `pollCourse` → `adapter.fetchTeeTimes`, and similarly from the refresh route.

**Files:**
- Modify: `src/types/index.ts` (PlatformAdapter interface)
- Modify: `src/adapters/foreup.ts` (add ignored env param)
- Modify: `src/adapters/teeitup.ts` (add ignored env param)
- Modify: `src/lib/poller.ts` (pollCourse signature + pass env to adapter)
- Modify: `src/lib/cron-handler.ts` (runCronPoll takes env instead of db)
- Modify: `worker.ts` (pass full env instead of env.DB)
- Modify: `src/app/api/courses/[id]/refresh/route.ts` (pass env to pollCourse)
- Modify: `src/lib/cron-handler.test.ts` (update all runCronPoll calls + pollCourse matchers)

**Files that do NOT need changes (and why):**
- `src/lib/poller.test.ts` — `env` param is optional, existing tests omit it, all pass as-is
- `src/adapters/cps-golf.test.ts` — `env` param is optional, existing tests omit it, all pass as-is
- `src/app/api/courses/[id]/refresh/route.test.ts` — `pollCourse` is fully mocked; the mock doesn't care about the new 4th arg

**Step 1: Update PlatformAdapter interface**

In `src/types/index.ts`, change:
```typescript
  fetchTeeTimes(config: CourseConfig, date: string): Promise<TeeTime[]>;
```
to:
```typescript
  fetchTeeTimes(config: CourseConfig, date: string, env?: CloudflareEnv): Promise<TeeTime[]>;
```

**Step 2: Update ForeUp adapter signature**

In `src/adapters/foreup.ts`, change:
```typescript
  async fetchTeeTimes(
    config: CourseConfig,
    date: string
  ): Promise<TeeTime[]> {
```
to:
```typescript
  async fetchTeeTimes(
    config: CourseConfig,
    date: string,
    _env?: CloudflareEnv
  ): Promise<TeeTime[]> {
```

**Step 3: Update TeeItUp adapter signature**

In `src/adapters/teeitup.ts`, change:
```typescript
  async fetchTeeTimes(
    config: CourseConfig,
    date: string
  ): Promise<TeeTime[]> {
```
to:
```typescript
  async fetchTeeTimes(
    config: CourseConfig,
    date: string,
    _env?: CloudflareEnv
  ): Promise<TeeTime[]> {
```

**Step 4: Update `pollCourse` signature and adapter call**

In `src/lib/poller.ts`, change the function signature:
```typescript
export async function pollCourse(
  db: D1Database,
  course: CourseRow,
  date: string
): Promise<"success" | "no_data" | "error"> {
```
to:
```typescript
export async function pollCourse(
  db: D1Database,
  course: CourseRow,
  date: string,
  env?: CloudflareEnv
): Promise<"success" | "no_data" | "error"> {
```

And change the adapter call (currently `const teeTimes = await adapter.fetchTeeTimes(config, date);`) to:
```typescript
    const teeTimes = await adapter.fetchTeeTimes(config, date, env);
```

**Step 5: Update `runCronPoll` signature**

In `src/lib/cron-handler.ts`, change the signature:
```typescript
export async function runCronPoll(db: D1Database): Promise<{
```
to:
```typescript
export async function runCronPoll(env: CloudflareEnv): Promise<{
```

Add `const db = env.DB;` immediately AFTER the `shouldRunThisCycle` early return check. Specifically, insert it as the first line inside the `try` block. The code should look like:

```typescript
  if (!shouldRunThisCycle(now)) {
    return { pollCount: 0, courseCount: 0, inactiveProbeCount: 0, skipped: true };
  }

  try {
    const db = env.DB;
    // Fetch ALL courses (active and inactive)
    const coursesResult = await db
```

Then update BOTH `pollCourse` calls to pass `env`:
- Find `await pollCourse(db, course, dates[i])` → change to `await pollCourse(db, course, dates[i], env)`
- Find `await pollCourse(db, course, date)` → change to `await pollCourse(db, course, date, env)`

There are exactly 2 occurrences of `pollCourse(db, course,` in this file. Change both.

**Step 6: Update `worker.ts`**

Change:
```typescript
    ctx.waitUntil(runCronPoll(env.DB));
```
to:
```typescript
    ctx.waitUntil(runCronPoll(env));
```

**Step 7: Update refresh route**

In `src/app/api/courses/[id]/refresh/route.ts`, change:
```typescript
    const result = await pollCourse(db, course, date);
```
to:
```typescript
    const result = await pollCourse(db, course, date, env);
```

**Step 8: Update `src/lib/cron-handler.test.ts`**

This file EXISTS and requires multiple changes. The changes fall into two categories:

**Category A — `runCronPoll` call signature**: Every call to `runCronPoll(mockDb as unknown as D1Database)` must change to pass a mock env object instead of a mock db. There are two patterns:

Pattern 1 — tests using the simple `mockDb` object (in the "runCronPoll cleanup" describe block):
```typescript
// OLD:
await runCronPoll(mockDb as unknown as D1Database);
// NEW:
await runCronPoll({ DB: mockDb } as unknown as CloudflareEnv);
```

Pattern 2 — tests using `makeMockDb()` (in the "runCronPoll auto-active management" describe block):
```typescript
// OLD:
const db = makeMockDb([...]);
await runCronPoll(db as unknown as D1Database);
// NEW:
const db = makeMockDb([...]);
await runCronPoll({ DB: db } as unknown as CloudflareEnv);
```

**Apply this to ALL `runCronPoll(` calls in the file.** There are approximately 12 calls. Find and replace every one.

**Category B — `pollCourse` argument matchers**: One assertion checks `pollCourse` was called with specific arguments using `toHaveBeenCalledWith`. After this refactor, `pollCourse` now receives 4 arguments (db, course, date, env) instead of 3. `toHaveBeenCalledWith` requires ALL args to match.

Find this assertion (around line 306):
```typescript
    expect(mockedPollCourse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "test-inactive-2" }),
      expect.any(String)
    );
```

Change to:
```typescript
    expect(mockedPollCourse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "test-inactive-2" }),
      expect.any(String),
      expect.anything()
    );
```

**No other test files need changes.** The optional `env` param means existing `pollCourse` and `fetchTeeTimes` calls without `env` still compile and work.

**Step 9: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 10: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 11: Commit**

```bash
git add src/types/index.ts src/lib/poller.ts src/lib/cron-handler.ts worker.ts \
  src/app/api/courses/\[id\]/refresh/route.ts src/adapters/foreup.ts src/adapters/teeitup.ts \
  src/lib/cron-handler.test.ts
git commit -m "refactor: thread env through poller chain for proxy config access"
```

---

### Task 6: Wire CPS adapter to use `proxyFetch`

**Files:**
- Modify: `src/adapters/cps-golf.ts`
- Modify: `src/adapters/cps-golf.test.ts`

**Step 1: Write failing test — CPS adapter uses proxy when env has proxy config**

Add these imports and mock at the TOP of `src/adapters/cps-golf.test.ts` (after the existing imports):

```typescript
import { proxyFetch } from "@/lib/proxy-fetch";

vi.mock("@/lib/proxy-fetch", () => ({
  proxyFetch: vi.fn(),
}));
```

Add this test `describe` block INSIDE the existing outer `describe("CpsGolfAdapter", ...)`, after all existing `it()` blocks:

```typescript
  describe("proxy mode", () => {
    const proxyEnv = {
      DB: {} as any,
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      JWT_SECRET: "",
      FETCH_PROXY_URL: "https://proxy.lambda-url.us-west-2.on.aws/",
      AWS_ACCESS_KEY_ID: "AKID",
      AWS_SECRET_ACCESS_KEY: "SECRET",
    } satisfies CloudflareEnv;

    beforeEach(() => {
      // Must spy on fetch to assert it wasn't called in proxy mode
      vi.spyOn(globalThis, "fetch");

      // Mock the 3-call proxy chain: token → register → tee times
      // These MUST match the adapter's call order exactly
      vi.mocked(proxyFetch)
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          body: JSON.stringify({ access_token: "proxy-token", expires_in: 600 }),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          body: JSON.stringify(true),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          body: JSON.stringify(fixture),
        });
    });

    it("routes all three CPS requests through proxyFetch", async () => {
      const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-12", proxyEnv);

      expect(proxyFetch).toHaveBeenCalledTimes(3);
      expect(fetch).not.toHaveBeenCalled();
      expect(results).toHaveLength(3);
    });

    it("falls back to direct fetch when proxy env is not set", async () => {
      mockCpsFlow(fixture);
      const results = await adapter.fetchTeeTimes(mockConfig, "2026-03-12");

      expect(proxyFetch).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(results).toHaveLength(3);
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/adapters/cps-golf.test.ts`
Expected: FAIL — proxy tests fail because CPS adapter doesn't use proxyFetch yet

**Step 3: Modify the CPS adapter**

In `src/adapters/cps-golf.ts`, make these changes:

**3a. Add import** at the top (after the existing imports):
```typescript
import { proxyFetch, type ProxyConfig } from "@/lib/proxy-fetch";
```

**3b. Update `fetchTeeTimes` signature and add proxy wiring:**
```typescript
  async fetchTeeTimes(
    config: CourseConfig,
    date: string,
    env?: CloudflareEnv
  ): Promise<TeeTime[]> {
    const { subdomain } = config.platformConfig;

    if (!subdomain) {
      throw new Error("Missing subdomain in platformConfig");
    }

    const baseUrl = `https://${subdomain}.cps.golf/onlineres/onlineapi/api/v1/onlinereservation`;
    const timezone = config.platformConfig.timezone ?? "America/Chicago";

    const proxy = this.getProxyConfig(env);
    const token = await this.getToken(subdomain, proxy);
    const headers = this.buildHeaders(config, token, timezone);
    const transactionId = await this.registerTransaction(
      baseUrl,
      token,
      headers,
      proxy
    );

    const searchDate = this.formatCpsDate(date, timezone);

    const params = new URLSearchParams({
      searchDate,
      courseIds: config.platformConfig.courseIds ?? "",
      transactionId,
      holes: "0",
      numberOfPlayer: "0",
      searchTimeType: "0",
      teeOffTimeMin: "0",
      teeOffTimeMax: "23",
      isChangeTeeOffTime: "true",
      teeSheetSearchView: "5",
      classCode: "R",
      defaultOnlineRate: "N",
      isUseCapacityPricing: "false",
      memberStoreId: "1",
      searchType: "1",
    });

    const response = await this.doFetch(`${baseUrl}/TeeTimes?${params}`, {
      method: "GET",
      headers: { ...headers, "x-requestid": crypto.randomUUID() },
    }, proxy);

    if (!response.ok) {
      throw new Error(`CPS Golf API returned HTTP ${response.status}`);
    }

    const data: CpsV5Response = await response.json();

    if (!Array.isArray(data.content)) {
      return [];
    }

    return data.content
      .filter((tt) => tt.maxPlayer > 0)
      .map((tt) => ({
        courseId: config.id,
        time: tt.startTime, // already ISO 8601 from CPS API
        price: this.extractGreenFee(tt.shItemPrices),
        holes: tt.holes === 9 ? 9 : 18,
        openSlots: tt.maxPlayer,
        bookingUrl: config.bookingUrl,
      }));
  }
```

**3c. Replace `getToken` method** (add `proxy` param, use `doFetch`):
```typescript
  private async getToken(subdomain: string, proxy: ProxyConfig | null): Promise<string> {
    const url = `https://${subdomain}.cps.golf/identityapi/myconnect/token/short`;

    const response = await this.doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "client_id=onlinereswebshortlived",
    }, proxy);

    if (!response.ok) {
      throw new Error(
        `CPS Golf token request failed: HTTP ${response.status}`
      );
    }

    const data: { access_token: string } = await response.json();
    return data.access_token;
  }
```

**3d. Replace `registerTransaction` method** (add `proxy` param, use `doFetch`):
```typescript
  private async registerTransaction(
    baseUrl: string,
    token: string,
    headers: Record<string, string>,
    proxy: ProxyConfig | null
  ): Promise<string> {
    const transactionId = crypto.randomUUID();

    const response = await this.doFetch(`${baseUrl}/RegisterTransactionId`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "x-requestid": crypto.randomUUID(),
      },
      body: JSON.stringify({ transactionId }),
    }, proxy);

    if (!response.ok) {
      throw new Error("CPS Golf transaction registration failed");
    }

    const result: boolean = await response.json();
    if (!result) {
      throw new Error("CPS Golf transaction registration failed");
    }

    return transactionId;
  }
```

**3e. Add two new private methods** (place them after `registerTransaction`, before `buildHeaders`):

```typescript
  private getProxyConfig(env?: CloudflareEnv): ProxyConfig | null {
    if (env?.FETCH_PROXY_URL && env?.AWS_ACCESS_KEY_ID && env?.AWS_SECRET_ACCESS_KEY) {
      return {
        proxyUrl: env.FETCH_PROXY_URL,
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      };
    }
    return null;
  }

  /**
   * Fetch via proxy or direct. In proxy mode, the request goes through
   * the Lambda proxy (which has its own 10s upstream timeout). In direct
   * mode, it's a standard fetch with a 10s AbortSignal timeout.
   *
   * The `signal` property from RequestInit is intentionally NOT forwarded
   * to the proxy path — the Lambda proxy has its own timeout layering.
   * Do NOT "fix" this by adding signal support to proxyFetch.
   */
  private async doFetch(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
    proxy: ProxyConfig | null
  ): Promise<{ ok: boolean; status: number; json: () => Promise<any> }> {
    if (proxy) {
      const result = await proxyFetch(
        {
          url,
          method: init.method,
          headers: init.headers,
          body: init.body,
        },
        proxy
      );
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        json: () => Promise.resolve(JSON.parse(result.body)),
      };
    }
    const response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: AbortSignal.timeout(10000),
    });
    return { ok: response.ok, status: response.status, json: () => response.json() };
  }
```

> **Important:** The existing methods `buildHeaders`, `extractGreenFee`, `getTimezoneOffset`, and `formatCpsDate` are UNCHANGED. Do not modify them.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/adapters/cps-golf.test.ts`
Expected: All tests PASS (existing + new proxy tests)

**Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add src/adapters/cps-golf.ts src/adapters/cps-golf.test.ts
git commit -m "feat: route CPS Golf requests through Lambda proxy when configured"
```

---

### Task 7: Update deploy workflow for Lambda + OIDC

**Files:**
- Modify: `.github/workflows/deploy.yml`

**Step 1: Add `id-token: write` permission**

Change the permissions block from:
```yaml
permissions:
  contents: read
```
to:
```yaml
permissions:
  contents: read
  id-token: write
```

**Step 2: Add AWS credentials and Lambda deploy steps**

Add these two steps BEFORE the existing "Deploy Worker" step (and AFTER "Seed course catalog"):

```yaml
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
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
```

The final step order should be: checkout → setup-node → npm ci → npm test → cache → build → migrations → seed → **AWS credentials** → **Lambda deploy** → Deploy Worker

**Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add Lambda proxy deploy with OIDC auth to deploy workflow"
```

---

### Task 8: Restore custom domain and clean up diagnostics

**Files:**
- Modify: `wrangler.jsonc` (uncomment routes, remove diagnostic comment)
- Delete: `scripts/diag-worker/worker.ts`
- Delete: `scripts/diag-worker/wrangler.jsonc`
- Delete: `scripts/diag-worker/README.md`
- Delete: `scripts/diag-cps-tls.ts`
- Delete: `scripts/diag-cps-lambda.mjs`
- Delete: `scripts/diag-cps-lambda.zip`

**Step 1: Restore custom domain route in `wrangler.jsonc`**

Remove the comment `// routes removed temporarily — deploy to workers.dev for CPS Golf 525 diagnosis` and uncomment the routes block. The area around the `triggers` key should look like:

```jsonc
	"routes": [
		{
			"pattern": "teetimes.scarson.io",
			"custom_domain": true
		}
	],
	"triggers": {
```

**Step 2: Delete diagnostic files**

```bash
rm -rf scripts/diag-worker/
rm -f scripts/diag-cps-tls.ts scripts/diag-cps-lambda.mjs scripts/diag-cps-lambda.zip
```

**Step 3: Verify build**

Run: `npx tsc --noEmit && npm test`
Expected: Clean type-check and all tests pass

**Step 4: Commit**

```bash
git add -u wrangler.jsonc scripts/
git commit -m "chore: restore custom domain route and remove diagnostic scripts"
```

---

### Task 9: Manual AWS setup (one-time, done by Sam)

These steps are done manually in the AWS Console or CLI. They must be completed before the first deploy. **This task is not for subagent execution.**

**Step 1: Create Lambda execution role**

The Lambda needs a role with basic CloudWatch Logs permissions:

```bash
aws iam create-role \
  --role-name tee-times-proxy-execution \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }]
  }'

aws iam attach-role-policy \
  --role-name tee-times-proxy-execution \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

**Step 2: Create OIDC identity provider**

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

**Step 3: Create deploy role with trust policy**

Save as `/tmp/trust-policy.json` (replace `ACCOUNT_ID` with your AWS account ID):
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:scarson/twin-cities-tee-times:ref:refs/heads/main"
      }
    }
  }]
}
```

```bash
aws iam create-role \
  --role-name github-actions-tee-times-deploy \
  --assume-role-policy-document file:///tmp/trust-policy.json
```

**Step 4: Attach deploy permissions to the role**

Save as `/tmp/lambda-deploy-policy.json` (replace `ACCOUNT_ID`):
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "lambda:UpdateFunctionCode",
      "lambda:UpdateFunctionConfiguration",
      "lambda:GetFunction",
      "lambda:CreateFunction",
      "lambda:GetFunctionConfiguration",
      "lambda:PutFunctionConcurrency"
    ],
    "Resource": "arn:aws:lambda:us-west-2:ACCOUNT_ID:function:tee-times-fetch-proxy"
  }]
}
```

```bash
aws iam put-role-policy \
  --role-name github-actions-tee-times-deploy \
  --policy-name lambda-deploy \
  --policy-document file:///tmp/lambda-deploy-policy.json
```

**Step 5: Create invoker IAM user**

```bash
aws iam create-user --user-name tee-times-lambda-invoker
aws iam put-user-policy --user-name tee-times-lambda-invoker \
  --policy-name invoke-proxy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": "lambda:InvokeFunctionUrl",
      "Resource": "arn:aws:lambda:us-west-2:ACCOUNT_ID:function:tee-times-fetch-proxy"
    }]
  }'
aws iam create-access-key --user-name tee-times-lambda-invoker
```

**Step 6: Create the Lambda function**

```bash
cd lambda/fetch-proxy && zip -j proxy.zip index.mjs && cd ../..
aws lambda create-function \
  --function-name tee-times-fetch-proxy \
  --runtime nodejs22.x \
  --handler index.handler \
  --role arn:aws:iam::ACCOUNT_ID:role/tee-times-proxy-execution \
  --zip-file fileb://lambda/fetch-proxy/proxy.zip \
  --timeout 15 \
  --memory-size 128

aws lambda put-function-concurrency \
  --function-name tee-times-fetch-proxy \
  --reserved-concurrent-executions 5

aws lambda create-function-url-config \
  --function-name tee-times-fetch-proxy \
  --auth-type AWS_IAM
```

**Step 7: Store secrets**

```bash
# Cloudflare Worker secrets (use the Function URL from step 6 output)
npx wrangler secret put FETCH_PROXY_URL
npx wrangler secret put AWS_ACCESS_KEY_ID
npx wrangler secret put AWS_SECRET_ACCESS_KEY

# GitHub secret (use the role ARN from step 3 output)
gh secret set AWS_ROLE_ARN
```

**Step 8: Clean up diagnostic Lambda**

```bash
aws lambda delete-function --function-name cps-diag
```

---

### Task 10: Deploy and verify

**Step 1: Push to main and verify CI/CD**

Merge PR (or push to main). Watch GitHub Actions deploy workflow — it should:
1. Run tests
2. Build OpenNext
3. Apply D1 migrations
4. Seed courses
5. **Deploy Lambda proxy** (new)
6. Deploy Worker

**Step 2: Verify CPS Golf works in production**

Wait 5 minutes for the cron to fire, then:

```bash
npx wrangler d1 execute tee-times-db --remote --command="SELECT course_id, status, error_message FROM poll_log WHERE course_id LIKE 'tc-%' AND polled_at > datetime('now', '-10 minutes') ORDER BY polled_at DESC LIMIT 20"
```

Expected: CPS Golf courses show `status = 'success'` instead of `error` with HTTP 525.

**Step 3: Verify non-CPS courses still work**

```bash
npx wrangler d1 execute tee-times-db --remote --command="SELECT course_id, status FROM poll_log WHERE course_id IN ('sd-balboa-park', 'sd-keller') AND polled_at > datetime('now', '-10 minutes') ORDER BY polled_at DESC LIMIT 10"
```

Expected: ForeUp and TeeItUp courses still `success` (direct fetch, no proxy).
