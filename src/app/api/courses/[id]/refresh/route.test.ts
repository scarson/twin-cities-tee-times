// ABOUTME: Tests for the course refresh API route's validation, rate limiting, and error handling.
// ABOUTME: Covers date defaults, invalid inputs, rate limit enforcement, and pollCourse failures.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockD1, createMockEnv } from "@/test/d1-mock";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { pollCourse } from "@/lib/poller";
import { checkRefreshAllowed } from "@/lib/rate-limit";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/poller", () => ({
  pollCourse: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRefreshAllowed: vi.fn(),
}));

import { POST } from "./route";

function makeRequest(
  id: string,
  params: Record<string, string> = {}
): {
  request: NextRequest;
  routeParams: { params: Promise<{ id: string }> };
} {
  const url = new URL(`http://localhost/api/courses/${id}/refresh`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return {
    request: new NextRequest(url),
    routeParams: { params: Promise.resolve({ id }) },
  };
}

describe("POST /api/courses/[id]/refresh", () => {
  let mockFirst: ReturnType<typeof createMockD1>["mockFirst"];

  beforeEach(() => {
    vi.clearAllMocks();
    const mock = createMockD1();
    mockFirst = mock.mockFirst;
    const env = createMockEnv(mock.db);
    vi.mocked(getCloudflareContext).mockResolvedValue({ env, ctx: {} } as any);
    vi.mocked(checkRefreshAllowed).mockResolvedValue({ allowed: true });
    vi.mocked(pollCourse).mockResolvedValue("success");
  });

  it("returns 404 for unknown course", async () => {
    mockFirst.mockResolvedValueOnce(null);
    const { request, routeParams } = makeRequest("nonexistent");
    const res = await POST(request, routeParams);
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid date format", async () => {
    mockFirst.mockResolvedValueOnce({ id: "braemar", platform: "foreup" });
    const { request, routeParams } = makeRequest("braemar", { date: "bad" });
    const res = await POST(request, routeParams);
    expect(res.status).toBe(400);
  });

  it("uses Central Time default when no date provided", async () => {
    mockFirst.mockResolvedValueOnce({ id: "braemar", platform: "foreup" });
    const { request, routeParams } = makeRequest("braemar");
    const res = await POST(request, routeParams);

    const dateArg = vi.mocked(pollCourse).mock.calls[0]?.[2];
    expect(dateArg).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns 429 when rate limited", async () => {
    mockFirst.mockResolvedValueOnce({ id: "braemar", platform: "foreup" });
    vi.mocked(checkRefreshAllowed).mockResolvedValue({
      allowed: false,
      reason: "Recently refreshed",
    });
    const { request, routeParams } = makeRequest("braemar", {
      date: "2026-04-15",
    });
    const res = await POST(request, routeParams);
    expect(res.status).toBe(429);
  });

  it("returns 500 when pollCourse returns error", async () => {
    mockFirst.mockResolvedValueOnce({ id: "braemar", platform: "foreup" });
    vi.mocked(pollCourse).mockResolvedValue("error");
    const { request, routeParams } = makeRequest("braemar", {
      date: "2026-04-15",
    });
    const res = await POST(request, routeParams);
    expect(res.status).toBe(500);
  });

  it("returns 500 when pollCourse throws", async () => {
    mockFirst.mockResolvedValueOnce({ id: "braemar", platform: "foreup" });
    vi.mocked(pollCourse).mockRejectedValue(new Error("D1 crash"));
    const { request, routeParams } = makeRequest("braemar", {
      date: "2026-04-15",
    });
    const res = await POST(request, routeParams);
    expect(res.status).toBe(500);
  });

  it("returns 200 with result on success", async () => {
    mockFirst.mockResolvedValueOnce({ id: "braemar", platform: "foreup" });
    const { request, routeParams } = makeRequest("braemar", {
      date: "2026-04-15",
    });
    const res = await POST(request, routeParams);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe("success");
  });
});
