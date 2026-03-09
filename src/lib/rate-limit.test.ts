// ABOUTME: Tests for server-side refresh rate limiting.
// ABOUTME: Verifies per-course cooldown and global rate limit checks.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkRefreshAllowed, COURSE_COOLDOWN_SECONDS, GLOBAL_MAX_PER_MINUTE } from "./rate-limit";

function mockDb(results: { courseRecent: boolean; globalCount: number }) {
  const first = vi.fn().mockResolvedValue(
    results.courseRecent ? { polled_at: "2026-03-09T12:00:00Z" } : null
  );
  const firstGlobal = vi.fn().mockResolvedValue({ cnt: results.globalCount });
  let callIndex = 0;
  const bind = vi.fn().mockReturnValue({
    first: () => {
      const idx = callIndex++;
      return idx === 0 ? first() : firstGlobal();
    },
  });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { prepare, bind, first, firstGlobal } as any;
}

describe("checkRefreshAllowed", () => {
  it("allows refresh when no recent poll and under global limit", async () => {
    const db = mockDb({ courseRecent: false, globalCount: 0 });
    const result = await checkRefreshAllowed(db, "sd-oceanside");
    expect(result.allowed).toBe(true);
  });

  it("blocks refresh when course was recently polled", async () => {
    const db = mockDb({ courseRecent: true, globalCount: 0 });
    const result = await checkRefreshAllowed(db, "sd-oceanside");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/recently/i);
  });

  it("blocks refresh when global rate limit exceeded", async () => {
    const db = mockDb({ courseRecent: false, globalCount: GLOBAL_MAX_PER_MINUTE + 1 });
    const result = await checkRefreshAllowed(db, "sd-oceanside");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/busy/i);
  });

  it("checks course cooldown before global limit", async () => {
    const db = mockDb({ courseRecent: true, globalCount: GLOBAL_MAX_PER_MINUTE + 1 });
    const result = await checkRefreshAllowed(db, "sd-oceanside");
    expect(result.allowed).toBe(false);
    // Should mention "recently" (course-level), not "busy" (global)
    expect(result.reason).toMatch(/recently/i);
  });

  it("queries use correct cooldown intervals", async () => {
    const db = mockDb({ courseRecent: false, globalCount: 0 });
    await checkRefreshAllowed(db, "sd-oceanside");

    // First prepare call: per-course cooldown query
    const courseQuery = db.prepare.mock.calls[0][0] as string;
    expect(courseQuery).toContain(`-${COURSE_COOLDOWN_SECONDS} seconds`);
    expect(courseQuery).not.toContain("date =");

    // Second prepare call: global rate limit query
    const globalQuery = db.prepare.mock.calls[1][0] as string;
    expect(globalQuery).toContain("-60 seconds");
  });
});
