// ABOUTME: Tests for tee time sort functions with time-first and distance-first modes.
// ABOUTME: Validates sort behavior for proximity-filtered tee time results.

import { describe, it, expect } from "vitest";
import { sortTeeTimes, type SortableTeeTime } from "./sort-tee-times";

function makeTeeTime(overrides: Partial<SortableTeeTime>): SortableTeeTime {
  return {
    date: "2026-04-15",
    time: "08:00",
    distance: 5,
    ...overrides,
  };
}

describe("sortTeeTimes", () => {
  describe("time mode (default)", () => {
    it("sorts by date+time ascending", () => {
      const input = [
        makeTeeTime({ date: "2026-04-15", time: "10:00", distance: 2 }),
        makeTeeTime({ date: "2026-04-15", time: "08:00", distance: 10 }),
        makeTeeTime({ date: "2026-04-15", time: "09:30", distance: 1 }),
      ];

      const result = sortTeeTimes(input, "time");

      expect(result.map((t) => t.time)).toEqual(["08:00", "09:30", "10:00"]);
    });

    it("breaks time ties by distance ascending", () => {
      const input = [
        makeTeeTime({ time: "08:00", distance: 15 }),
        makeTeeTime({ time: "08:00", distance: 3 }),
        makeTeeTime({ time: "08:00", distance: 8 }),
      ];

      const result = sortTeeTimes(input, "time");

      expect(result.map((t) => t.distance)).toEqual([3, 8, 15]);
    });

    it("sorts earlier dates before later dates", () => {
      const input = [
        makeTeeTime({ date: "2026-04-16", time: "07:00" }),
        makeTeeTime({ date: "2026-04-15", time: "09:00" }),
      ];

      const result = sortTeeTimes(input, "time");

      expect(result.map((t) => t.date)).toEqual(["2026-04-15", "2026-04-16"]);
    });
  });

  describe("distance mode", () => {
    it("sorts by distance ascending", () => {
      const input = [
        makeTeeTime({ distance: 20, time: "07:00" }),
        makeTeeTime({ distance: 3, time: "10:00" }),
        makeTeeTime({ distance: 12, time: "08:00" }),
      ];

      const result = sortTeeTimes(input, "distance");

      expect(result.map((t) => t.distance)).toEqual([3, 12, 20]);
    });

    it("breaks distance ties by date+time ascending", () => {
      const input = [
        makeTeeTime({ distance: 5, time: "10:00" }),
        makeTeeTime({ distance: 5, time: "08:00" }),
        makeTeeTime({ distance: 5, time: "09:00" }),
      ];

      const result = sortTeeTimes(input, "distance");

      expect(result.map((t) => t.time)).toEqual(["08:00", "09:00", "10:00"]);
    });

    it("groups nearby courses (within 0.01mi) together", () => {
      const input = [
        makeTeeTime({ distance: 5.001, time: "10:00" }),
        makeTeeTime({ distance: 5.005, time: "08:00" }),
        makeTeeTime({ distance: 3, time: "11:00" }),
      ];

      const result = sortTeeTimes(input, "distance");

      // 3mi course first, then the two ~5mi courses sorted by time
      expect(result.map((t) => t.time)).toEqual(["11:00", "08:00", "10:00"]);
    });
  });

  describe("handles missing distance", () => {
    it("puts items without distance at the end in distance mode", () => {
      const input = [
        makeTeeTime({ distance: undefined, time: "07:00" }),
        makeTeeTime({ distance: 5, time: "09:00" }),
      ];

      const result = sortTeeTimes(input, "distance");

      expect(result.map((t) => t.time)).toEqual(["09:00", "07:00"]);
    });

    it("sorts items without distance by time in time mode", () => {
      const input = [
        makeTeeTime({ distance: undefined, time: "10:00" }),
        makeTeeTime({ distance: undefined, time: "08:00" }),
      ];

      const result = sortTeeTimes(input, "time");

      expect(result.map((t) => t.time)).toEqual(["08:00", "10:00"]);
    });
  });

  it("does not mutate the input array", () => {
    const input = [
      makeTeeTime({ time: "10:00" }),
      makeTeeTime({ time: "08:00" }),
    ];
    const original = [...input];

    sortTeeTimes(input, "time");

    expect(input).toEqual(original);
  });
});