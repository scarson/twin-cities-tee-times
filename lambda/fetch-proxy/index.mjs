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
