// ABOUTME: Tests for POST /api/user/booking-clicks route.
// ABOUTME: Verifies click tracking, idempotency, validation, and auth.

import { NextRequest } from "next/server";
import { createMockD1, createMockEnv } from "@/test/d1-mock";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateRequest } from "@/lib/auth";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authenticateRequest: vi.fn(),
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
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: { userId: "user-1", email: "test@example.com" },
      headers: new Headers(),
    });
  }

  function makeRequest(body: unknown) {
    return new NextRequest(
      "https://example.com/api/user/booking-clicks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
  }

  it("records a booking click", async () => {
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
    // INSERT OR IGNORE returns changes: 0 for duplicates
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

  it("returns 401 when not authenticated", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      user: null,
      headers: new Headers(),
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ courseId: "course-1", date: "2026-03-15", time: "08:30" })
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });
});
