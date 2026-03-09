// ABOUTME: Tests for POST /api/auth/logout route.
// ABOUTME: Verifies session deletion, cookie clearing, and always-200 behavior.

import { NextRequest } from "next/server";
import { createMockD1, createMockEnv } from "@/test/d1-mock";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sha256, clearAuthCookies } from "@/lib/auth";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  sha256: vi.fn(),
  clearAuthCookies: vi.fn(),
}));

describe("POST /api/auth/logout", () => {
  let db: ReturnType<typeof createMockD1>["db"];
  let mockRun: ReturnType<typeof createMockD1>["mockRun"];

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockD1();
    db = mock.db;
    mockRun = mock.mockRun;
    const env = createMockEnv(db);
    vi.mocked(getCloudflareContext).mockResolvedValue({
      env,
      ctx: {},
    } as any);
  });

  it("deletes session by hash, clears cookies, returns 200", async () => {
    vi.mocked(sha256).mockResolvedValue("hashed-refresh-token");

    const { POST } = await import("./route");
    const request = new NextRequest("https://example.com/api/auth/logout", {
      method: "POST",
    });
    request.cookies.set("tct-refresh", "some-refresh-token");

    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });

    expect(sha256).toHaveBeenCalledWith("some-refresh-token");
    expect(db.prepare).toHaveBeenCalledWith(
      "DELETE FROM sessions WHERE token_hash = ?"
    );
    expect(clearAuthCookies).toHaveBeenCalled();
  });

  it("clears cookies and returns 200 even with no auth cookies", async () => {
    const { POST } = await import("./route");
    const request = new NextRequest("https://example.com/api/auth/logout", {
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });

    expect(sha256).not.toHaveBeenCalled();
    expect(db.prepare).not.toHaveBeenCalled();
    expect(clearAuthCookies).toHaveBeenCalled();
  });
});
