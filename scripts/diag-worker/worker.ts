// ABOUTME: Standalone diagnostic Worker for CPS Golf 525 investigation.
// ABOUTME: Deploy to workers.dev to test if 525 is zone-specific or platform-wide.

/**
 * Diagnostic Worker: Tests outbound fetch to CPS Golf and ForeUp from workers.dev.
 *
 * Deploy:
 *   cd scripts/diag-worker
 *   npx wrangler deploy
 *
 * Then visit: https://cps-diag.<your-subdomain>.workers.dev/
 *
 * This Worker runs on workers.dev (no custom domain) to isolate
 * whether the HTTP 525 is caused by zone SSL settings on scarson.io.
 */

interface TestResult {
  name: string;
  url: string;
  method: string;
  status: number | null;
  statusText: string | null;
  headers: Record<string, string>;
  bodyPreview: string;
  error: string | null;
  timeMs: number;
}

async function testFetch(
  name: string,
  url: string,
  init?: RequestInit
): Promise<TestResult> {
  const start = Date.now();
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      headers[k] = v;
    });
    return {
      name,
      url,
      method: init?.method ?? "GET",
      status: response.status,
      statusText: response.statusText,
      headers,
      bodyPreview: body.substring(0, 500),
      error: null,
      timeMs: Date.now() - start,
    };
  } catch (err: unknown) {
    return {
      name,
      url,
      method: init?.method ?? "GET",
      status: null,
      statusText: null,
      headers: {},
      bodyPreview: "",
      error: String(err),
      timeMs: Date.now() - start,
    };
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Allow testing specific hosts via query param
    const customHost = url.searchParams.get("host");

    const results: TestResult[] = [];

    // Test 1: CPS Golf SD (jcgsc5) — token endpoint
    results.push(
      await testFetch(
        "CPS Golf SD (jcgsc5) - Token",
        "https://jcgsc5.cps.golf/identityapi/myconnect/token/short",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "client_id=onlinereswebshortlived",
        }
      )
    );

    // Test 2: CPS Golf TC (Theodore Wirth) — token endpoint
    results.push(
      await testFetch(
        "CPS Golf TC (T. Wirth) - Token",
        "https://minneapolistheodorewirth.cps.golf/identityapi/myconnect/token/short",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "client_id=onlinereswebshortlived",
        }
      )
    );

    // Test 3: CPS Golf TC (Phalen) — token endpoint
    results.push(
      await testFetch(
        "CPS Golf TC (Phalen) - Token",
        "https://phalen.cps.golf/identityapi/myconnect/token/short",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "client_id=onlinereswebshortlived",
        }
      )
    );

    // Test 4: ForeUp (control — known working)
    results.push(
      await testFetch(
        "ForeUp (control) - Tee Times",
        "https://foreupsoftware.com/index.php/api/booking/times?booking_class=default&schedule_id=1470&date=03-13-2026&time=all&holes=all&players=0&specials_only=0&api_key=no_limits"
      )
    );

    // Test 5: TeeItUp (control — known working)
    results.push(
      await testFetch(
        "TeeItUp (control) - Tee Times",
        "https://phx-api-be-east-1b.kenna.io/v2/tee-times?date=2026-03-13&facilityId=1241",
        {
          headers: {
            "x-be-alias": "lomas-santa-fe-executive-golf-course",
          },
        }
      )
    );

    // Test 6: Custom host if provided
    if (customHost) {
      results.push(
        await testFetch(
          `Custom: ${customHost}`,
          `https://${customHost}/identityapi/myconnect/token/short`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "client_id=onlinereswebshortlived",
          }
        )
      );
    }

    // Test 7: CPS Golf with explicit cf options (test if any help)
    // Try with cf.cacheTtl to see if bypassing cache layer changes anything
    results.push(
      await testFetch(
        "CPS Golf SD - Token (no-cache)",
        "https://jcgsc5.cps.golf/identityapi/myconnect/token/short",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "client_id=onlinereswebshortlived",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cf is a Workers-specific fetch extension
          cf: { cacheTtl: 0 } as any,
        }
      )
    );

    // Format results
    const output = {
      diagnostic: "CPS Golf 525 Investigation",
      timestamp: new Date().toISOString(),
      workerRoute: url.hostname,
      isWorkersDevDomain: url.hostname.endsWith(".workers.dev"),
      cfRay: request.headers.get("cf-ray"),
      cfConnectingIp: request.headers.get("cf-connecting-ip"),
      results: results.map((r) => ({
        name: r.name,
        url: r.url,
        status: r.status,
        statusText: r.statusText,
        error: r.error,
        timeMs: r.timeMs,
        responseHeaders: r.headers,
        bodyPreview: r.bodyPreview,
      })),
      summary: {
        cpsWorking: results
          .filter((r) => r.name.includes("CPS"))
          .some((r) => r.status === 200),
        foreupWorking: results
          .filter((r) => r.name.includes("ForeUp"))
          .some((r) => r.status === 200),
        teeitupWorking: results
          .filter((r) => r.name.includes("TeeItUp"))
          .some((r) => r.status === 200),
      },
    };

    return new Response(JSON.stringify(output, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
