// ABOUTME: Integration tests for user account lifecycle and constraint enforcement.
// ABOUTME: Verifies the About page promise: account deletion removes all user data.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedCourse, seedUser } from "@/test/d1-test-helper";

describe("account lifecycle", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = createTestDb();
    await seedCourse(db, { id: "course-a" });
    await seedCourse(db, { id: "course-b", name: "Course B" });
  });

  it("create user → add favorites + clicks → delete → all user data gone", async () => {
    await seedUser(db, { id: "user-1" });

    // Add favorites
    await db
      .prepare(
        "INSERT INTO user_favorites (user_id, course_id, created_at) VALUES (?, ?, ?)"
      )
      .bind("user-1", "course-a", new Date().toISOString())
      .run();
    await db
      .prepare(
        "INSERT INTO user_favorites (user_id, course_id, created_at) VALUES (?, ?, ?)"
      )
      .bind("user-1", "course-b", new Date().toISOString())
      .run();

    // Add booking clicks
    await db
      .prepare(
        "INSERT INTO booking_clicks (user_id, course_id, date, time, clicked_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind("user-1", "course-a", "2026-03-16", "08:30", new Date().toISOString())
      .run();

    // Add a session
    await db
      .prepare(
        "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
      )
      .bind(
        "hash-1",
        "user-1",
        new Date(Date.now() + 86400000).toISOString(),
        new Date().toISOString()
      )
      .run();

    // Add user settings
    await db
      .prepare(
        "INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)"
      )
      .bind("user-1", "theme", "dark")
      .run();

    // Delete the user
    await db.prepare("DELETE FROM users WHERE id = ?").bind("user-1").run();

    // Verify ALL associated data is gone (CASCADE)
    const favorites = await db
      .prepare("SELECT COUNT(*) as cnt FROM user_favorites WHERE user_id = ?")
      .bind("user-1")
      .first<{ cnt: number }>();
    expect(favorites!.cnt).toBe(0);

    const clicks = await db
      .prepare("SELECT COUNT(*) as cnt FROM booking_clicks WHERE user_id = ?")
      .bind("user-1")
      .first<{ cnt: number }>();
    expect(clicks!.cnt).toBe(0);

    const sessions = await db
      .prepare("SELECT COUNT(*) as cnt FROM sessions WHERE user_id = ?")
      .bind("user-1")
      .first<{ cnt: number }>();
    expect(sessions!.cnt).toBe(0);

    const settings = await db
      .prepare("SELECT COUNT(*) as cnt FROM user_settings WHERE user_id = ?")
      .bind("user-1")
      .first<{ cnt: number }>();
    expect(settings!.cnt).toBe(0);

    const user = await db
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind("user-1")
      .first();
    expect(user).toBeNull();
  });

  it("account deletion preserves other users' data", async () => {
    await seedUser(db, { id: "user-1", google_id: "g1", email: "a@test.com" });
    await seedUser(db, { id: "user-2", google_id: "g2", email: "b@test.com" });

    // Both users have favorites for course-a
    await db
      .prepare(
        "INSERT INTO user_favorites (user_id, course_id, created_at) VALUES (?, ?, ?)"
      )
      .bind("user-1", "course-a", new Date().toISOString())
      .run();
    await db
      .prepare(
        "INSERT INTO user_favorites (user_id, course_id, created_at) VALUES (?, ?, ?)"
      )
      .bind("user-2", "course-a", new Date().toISOString())
      .run();

    // Both users have booking clicks
    await db
      .prepare(
        "INSERT INTO booking_clicks (user_id, course_id, date, time, clicked_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(
        "user-1",
        "course-a",
        "2026-03-16",
        "08:00",
        new Date().toISOString()
      )
      .run();
    await db
      .prepare(
        "INSERT INTO booking_clicks (user_id, course_id, date, time, clicked_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(
        "user-2",
        "course-a",
        "2026-03-16",
        "09:00",
        new Date().toISOString()
      )
      .run();

    // Delete user-1
    await db.prepare("DELETE FROM users WHERE id = ?").bind("user-1").run();

    // user-2's data should be intact
    const user2Favs = await db
      .prepare("SELECT COUNT(*) as cnt FROM user_favorites WHERE user_id = ?")
      .bind("user-2")
      .first<{ cnt: number }>();
    expect(user2Favs!.cnt).toBe(1);

    const user2Clicks = await db
      .prepare("SELECT COUNT(*) as cnt FROM booking_clicks WHERE user_id = ?")
      .bind("user-2")
      .first<{ cnt: number }>();
    expect(user2Clicks!.cnt).toBe(1);

    const user2 = await db
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind("user-2")
      .first();
    expect(user2).not.toBeNull();
  });
});

describe("CASCADE on course delete", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = createTestDb();
    await seedCourse(db, { id: "course-x" });
    await seedUser(db, { id: "user-1" });
  });

  it("deleting a course cascades to favorites and booking clicks", async () => {
    await db
      .prepare(
        "INSERT INTO user_favorites (user_id, course_id, created_at) VALUES (?, ?, ?)"
      )
      .bind("user-1", "course-x", new Date().toISOString())
      .run();
    await db
      .prepare(
        "INSERT INTO booking_clicks (user_id, course_id, date, time, clicked_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(
        "user-1",
        "course-x",
        "2026-03-16",
        "08:00",
        new Date().toISOString()
      )
      .run();

    // Delete the course
    await db.prepare("DELETE FROM courses WHERE id = ?").bind("course-x").run();

    const favs = await db
      .prepare("SELECT COUNT(*) as cnt FROM user_favorites WHERE course_id = ?")
      .bind("course-x")
      .first<{ cnt: number }>();
    expect(favs!.cnt).toBe(0);

    const clicks = await db
      .prepare("SELECT COUNT(*) as cnt FROM booking_clicks WHERE course_id = ?")
      .bind("course-x")
      .first<{ cnt: number }>();
    expect(clicks!.cnt).toBe(0);
  });
});

describe("unique constraints", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = createTestDb();
    await seedCourse(db, { id: "course-a" });
    await seedUser(db, { id: "user-1" });
  });

  it("rejects duplicate favorite (same user + course)", async () => {
    await db
      .prepare(
        "INSERT INTO user_favorites (user_id, course_id, created_at) VALUES (?, ?, ?)"
      )
      .bind("user-1", "course-a", new Date().toISOString())
      .run();

    await expect(
      db
        .prepare(
          "INSERT INTO user_favorites (user_id, course_id, created_at) VALUES (?, ?, ?)"
        )
        .bind("user-1", "course-a", new Date().toISOString())
        .run()
    ).rejects.toThrow();
  });

  it("rejects duplicate booking click (same user + course + date + time)", async () => {
    await db
      .prepare(
        "INSERT INTO booking_clicks (user_id, course_id, date, time, clicked_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(
        "user-1",
        "course-a",
        "2026-03-16",
        "08:30",
        new Date().toISOString()
      )
      .run();

    await expect(
      db
        .prepare(
          "INSERT INTO booking_clicks (user_id, course_id, date, time, clicked_at) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(
          "user-1",
          "course-a",
          "2026-03-16",
          "08:30",
          new Date().toISOString()
        )
        .run()
    ).rejects.toThrow();
  });
});
