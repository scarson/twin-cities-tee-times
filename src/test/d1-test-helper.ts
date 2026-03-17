// ABOUTME: Real SQLite wrapper matching D1's async API for integration tests.
// ABOUTME: Uses better-sqlite3 with all migrations applied and FK enforcement enabled.
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

interface BoundStatement {
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

interface PreparedStatement extends BoundStatement {
  bind(...values: unknown[]): BoundStatement;
}

/**
 * Create a fresh in-memory SQLite database with all migrations applied.
 * Returns a D1-compatible wrapper for use in integration tests.
 *
 * Each call creates an independent database -- tests cannot interfere.
 */
export function createTestDb(): D1Database {
  const sqlite = new Database(":memory:");

  // D1 enforces foreign keys by default. SQLite does not.
  // This MUST be set before any migrations or data operations.
  sqlite.pragma("foreign_keys = ON");

  // Apply all migrations in order
  const migrationsDir = path.resolve(__dirname, "../../migrations");
  const files = fs.readdirSync(migrationsDir).sort();
  for (const file of files) {
    if (!file.endsWith(".sql")) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    sqlite.exec(sql);
  }

  // Each bound statement needs both async methods (for D1 API compatibility)
  // AND a sync _syncRun method (for batch(), which runs inside a SQLite
  // transaction that cannot yield to the event loop).
  function makeBound(
    stmt: Database.Statement,
    params: unknown[]
  ): BoundStatement & { _syncRun: () => { meta: { changes: number } } } {
    return {
      _syncRun() {
        const info = stmt.run(...params);
        return { meta: { changes: info.changes } };
      },
      async first<T>(): Promise<T | null> {
        const row = stmt.get(...params);
        return (row as T) ?? null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        const rows = stmt.all(...params);
        return { results: rows as T[] };
      },
      async run(): Promise<{ meta: { changes: number } }> {
        const info = stmt.run(...params);
        return { meta: { changes: info.changes } };
      },
    };
  }

  const wrapper = {
    prepare(sql: string): PreparedStatement {
      const stmt = sqlite.prepare(sql);
      const bound = makeBound(stmt, []);
      return {
        ...bound,
        bind(...values: unknown[]): BoundStatement {
          return makeBound(stmt, values);
        },
      };
    },

    async batch(
      statements: BoundStatement[]
    ): Promise<{ meta: { changes: number } }[]> {
      const results: { meta: { changes: number } }[] = [];
      const run = sqlite.transaction(() => {
        for (const stmt of statements) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing internal sync method for transactional execution
          results.push((stmt as any)._syncRun());
        }
      });
      run();
      return results;
    },
  };

  return wrapper as unknown as D1Database;
}

/**
 * Insert a course with sensible defaults. Override any field via the overrides param.
 */
export async function seedCourse(
  db: D1Database,
  overrides: Partial<{
    id: string;
    name: string;
    city: string;
    platform: string;
    platform_config: string;
    booking_url: string;
    is_active: number;
    last_had_tee_times: string | null;
  }> = {}
): Promise<void> {
  const c = {
    id: "test-course",
    name: "Test Course",
    city: "Minneapolis",
    platform: "foreup",
    platform_config: JSON.stringify({ scheduleId: "1234" }),
    booking_url: "https://example.com/book",
    is_active: 1,
    last_had_tee_times: null as string | null,
    ...overrides,
  };

  await db
    .prepare(
      `INSERT INTO courses (id, name, city, platform, platform_config, booking_url, is_active, last_had_tee_times)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      c.id,
      c.name,
      c.city,
      c.platform,
      c.platform_config,
      c.booking_url,
      c.is_active,
      c.last_had_tee_times
    )
    .run();
}

/**
 * Insert a user with sensible defaults.
 */
export async function seedUser(
  db: D1Database,
  overrides: Partial<{
    id: string;
    google_id: string;
    email: string;
    name: string;
    created_at: string;
  }> = {}
): Promise<void> {
  const u = {
    id: "test-user",
    google_id: "google-123",
    email: "test@example.com",
    name: "Test User",
    created_at: new Date().toISOString(),
    ...overrides,
  };

  await db
    .prepare(
      `INSERT INTO users (id, google_id, email, name, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(u.id, u.google_id, u.email, u.name, u.created_at)
    .run();
}
