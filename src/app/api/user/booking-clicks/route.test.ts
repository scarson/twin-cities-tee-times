// ABOUTME: Tests for POST /api/user/booking-clicks route.
// ABOUTME: Verifies click tracking, idempotency, validation, and JWT-only auth (no rotation).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createMockD1, createMockEnv } from "@/test/d1-mock";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyJWT } from "@/lib/auth";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  verifyJWT: vi.fn(),
}));

describe("POST /api/user/booking-clicks", () => {
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

  function authedUser() {
    vi.mocked(verifyJWT).mockResolvedValue({
      userId: "user-1",
      email: "test@example.com",
    });
  }

  function makeRequest(body: unknown, cookies: Record<string, string> = { "tct-session": "valid-jwt" }) {
    const req = new NextRequest(
      "https://example.com/api/user/booking-clicks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    for (const [name, value] of Object.entries(cookies)) {
      req.cookies.set(name, value);
    }
    return req;
  }

  it("records a booking click when JWT is valid", async () => {
    authedUser();
    mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 1 } });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ courseId: "course-1", date: "2026-03-15", time: "08:30" })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT OR IGNORE INTO booking_clicks")
    );
  });

  it("handles duplicate click idempotently", async () => {
    authedUser();
    mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 0 } });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ courseId: "course-1", date: "2026-03-15", time: "08:30" })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });

  it("returns 400 when courseId is missing", async () => {
    authedUser();

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ date: "2026-03-15", time: "08:30" })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "Missing required fields" });
  });

  it("returns 400 when date is missing", async () => {
    authedUser();

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ courseId: "course-1", time: "08:30" })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "Missing required fields" });
  });

  it("returns 400 when time is missing", async () => {
    authedUser();

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ courseId: "course-1", date: "2026-03-15" })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "Missing required fields" });
  });

  it("silently returns 200 without recording when JWT is expired", async () => {
    vi.mocked(verifyJWT).mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ courseId: "course-1", date: "2026-03-15", time: "08:30" })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });

    // Must NOT have attempted any D1 writes
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("silently returns 200 when no session cookie exists", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      makeRequest(
        { courseId: "course-1", date: "2026-03-15", time: "08:30" },
        {} // no cookies
      )
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
    // verifyJWT should not even be called when no cookie exists
    expect(verifyJWT).not.toHaveBeenCalled();
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("never sets Set-Cookie headers (no token rotation)", async () => {
    authedUser();
    mockRun.mockResolvedValueOnce({ success: true, meta: { changes: 1 } });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ courseId: "course-1", date: "2026-03-15", time: "08:30" })
    );

    expect(response.headers.has("Set-Cookie")).toBe(false);
  });
});
