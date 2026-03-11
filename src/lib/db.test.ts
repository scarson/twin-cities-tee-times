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
