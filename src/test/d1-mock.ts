// ABOUTME: Shared D1 mock factory for route handler tests.
// ABOUTME: Creates chainable prepare/bind/first/all/run mocks matching D1's API.
import { vi } from "vitest";

/**
 * Creates a mock D1Database with chainable query methods.
 *
 * Usage:
 *   const { db, mockFirst, mockAll, mockRun } = createMockD1();
 *   mockFirst.mockResolvedValueOnce({ id: "123", name: "Test" }); // next .first() returns this
 *   mockAll.mockResolvedValueOnce({ results: [row1, row2] });     // next .all() returns this
 *
 * For tests needing multiple sequential queries with different results,
 * use mockResolvedValueOnce() multiple times — they resolve in order.
 */
export function createMockD1() {
  const mockFirst = vi.fn().mockResolvedValue(null);
  const mockAll = vi.fn().mockResolvedValue({ results: [] });
  const mockRun = vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } });

  const boundStatement = { first: mockFirst, all: mockAll, run: mockRun };
  const statement = { bind: vi.fn().mockReturnValue(boundStatement) };
  const db = {
    prepare: vi.fn().mockReturnValue(statement),
    batch: vi.fn().mockResolvedValue([]),
  };

  return { db, statement, mockFirst, mockAll, mockRun } as {
    db: any;
    statement: typeof statement;
    mockFirst: typeof mockFirst;
    mockAll: typeof mockAll;
    mockRun: typeof mockRun;
  };
}

/**
 * Creates a mock CloudflareEnv with the given D1 mock and test secrets.
 */
export function createMockEnv(db: any) {
  return {
    DB: db,
    GOOGLE_CLIENT_ID: "test-google-client-id",
    GOOGLE_CLIENT_SECRET: "test-google-client-secret",
    JWT_SECRET: "test-jwt-secret-that-is-at-least-32-chars-long",
  };
}
