// ABOUTME: Tests for cron batch assignment via weighted bin-packing.
// ABOUTME: Covers even distribution, CPS weighting, determinism, and edge cases.
import { describe, it, expect } from "vitest";
import { assignBatches, BATCH_COUNT, platformWeight, cronToBatchIndex } from "./batch";
import type { CourseRow } from "@/types";

function makeCourse(id: string, platform: string): CourseRow {
  return {
    id,
    name: id,
    city: "Test",
    state: "MN",
    platform,
    platform_config: "{}",
    booking_url: "https://example.com",
    is_active: 1,
    last_had_tee_times: null,
  };
}

describe("platformWeight", () => {
  it("returns 3 for cps_golf", () => {
    expect(platformWeight("cps_golf")).toBe(3);
  });

  it("returns 1 for other platforms", () => {
    expect(platformWeight("foreup")).toBe(1);
    expect(platformWeight("teeitup")).toBe(1);
    expect(platformWeight("chronogolf")).toBe(1);
  });
});

describe("assignBatches", () => {
  it("distributes courses across all batches", () => {
    const courses = Array.from({ length: 10 }, (_, i) =>
      makeCourse(`course-${String(i).padStart(2, "0")}`, "foreup")
    );
    const result = assignBatches(courses);

    expect(result).toHaveLength(BATCH_COUNT);
    const allIds = result.flat().map((c) => c.id);
    expect(allIds).toHaveLength(10);
  });

  it("balances CPS courses (weight 3) across batches", () => {
    const courses = [
      makeCourse("cps-a", "cps_golf"),
      makeCourse("cps-b", "cps_golf"),
      makeCourse("cps-c", "cps_golf"),
      makeCourse("cps-d", "cps_golf"),
      makeCourse("cps-e", "cps_golf"),
    ];
    const result = assignBatches(courses);

    // 5 CPS courses with weight 3 each → one per batch
    for (let i = 0; i < BATCH_COUNT; i++) {
      expect(result[i]).toHaveLength(1);
    }
  });

  it("assigns heavier platforms to lighter batches", () => {
    const courses = [
      makeCourse("a-foreup", "foreup"),     // weight 1
      makeCourse("b-foreup", "foreup"),     // weight 1
      makeCourse("c-cps", "cps_golf"),      // weight 3
    ];
    const result = assignBatches(courses);

    // After sorting by ID: a-foreup, b-foreup, c-cps
    // Greedy: a-foreup→batch 0(w=1), b-foreup→batch 1(w=1), c-cps→batch 2(w=3)
    // Verify no batch exceeds total_weight/BATCH_COUNT + max_single_weight
    const totalWeight = 5;
    const maxBatchWeight = Math.max(
      ...result.map((batch) =>
        batch.reduce((sum, c) => sum + platformWeight(c.platform), 0)
      )
    );
    expect(maxBatchWeight).toBeLessThanOrEqual(
      Math.ceil(totalWeight / BATCH_COUNT) + 3
    );
  });

  it("is deterministic — same input gives same output", () => {
    const courses = [
      makeCourse("z-course", "foreup"),
      makeCourse("a-course", "cps_golf"),
      makeCourse("m-course", "teeitup"),
    ];
    const result1 = assignBatches(courses);
    const result2 = assignBatches(courses);

    for (let i = 0; i < BATCH_COUNT; i++) {
      expect(result1[i].map((c) => c.id)).toEqual(
        result2[i].map((c) => c.id)
      );
    }
  });

  it("handles empty course list", () => {
    const result = assignBatches([]);
    expect(result).toHaveLength(BATCH_COUNT);
    for (const batch of result) {
      expect(batch).toHaveLength(0);
    }
  });

  it("handles fewer courses than batches", () => {
    const courses = [makeCourse("only-one", "foreup")];
    const result = assignBatches(courses);

    const nonEmpty = result.filter((b) => b.length > 0);
    expect(nonEmpty).toHaveLength(1);
    expect(nonEmpty[0][0].id).toBe("only-one");
  });

  it("breaks ties by lowest batch index", () => {
    // Single course should always go to batch 0
    const courses = [makeCourse("solo", "foreup")];
    const result = assignBatches(courses);
    expect(result[0]).toHaveLength(1);
    expect(result[0][0].id).toBe("solo");
  });
});

describe("cronToBatchIndex", () => {
  it("maps */5 to batch 0", () => {
    expect(cronToBatchIndex("*/5 * * * *")).toBe(0);
  });

  it("maps staggered crons to batches 1-4", () => {
    expect(cronToBatchIndex("1-56/5 * * * *")).toBe(1);
    expect(cronToBatchIndex("2-57/5 * * * *")).toBe(2);
    expect(cronToBatchIndex("3-58/5 * * * *")).toBe(3);
    expect(cronToBatchIndex("4-59/5 * * * *")).toBe(4);
  });

  it("throws on unknown cron expression", () => {
    expect(() => cronToBatchIndex("0 * * * *")).toThrow(
      "Unknown cron expression"
    );
  });
});
