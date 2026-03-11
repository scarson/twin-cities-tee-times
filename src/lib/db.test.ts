// ABOUTME: Tests for the sqliteIsoNow SQL fragment helper.
// ABOUTME: Verifies it produces strftime expressions matching JS ISO 8601 format.
import { describe, it, expect } from "vitest";
import { sqliteIsoNow } from "./db";

describe("sqliteIsoNow", () => {
  it("returns strftime expression with no modifier", () => {
    expect(sqliteIsoNow()).toBe("strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  });

  it("returns strftime expression with a modifier", () => {
    expect(sqliteIsoNow("-30 seconds")).toBe(
      "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 seconds')"
    );
  });

  it("returns strftime expression with days modifier", () => {
    expect(sqliteIsoNow("-7 days")).toBe(
      "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')"
    );
  });
});

describe("sqliteIsoNow format verification", () => {
  it("produces format that lexicographically sorts with toISOString()", () => {
    // The strftime format '%Y-%m-%dT%H:%M:%fZ' produces e.g. "2026-03-11T12:00:00.000Z"
    // JS toISOString() produces e.g. "2026-03-11T12:00:00.000Z"
    // Both use 'T' separator and 'Z' suffix, so lexicographic comparison works.
    const jsTimestamp = new Date("2026-03-11T12:00:00Z").toISOString();
    // Simulate what strftime would produce for the same instant
    const strftimeOutput = "2026-03-11T12:00:00.000Z";
    expect(jsTimestamp).toBe(strftimeOutput);
  });

  it("T-separated timestamps sort correctly (unlike space-separated)", () => {
    const jsTimestamp = "2026-03-11T12:00:00.000Z"; // from toISOString()
    const sqliteDatetime = "2026-03-11 12:30:00";    // from datetime()
    const sqliteStrftime = "2026-03-11T12:30:00.000Z"; // from strftime ISO

    // BUG: space-separated datetime is ALWAYS less than T-separated JS timestamp
    // because space (ASCII 32) < 'T' (ASCII 84). This means:
    //   "polled_at > datetime('now', '-30 seconds')" is ALWAYS TRUE
    expect(jsTimestamp > sqliteDatetime).toBe(true); // always true = broken

    // FIX: strftime ISO format sorts correctly
    expect(jsTimestamp > sqliteStrftime).toBe(false); // 12:00 < 12:30 = correct
    expect(jsTimestamp < sqliteStrftime).toBe(true);  // 12:00 < 12:30 = correct
  });
});

describe("regression guard: no raw datetime('now in SQL", () => {
  it("no source files use datetime('now' in SQL queries", async () => {
    const fs = await import("fs");
    const path = await import("path");

    // Recursively find all .ts files under src/, excluding test files
    function findTsFiles(dir: string): string[] {
      const files: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...findTsFiles(full));
        } else if (
          entry.name.endsWith(".ts") &&
          !entry.name.endsWith(".test.ts")
        ) {
          files.push(full);
        }
      }
      return files;
    }

    const srcDir = path.resolve(process.cwd(), "src");
    const tsFiles = findTsFiles(srcDir);
    const violations: string[] = [];

    for (const file of tsFiles) {
      const content = fs.readFileSync(file, "utf-8");
      if (content.includes("datetime('now")) {
        violations.push(path.relative(srcDir, file));
      }
    }

    expect(violations).toEqual([]);
  });
});
