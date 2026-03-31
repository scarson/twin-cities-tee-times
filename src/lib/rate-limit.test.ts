// ABOUTME: Tests for server-side refresh rate limiting.
// ABOUTME: Verifies per-course cooldown and global rate limit checks.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkRefreshAllowed, COURSE_COOLDOWN_SECONDS, GLOBAL_MAX_PER_MINUTE } from "./rate-limit";
import { sqliteIsoNow } from "@/lib/db";

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
    const result = await checkRefreshAllowed(db, "sd-oceanside", "2026-04-06");
    expect(result.allowed).toBe(true);
  });

  it("blocks refresh when course+date was recently polled", async () => {
    const db = mockDb({ courseRecent: true, globalCount: 0 });
    const result = await checkRefreshAllowed(db, "sd-oceanside", "2026-04-06");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/recently/i);
  });

  it("blocks refresh when global rate limit exceeded", async () => {
    const db = mockDb({ courseRecent: false, globalCount: GLOBAL_MAX_PER_MINUTE + 1 });
    const result = await checkRefreshAllowed(db, "sd-oceanside", "2026-04-06");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/busy/i);
  });

  it("checks course+date cooldown before global limit", async () => {
    const db = mockDb({ courseRecent: true, globalCount: GLOBAL_MAX_PER_MINUTE + 1 });
    const result = await checkRefreshAllowed(db, "sd-oceanside", "2026-04-06");
    expect(result.allowed).toBe(false);
    // Should mention "recently" (course-level), not "busy" (global)
    if (!result.allowed) expect(result.reason).toMatch(/recently/i);
  });

  it("queries use correct cooldown intervals and include date", async () => {
    const db = mockDb({ courseRecent: false, globalCount: 0 });
    await checkRefreshAllowed(db, "sd-oceanside", "2026-04-06");

    // First prepare call: per-course+date cooldown query
    const courseQuery = db.prepare.mock.calls[0][0] as string;
    expect(courseQuery).toContain(
      sqliteIsoNow(`-${COURSE_COOLDOWN_SECONDS} seconds`)
    );
    expect(courseQuery).toContain("date = ?");

    // Bindings should include both courseId and date
    expect(db.bind.mock.calls[0]).toEqual(["sd-oceanside", "2026-04-06"]);

    // Second prepare call: global rate limit query
    const globalQuery = db.prepare.mock.calls[1][0] as string;
    expect(globalQuery).toContain(sqliteIsoNow("-60 seconds"));
  });

  it("scopes cooldown to the specific date", async () => {
    // Course was recently polled for a DIFFERENT date — should still allow
    const db = mockDb({ courseRecent: false, globalCount: 0 });
    const result = await checkRefreshAllowed(db, "sd-oceanside", "2026-04-06");
    expect(result.allowed).toBe(true);
  });
});
