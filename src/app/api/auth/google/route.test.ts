// ABOUTME: Tests for the OAuth initiation route (GET /api/auth/google).
// ABOUTME: Verifies redirect to Google, cookie setting, and returnTo validation.

import { NextRequest } from "next/server";
import { createMockEnv } from "@/test/d1-mock";
import { getCloudflareContext } from "@opennextjs/cloudflare";

vi.mock("arctic", () => {
  class MockGoogle {
    createAuthorizationURL() {
      return new URL("https://accounts.google.com/o/oauth2/auth?mock=true");
    }
  }
  return {
    Google: MockGoogle,
    generateCodeVerifier: () => "mock-code-verifier",
  };
});

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  const env = createMockEnv({} as any);
  vi.mocked(getCloudflareContext).mockResolvedValue({
    env,
    ctx: {},
  } as any);
});

describe("GET /api/auth/google", () => {
  it("returns a redirect to accounts.google.com", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest("https://example.com/api/auth/google");
    const response = await GET(request);

    expect([302, 307]).toContain(response.status);
    const location = response.headers.get("location");
    expect(location).toContain("accounts.google.com");
  });

  it("sets tct-oauth-state cookie with HttpOnly and 10-min Max-Age", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest("https://example.com/api/auth/google");
    const response = await GET(request);

    const cookies = response.headers.getSetCookie();
    const stateCookie = cookies.find((c) => c.startsWith("tct-oauth-state="));
    expect(stateCookie).toBeDefined();
    expect(stateCookie).toContain("HttpOnly");
    expect(stateCookie).toContain("Max-Age=600");
  });

  it("sets tct-oauth-verifier cookie with HttpOnly and 10-min Max-Age", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest("https://example.com/api/auth/google");
    const response = await GET(request);

    const cookies = response.headers.getSetCookie();
    const verifierCookie = cookies.find((c) =>
      c.startsWith("tct-oauth-verifier=")
    );
    expect(verifierCookie).toBeDefined();
    expect(verifierCookie).toContain("HttpOnly");
    expect(verifierCookie).toContain("Max-Age=600");
  });

  it("includes returnTo in state cookie when provided", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/auth/google?returnTo=/courses/braemar"
    );
    const response = await GET(request);

    const cookies = response.headers.getSetCookie();
    const stateCookie = cookies.find((c) => c.startsWith("tct-oauth-state="))!;
    const value = decodeURIComponent(
      stateCookie.split("=").slice(1).join("=").split(";")[0]
    );
    const parsed = JSON.parse(value);
    expect(parsed.returnTo).toBe("/courses/braemar");
  });

  it("defaults returnTo to / when not provided", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest("https://example.com/api/auth/google");
    const response = await GET(request);

    const cookies = response.headers.getSetCookie();
    const stateCookie = cookies.find((c) => c.startsWith("tct-oauth-state="))!;
    const value = decodeURIComponent(
      stateCookie.split("=").slice(1).join("=").split(";")[0]
    );
    const parsed = JSON.parse(value);
    expect(parsed.returnTo).toBe("/");
  });

  it("rejects returnTo=//evil.com and defaults to /", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/auth/google?returnTo=//evil.com"
    );
    const response = await GET(request);

    const cookies = response.headers.getSetCookie();
    const stateCookie = cookies.find((c) => c.startsWith("tct-oauth-state="))!;
    const value = decodeURIComponent(
      stateCookie.split("=").slice(1).join("=").split(";")[0]
    );
    const parsed = JSON.parse(value);
    expect(parsed.returnTo).toBe("/");
  });

  it("rejects returnTo=https://evil.com and defaults to /", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest(
      "https://example.com/api/auth/google?returnTo=https://evil.com"
    );
    const response = await GET(request);

    const cookies = response.headers.getSetCookie();
    const stateCookie = cookies.find((c) => c.startsWith("tct-oauth-state="))!;
    const value = decodeURIComponent(
      stateCookie.split("=").slice(1).join("=").split(";")[0]
    );
    const parsed = JSON.parse(value);
    expect(parsed.returnTo).toBe("/");
  });
});
