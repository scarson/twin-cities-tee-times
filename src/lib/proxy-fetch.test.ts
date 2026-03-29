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
    vi.mocked(AwsClient).mockImplementation(function (this: any) {
      this.fetch = mockAwsFetch;
      return this;
    } as any);
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

  it("throws on non-OK status with proxyError body (prefers detail)", async () => {
    mockAwsFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ proxyError: true, message: "Host not allowed: evil.teesnap.net" }),
        { status: 403 }
      )
    );

    await expect(
      proxyFetch({ url: "https://evil.teesnap.net/api", method: "GET", headers: {} }, proxyConfig)
    ).rejects.toThrow("Proxy: Host not allowed: evil.teesnap.net");
  });

  it("throws generic error when Lambda returns non-OK with non-JSON body", async () => {
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

  it("sets 12s timeout on the Lambda call", async () => {
    mockAwsFetch.mockResolvedValue(
      new Response(JSON.stringify({ status: 200, headers: {}, body: "{}" }))
    );

    await proxyFetch(
      { url: "https://x.cps.golf/api", method: "GET", headers: {} },
      proxyConfig
    );

    const opts = mockAwsFetch.mock.calls[0][1];
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});
