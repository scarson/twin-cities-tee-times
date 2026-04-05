# Adapter Error Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three production polling failures: CPS Golf v4 transaction registration (Edinburgh USA), TeeWire IP blocking (Inver Wood), and add CPS v4→v5 auto-detection.

**Architecture:** Three independent changes touching different files (parallelizable):
1. CPS Golf adapter: try `RegisterTransactionId` for v4, fall back gracefully on HTTP 404
2. TeeWire adapter: route through Lambda proxy (same pattern as TeeSnap/CPS Golf)
3. Cron handler: weekly check whether v4 CPS courses have upgraded to v5

**Tech Stack:** TypeScript, Vitest, Cloudflare D1, Lambda proxy (aws4fetch)

**Parallelization:** Tasks 1, 2, and 3 touch entirely different files and can run in parallel. Task 4 (verification) depends on all three completing.

---

## Task 1: CPS Golf v4 — Graceful Transaction Registration Fallback

### Context (read this first — you have no conversation history)

The CPS Golf adapter (`src/adapters/cps-golf.ts`) supports two auth flows:
- **v5** (default): Get bearer token → register transaction → fetch tee times with transactionId
- **v4** (`authType: "v4"` in platformConfig): Use x-apikey header → register transaction → fetch tee times with transactionId

**The bug:** There are two sub-variants of v4 CPS builds in the wild:
- **Newer v4** (Brookview, Victory Links): HAS the `RegisterTransactionId` endpoint and REQUIRES `transactionId` in the TeeTimes request (returns HTTP 400 without it)
- **Older v4** (Edinburgh USA): Does NOT have `RegisterTransactionId` (returns HTTP 404) and does NOT need `transactionId` in the TeeTimes request (works without it)

The current code always calls `registerTransaction()` for v4 courses. For Edinburgh, this throws "CPS Golf transaction registration failed" because the endpoint returns 404. Edinburgh has had 2,723 consecutive errors with 0 successes since March 29.

**The fix:** Add a new `tryRegisterTransaction()` method that returns `null` on 404 instead of throwing. The v4 path uses this and only sets `transactionId` in params if registration succeeded.

**Do NOT:**
- Remove the existing `registerTransaction()` method (v5 still uses it)
- Change the v5 auth flow in any way
- Add per-course config flags — the 404 fallback handles both sub-variants automatically
- Change any existing test assertions — only add new tests

### Files

- Modify: `src/adapters/cps-golf.ts`
- Modify: `src/adapters/cps-golf.test.ts`

### Preamble

```
BEFORE starting work:
1. Read src/adapters/cps-golf.ts in full
2. Read src/adapters/cps-golf.test.ts in full
3. Read dev/testing-pitfalls.md
Follow TDD: write failing test → implement fix → verify green.
```

### Step 1: Write failing test — v4 falls back when RegisterTransactionId returns 404

In `src/adapters/cps-golf.test.ts`, inside the existing `describe("v4 auth mode")` block (which already has `v4Config`, `v4Env`, and `fixture` in scope), add this test:

```typescript
it("skips transactionId when RegisterTransactionId returns 404", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response("Not Found", { status: 404 })) // register → 404
    .mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

  const results = await adapter.fetchTeeTimes(v4Config, "2026-03-12", v4Env);

  // 2 fetch calls (register attempt + TeeTimes), no token
  expect(fetchSpy).toHaveBeenCalledTimes(2);

  // Call 2: TeeTimes WITHOUT transactionId in URL
  const [ttUrl] = fetchSpy.mock.calls[1];
  expect(ttUrl).toContain("/TeeTimes?");
  expect(ttUrl).not.toContain("transactionId=");
  expect(results).toHaveLength(3);
});
```

### Step 2: Run test to verify it fails

Run: `npx vitest run src/adapters/cps-golf.test.ts -t "skips transactionId when"`
Expected: FAIL — current code throws "CPS Golf transaction registration failed" on 404.

### Step 3: Implement tryRegisterTransaction

In `src/adapters/cps-golf.ts`, add a new private method **after** the existing `registerTransaction` method (after line 161). This is a separate method — do NOT modify `registerTransaction`:

```typescript
private async tryRegisterTransaction(
  baseUrl: string,
  token: string,
  headers: Record<string, string>,
  proxy: ProxyConfig | null
): Promise<string | null> {
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

  if (response.status === 404) {
    return null;
  }

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

### Step 4: Update v4 branch to use tryRegisterTransaction

In `src/adapters/cps-golf.ts`, replace lines 62-74 (the `if (isV4)` branch only — do NOT touch the `else` branch):

**Current code (lines 62-74):**
```typescript
    if (isV4) {
      const apiKey = env?.CPS_V4_API_KEY;
      if (!apiKey) {
        throw new Error("Missing CPS_V4_API_KEY secret for v4 auth");
      }
      headers = this.buildV4Headers(config, apiKey, timezone);
      const transactionId = await this.registerTransaction(
        baseUrl,
        apiKey,
        headers,
        proxy
      );
      params.set("transactionId", transactionId);
    } else {
```

**Replace with:**
```typescript
    if (isV4) {
      const apiKey = env?.CPS_V4_API_KEY;
      if (!apiKey) {
        throw new Error("Missing CPS_V4_API_KEY secret for v4 auth");
      }
      headers = this.buildV4Headers(config, apiKey, timezone);
      const transactionId = await this.tryRegisterTransaction(
        baseUrl,
        apiKey,
        headers,
        proxy
      );
      if (transactionId) {
        params.set("transactionId", transactionId);
      }
    } else {
```

### Step 5: Run test to verify it passes

Run: `npx vitest run src/adapters/cps-golf.test.ts`
Expected: ALL tests pass (existing + new). The existing v4 test "skips token but registers transaction for v4 courses" should still pass because it mocks RegisterTransactionId returning 200.

### Step 6: Write test — v4 proxy mode also falls back on 404

Still inside `describe("v4 auth mode")`, add:

```typescript
it("skips transactionId via proxy when RegisterTransactionId returns 404", async () => {
  const v4ProxyEnv = {
    ...v4Env,
    FETCH_PROXY_URL: "https://proxy.lambda-url.us-west-2.on.aws/",
    AWS_ACCESS_KEY_ID: "AKID",
    AWS_SECRET_ACCESS_KEY: "SECRET",
  } satisfies CloudflareEnv;

  vi.spyOn(globalThis, "fetch");
  vi.mocked(proxyFetch)
    .mockResolvedValueOnce({
      status: 404,
      headers: {},
      body: "Not Found",
    })
    .mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: JSON.stringify(fixture),
    });

  const results = await adapter.fetchTeeTimes(v4Config, "2026-03-12", v4ProxyEnv);

  expect(proxyFetch).toHaveBeenCalledTimes(2);
  expect(fetch).not.toHaveBeenCalled();

  const ttCall = vi.mocked(proxyFetch).mock.calls[1][0];
  expect(ttCall.url).toContain("/TeeTimes?");
  expect(ttCall.url).not.toContain("transactionId=");
  expect(results).toHaveLength(3);
});
```

### Step 7: Run all tests and verify

Run: `npx vitest run src/adapters/cps-golf.test.ts`
Expected: ALL pass.

### Step 8: Commit

```
feat: CPS Golf v4 gracefully falls back when RegisterTransactionId returns 404

Edinburgh USA's older CPS build doesn't have the RegisterTransactionId
endpoint. The v4 path now tries registration and skips transactionId
when the endpoint returns 404, fixing the persistent polling failure.
```

### Completion check

```
BEFORE marking this task complete:
1. Verify that the existing v4 test "skips token but registers transaction for v4 courses" still passes unchanged
2. Verify that ALL existing v5 tests still pass unchanged
3. Verify that the new 404 fallback test asserts ttUrl does NOT contain "transactionId="
4. Verify that non-404 errors (e.g., 500) still throw "CPS Golf transaction registration failed"
5. Run: npx vitest run src/adapters/cps-golf.test.ts — ALL green
```

---

## Task 2: TeeWire — Route Through Lambda Proxy

### Context (read this first — you have no conversation history)

The TeeWire adapter (`src/adapters/teewire.ts`) currently makes direct `fetch()` calls to `https://teewire.app/{tenant}/...`. On March 29, teewire.app began blocking Cloudflare Worker IP ranges with HTTP 403. This is the same issue that hit the Teesnap adapter on the same day — Teesnap was fixed by routing through the Lambda proxy (`lambda/fetch-proxy/index.mjs`) which forwards requests from AWS IPs instead.

The fix has two parts:
1. Add `"teewire.app"` to the Lambda proxy's `ALLOWED_HOSTS` array
2. Add proxy routing to the TeeWire adapter (same `getProxyConfig`/`doFetch` pattern used by TeeSnap at `src/adapters/teesnap.ts`)

**IMPORTANT hostname detail:** The existing allowlist entries use a leading dot (`.cps.golf`, `.teesnap.net`) because those APIs use subdomains (`brookview.cps.golf`, `daytona.teesnap.net`). TeeWire does NOT use subdomains — the URL is `https://teewire.app/inverwood/...` with the tenant as a path segment. `"teewire.app".endsWith(".teewire.app")` is `false`. The allowlist entry MUST be `"teewire.app"` (no leading dot).

**Do NOT:**
- Change the TeeWire API URL, headers, or response parsing logic
- Add any authentication to TeeWire requests (it's a public API)
- Change any existing test assertions — only add new proxy tests
- Add body support to `doFetch` (TeeWire only uses GET)

### Files

- Modify: `lambda/fetch-proxy/index.mjs` (line 3: add to ALLOWED_HOSTS)
- Modify: `src/adapters/teewire.ts` (add proxy routing)
- Modify: `src/adapters/teewire.test.ts` (add proxy mode tests)

### Preamble

```
BEFORE starting work:
1. Read src/adapters/teewire.ts in full
2. Read src/adapters/teewire.test.ts in full
3. Read src/adapters/teesnap.ts lines 40-169 (the proxy pattern to mirror)
4. Read lambda/fetch-proxy/index.mjs in full
5. Read dev/testing-pitfalls.md
Follow TDD: write failing test → implement fix → verify green.
```

### Step 1: Add teewire.app to Lambda proxy allowlist

In `lambda/fetch-proxy/index.mjs`, change line 3:

**Current:**
```javascript
const ALLOWED_HOSTS = [".cps.golf", ".teesnap.net"];
```

**Replace with:**
```javascript
const ALLOWED_HOSTS = [".cps.golf", ".teesnap.net", "teewire.app"];
```

No leading dot — see hostname detail in Context section above.

### Step 2: Write failing tests — proxy mode

In `src/adapters/teewire.test.ts`:

**First**, add mock import at the top of the file, after the existing imports but before any `describe` block. The `vi.mock` call MUST come before the adapter import due to Vitest hoisting:

```typescript
import { proxyFetch } from "@/lib/proxy-fetch";

vi.mock("@/lib/proxy-fetch", () => ({
  proxyFetch: vi.fn(),
}));
```

**Note:** This mock will be hoisted above all imports by Vitest. Existing tests that don't pass `env` will not be affected — when no env is passed, `getProxyConfig` returns null and `doFetch` uses direct `fetch()`, so `proxyFetch` is never called.

**Then** add a `beforeEach` to reset the proxyFetch mock. In the existing `beforeEach` (line 22-24), add:

```typescript
beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(proxyFetch).mockReset();
});
```

**Then** add a new `describe("proxy mode")` block at the end of the top-level describe:

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

  it("routes requests through proxyFetch when proxy env is set", async () => {
    vi.spyOn(globalThis, "fetch");
    vi.mocked(proxyFetch).mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: JSON.stringify(fixture),
    });

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15", proxyEnv);

    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();

    const call = vi.mocked(proxyFetch).mock.calls[0][0];
    expect(call.url).toContain("teewire.app/inverwood");
    expect(call.url).toContain("calendar_id=3");
    expect(call.headers).toHaveProperty("User-Agent", "TwinCitiesTeeTimes/1.0");
    expect(results).toHaveLength(3);
  });

  it("falls back to direct fetch without proxy env", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), { status: 200 })
    );

    const results = await adapter.fetchTeeTimes(mockConfig, "2026-04-15");

    expect(proxyFetch).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(3);
  });
});
```

### Step 3: Run tests to verify they fail

Run: `npx vitest run src/adapters/teewire.test.ts -t "proxy mode"`
Expected: FAIL — adapter currently ignores `env` and always uses direct `fetch()`.

### Step 4: Implement proxy routing in TeeWire adapter

In `src/adapters/teewire.ts`, make these changes:

**4a.** Add import after the existing type imports (line 3):
```typescript
import { proxyFetch, type ProxyConfig } from "@/lib/proxy-fetch";
```

**4b.** Change parameter name from `_env` to `env` in `fetchTeeTimes` signature (line 38):
```typescript
  async fetchTeeTimes(
    config: CourseConfig,
    date: string,
    env?: CloudflareEnv
  ): Promise<TeeTime[]> {
```

**4c.** Replace the direct `fetch()` call (lines 57-60) with proxy-aware fetch. Change:
```typescript
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "TwinCitiesTeeTimes/1.0" },
    });
```
To:
```typescript
    const proxy = this.getProxyConfig(env);
    const response = await this.doFetch(url, {
      method: "GET",
      headers: { "User-Agent": "TwinCitiesTeeTimes/1.0" },
    }, proxy);
```

**4d.** Add two new private methods at the end of the class (before the closing `}`). Copy these exactly from `src/adapters/teesnap.ts` lines 131-169, which is the proven proxy pattern:

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

private async doFetch(
  url: string,
  init: { method: string; headers: Record<string, string> },
  proxy: ProxyConfig | null
): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
  if (proxy) {
    const result = await proxyFetch(
      { url, method: init.method, headers: init.headers },
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
    signal: AbortSignal.timeout(10000),
  });
  return { ok: response.ok, status: response.status, json: () => response.json() };
}
```

### Step 5: Run all tests

Run: `npx vitest run src/adapters/teewire.test.ts`
Expected: ALL pass — both existing direct-fetch tests and new proxy tests.

### Step 6: Commit

```
fix: route TeeWire adapter through Lambda proxy to avoid CF Worker IP blocks

teewire.app started blocking Cloudflare Worker IPs on Mar 29 (same issue
as TeeSnap). Adds proxy routing + teewire.app to the Lambda allowlist.
```

### Completion check

```
BEFORE marking this task complete:
1. Verify lambda/fetch-proxy/index.mjs has "teewire.app" (no leading dot)
2. Verify ALL existing teewire tests still pass unchanged (the proxyFetch mock does not affect them)
3. Verify the proxy test asserts proxyFetch was called and fetch was NOT called
4. Verify the fallback test asserts fetch was called and proxyFetch was NOT called
5. Run: npx vitest run src/adapters/teewire.test.ts — ALL green
```

---

## Task 3: CPS v4→v5 Auto-Detection in Horizon Probe

### Context (read this first — you have no conversation history)

CPS Golf courses using v4 auth (`authType: "v4"` in `platform_config` JSON) may upgrade to v5 over time. Currently v4→v5 requires manually editing `courses.json` and redeploying. This task adds automatic detection.

**How v4/v5 auth works:**
- **v5** (default): Token endpoint at `https://{subdomain}.cps.golf/identityapi/myconnect/token/short` returns an access token
- **v4**: Same token endpoint returns HTTP 404 (endpoint doesn't exist on older builds). Uses `x-apikey` header instead.

**Detection logic:** If a v4 course's token endpoint starts returning 200 instead of 404, the facility has upgraded to v5. Remove `authType` from `platform_config` so the adapter uses the default v5 flow.

**Where it runs:** In `src/lib/cron-handler.ts`, during the batch 0 housekeeping section (after the horizon probe). This runs once per 5-minute cycle when batch 0 fires and `shouldRunThisCycle` returns true.

**Subdomain deduplication:** Multiple courses can share a subdomain (e.g., `oak-glen-championship` and `oak-glen-executive` both use subdomain `"oakglen"`). Only one HTTP request per unique subdomain is needed — if it succeeds, update all courses on that subdomain.

**The function makes direct `fetch()` calls** (not through the adapter or proxy). This is a simple health check against CPS Golf's own infrastructure — it doesn't need proxy routing.

**Do NOT:**
- Modify the CPS Golf adapter (`src/adapters/cps-golf.ts`) — this task only touches cron-handler
- Change any existing cron-handler tests
- Add the check to non-batch-0 invocations
- Use the Lambda proxy for the v5 token check (direct fetch is fine for CPS Golf's own infrastructure)

### Files

- Modify: `src/lib/cron-handler.ts` (new exported `checkV4Upgrades` function + call in batch 0)
- Modify: `src/lib/cron-handler.test.ts` (new describe block + `makeCourseRow` override)

### Preamble

```
BEFORE starting work:
1. Read src/lib/cron-handler.ts in full
2. Read src/lib/cron-handler.test.ts in full — especially the makeCourseRow helper (lines 22-49) and withTimers helper (lines 12-18)
3. Read dev/testing-pitfalls.md — especially §5 "Error isolation between iterations"
Follow TDD: write failing test → implement fix → verify green.
```

### ⚠️ Testing pitfall warning

**§5 Error isolation:** The `checkV4Upgrades` function iterates multiple subdomains. A network error on one subdomain MUST NOT prevent checking the rest. The error isolation test (Step 5) verifies this explicitly.

**`makeCourseRow` limitation:** The existing helper defaults `platform_config` to `"{}"` and does NOT accept it as an override. You MUST add `platform_config` to the overrides type before writing tests. See Step 1.

### Step 1: Extend makeCourseRow to accept platform_config override

In `src/lib/cron-handler.test.ts`, find the `makeCourseRow` helper function (lines 22-49). Add `platform_config` to the overrides type and use it:

**Current overrides type (lines 23-30):**
```typescript
  overrides: Partial<{
    is_active: number;
    last_had_tee_times: string | null;
    booking_horizon_days: number;
    last_horizon_probe: string | null;
    name: string;
    city: string;
  }> = {}
```

**Replace with:**
```typescript
  overrides: Partial<{
    is_active: number;
    last_had_tee_times: string | null;
    booking_horizon_days: number;
    last_horizon_probe: string | null;
    name: string;
    city: string;
    platform_config: string;
  }> = {}
```

**And change line 40 from:**
```typescript
    platform_config: "{}",
```
**To:**
```typescript
    platform_config: overrides.platform_config ?? "{}",
```

### Step 2: Write failing test — checkV4Upgrades detects v5 availability

In `src/lib/cron-handler.test.ts`:

**First**, update the import on line 4 to include the new function:
```typescript
import { shouldRunThisCycle, runCronPoll, SUBREQUEST_BUDGET, runHorizonProbe, checkV4Upgrades } from "./cron-handler";
```

This will cause a TypeScript error until the function is implemented — that's the failing test.

**Then** add a new `describe("checkV4Upgrades")` block at the end of the file:

```typescript
describe("checkV4Upgrades", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("attempts v5 token endpoint for v4 courses", async () => {
    const course = makeCourseRow("v4-course", "cps_golf", {
      platform_config: JSON.stringify({ subdomain: "test", authType: "v4", websiteId: "abc", courseIds: "1" }),
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 })
    );

    const db = { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ run: vi.fn() }) }) };
    await checkV4Upgrades(db as any, [course]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://test.cps.golf/identityapi/myconnect/token/short");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("updates platform_config when v5 token endpoint returns 200", async () => {
    const platformConfig = { subdomain: "test", authType: "v4", websiteId: "abc", courseIds: "1" };
    const course = makeCourseRow("v4-course", "cps_golf", {
      platform_config: JSON.stringify(platformConfig),
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "tok", expires_in: 600 }), { status: 200 })
    );

    const runMock = vi.fn().mockResolvedValue({ success: true });
    const bindMock = vi.fn().mockReturnValue({ run: runMock });
    const db = { prepare: vi.fn().mockReturnValue({ bind: bindMock }) };

    const result = await checkV4Upgrades(db as any, [course]);

    expect(result).toContain("v4-course");
    expect(db.prepare).toHaveBeenCalledWith("UPDATE courses SET platform_config = ? WHERE id = ?");
    const newConfig = JSON.parse(bindMock.mock.calls[0][0]);
    expect(newConfig.authType).toBeUndefined();
    expect(newConfig.subdomain).toBe("test");
    expect(newConfig.websiteId).toBe("abc");
    expect(newConfig.courseIds).toBe("1");
  });

  it("does not update when v5 token endpoint returns 404", async () => {
    const course = makeCourseRow("still-v4", "cps_golf", {
      platform_config: JSON.stringify({ subdomain: "test", authType: "v4", websiteId: "abc", courseIds: "1" }),
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 })
    );

    const db = { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ run: vi.fn() }) }) };
    const result = await checkV4Upgrades(db as any, [course]);

    expect(result).toHaveLength(0);
    const updateCalls = (db.prepare.mock.calls as string[][]).filter(
      (args) => args[0].includes("UPDATE")
    );
    expect(updateCalls).toHaveLength(0);
  });

  it("skips non-CPS and non-v4 courses", async () => {
    const foreupCourse = makeCourseRow("foreup-course", "foreup", {
      platform_config: JSON.stringify({ scheduleId: "123" }),
    });
    const v5Course = makeCourseRow("v5-course", "cps_golf", {
      platform_config: JSON.stringify({ subdomain: "test", websiteId: "abc" }),
    });

    vi.spyOn(globalThis, "fetch");

    const db = { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ run: vi.fn() }) }) };
    const result = await checkV4Upgrades(db as any, [foreupCourse, v5Course]);

    expect(result).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks each subdomain only once and updates all courses on it", async () => {
    const course1 = makeCourseRow("oak-glen-championship", "cps_golf", {
      platform_config: JSON.stringify({ subdomain: "oakglen", authType: "v4", websiteId: "a", courseIds: "6" }),
    });
    const course2 = makeCourseRow("oak-glen-executive", "cps_golf", {
      platform_config: JSON.stringify({ subdomain: "oakglen", authType: "v4", websiteId: "a", courseIds: "7" }),
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "tok", expires_in: 600 }), { status: 200 })
    );

    const runMock = vi.fn().mockResolvedValue({ success: true });
    const db = { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ run: runMock }) }) };
    const result = await checkV4Upgrades(db as any, [course1, course2]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toContain("oak-glen-championship");
    expect(result).toContain("oak-glen-executive");
  });

  it("continues checking other subdomains after one errors", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const course1 = makeCourseRow("fail-check", "cps_golf", {
      platform_config: JSON.stringify({ subdomain: "fail", authType: "v4", websiteId: "a", courseIds: "1" }),
    });
    const course2 = makeCourseRow("ok-check", "cps_golf", {
      platform_config: JSON.stringify({ subdomain: "ok", authType: "v4", websiteId: "b", courseIds: "2" }),
    });

    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network fail"))
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    const db = { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ run: vi.fn() }) }) };
    await checkV4Upgrades(db as any, [course1, course2]);

    expect(fetch).toHaveBeenCalledTimes(2);
    consoleSpy.mockRestore();
  });

  it("returns empty array when no v4 courses exist", async () => {
    vi.spyOn(globalThis, "fetch");
    const db = { prepare: vi.fn() };
    const result = await checkV4Upgrades(db as any, []);
    expect(result).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
```

### Step 3: Run tests to verify they fail

Run: `npx vitest run src/lib/cron-handler.test.ts -t "checkV4Upgrades"`
Expected: FAIL — `checkV4Upgrades` is not exported from `./cron-handler`.

### Step 4: Implement checkV4Upgrades

In `src/lib/cron-handler.ts`, add this exported function after the `runHorizonProbe` function (after line 105) and before `runCronPoll`:

```typescript
/**
 * Check whether v4 CPS Golf courses have upgraded to v5.
 * Tries the v5 token endpoint for each unique subdomain.
 * If it returns 200, removes authType from platform_config.
 */
export async function checkV4Upgrades(
  db: D1Database,
  courses: CourseRow[]
): Promise<string[]> {
  const v4Courses = courses.filter((c) => {
    if (c.platform !== "cps_golf") return false;
    const config = JSON.parse(c.platform_config);
    return config.authType === "v4";
  });

  if (v4Courses.length === 0) return [];

  const bySubdomain = new Map<string, CourseRow[]>();
  for (const course of v4Courses) {
    const config = JSON.parse(course.platform_config);
    const existing = bySubdomain.get(config.subdomain) ?? [];
    existing.push(course);
    bySubdomain.set(config.subdomain, existing);
  }

  const upgraded: string[] = [];

  for (const [subdomain, subdomainCourses] of bySubdomain) {
    try {
      const url = `https://${subdomain}.cps.golf/identityapi/myconnect/token/short`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "client_id=onlinereswebshortlived",
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) continue;

      for (const course of subdomainCourses) {
        const config = JSON.parse(course.platform_config);
        delete config.authType;
        await db
          .prepare("UPDATE courses SET platform_config = ? WHERE id = ?")
          .bind(JSON.stringify(config), course.id)
          .run();
        upgraded.push(course.id);
      }

      console.log(`CPS v4→v5 upgrade detected: ${subdomain} (${subdomainCourses.map((c) => c.id).join(", ")})`);
    } catch (err) {
      console.error(`v4→v5 check failed for ${subdomain}:`, err);
    }
  }

  return upgraded;
}
```

### Step 5: Add call from batch 0 housekeeping

In `src/lib/cron-handler.ts`, find the batch 0 housekeeping section (inside `if (batchIndex === 0) {`). Add the following block **after** the horizon probe try/catch block and **before** the closing `}` of the `if (batchIndex === 0)` block:

```typescript
      // --- v4→v5 auto-detection: check if v4 CPS courses have upgraded ---
      try {
        const upgradedCourses = await checkV4Upgrades(db, allCourses);
        if (upgradedCourses.length > 0) {
          console.log(`Auto-upgraded ${upgradedCourses.length} course(s) from CPS v4 to v5`);
        }
      } catch (err) {
        console.error("v4→v5 upgrade check error:", err);
      }
```

### Step 6: Run all cron-handler tests

Run: `npx vitest run src/lib/cron-handler.test.ts`
Expected: ALL pass (existing + new).

### Step 7: Commit

```
feat: auto-detect CPS Golf v4→v5 upgrades during weekly horizon probe

Checks the v5 token endpoint for v4 courses once per unique subdomain.
If it returns 200, removes authType from platform_config so the course
uses the standard v5 auth flow going forward.
```

### Completion check

```
BEFORE marking this task complete:
1. Verify checkV4Upgrades is exported from cron-handler.ts
2. Verify the makeCourseRow helper now accepts platform_config in overrides
3. Verify error isolation: a failed subdomain check doesn't prevent checking others
4. Verify subdomain deduplication: fetch is called once per unique subdomain, not per course
5. Verify non-v4 and non-CPS courses are skipped (no fetch calls)
6. Verify the updated platform_config preserves all fields except authType
7. Run: npx vitest run src/lib/cron-handler.test.ts — ALL green
```

---

## Review Loop (after Tasks 1-3)

```
After completing Tasks 1-3:
You MUST carefully review the batch of work from multiple perspectives
and revise/refine as appropriate. Repeat this review loop (you must do
a minimum of three review rounds; if you still find substantive issues
in the third review, keep going with additional rounds until there are
no findings) until you're confident there aren't any more issues. Then
update your private journal and continue onto Task 4.
```

---

## Task 4: Final Verification

### Step 1: Run full test suite

Run: `npm test`
Expected: ALL pass.

### Step 2: Type-check

Run: `npx tsc --noEmit`
Expected: No errors.

### Step 3: Lint

Run: `npm run lint`
Expected: No errors.

### Step 4: Commit CLAUDE.md update

The CLAUDE.md skills table was updated earlier. If not yet committed, stage and commit:

```
git add CLAUDE.md
git commit -m "docs: add check-logs skill to CLAUDE.md skills table"
```
