// ABOUTME: Tests for cron batch assignment via weighted bin-packing.
// ABOUTME: Covers even distribution, CPS weighting, determinism, and edge cases.
import { describe, it, expect } from "vitest";
import { assignBatches, BATCH_COUNT, CHRONOGOLF_LANE, platformWeight, cronToBatchIndex, sleepAfterPoll } from "./batch";
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
    disabled: 0,
    display_notes: null,
    last_had_tee_times: null,
    booking_horizon_days: 7,
    last_horizon_probe: null,
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

describe("sleepAfterPoll", () => {
  it("returns 2500ms for chronogolf to avoid Chronogolf API rate limits (429s)", () => {
    // Tuned up from 1500ms after steady-state monitoring found 25% 429 rate;
    // see docs/plans/2026-04-20-chronogolf-rate-limit-fix.md.
    expect(sleepAfterPoll("chronogolf")).toBe(2500);
  });

  it("returns the default 250ms for platforms with healthy rate-limit headroom", () => {
    expect(sleepAfterPoll("cps_golf")).toBe(250);
    expect(sleepAfterPoll("foreup")).toBe(250);
    expect(sleepAfterPoll("teeitup")).toBe(250);
    expect(sleepAfterPoll("teesnap")).toBe(250);
    expect(sleepAfterPoll("eagle_club")).toBe(250);
    expect(sleepAfterPoll("membersports")).toBe(250);
    expect(sleepAfterPoll("teewire")).toBe(250);
    expect(sleepAfterPoll("golfnow")).toBe(250);
  });

  it("returns the default for unknown platforms rather than throwing", () => {
    expect(sleepAfterPoll("unknown_platform")).toBe(250);
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

  it("balances CPS courses (weight 3) across the non-lane batches", () => {
    const courses = [
      makeCourse("cps-a", "cps_golf"),
      makeCourse("cps-b", "cps_golf"),
      makeCourse("cps-c", "cps_golf"),
      makeCourse("cps-d", "cps_golf"),
      makeCourse("cps-e", "cps_golf"),
    ];
    const result = assignBatches(courses);

    // The chronogolf lane (batch 0) holds no CPS; 5 CPS spread across the 4 non-lane batches.
    expect(result[CHRONOGOLF_LANE]).toHaveLength(0);
    const nonLaneCounts = result
      .filter((_, i) => i !== CHRONOGOLF_LANE)
      .map((b) => b.length);
    expect(nonLaneCounts.reduce((a, b) => a + b, 0)).toBe(5);
    // 5 across 4 batches → balanced within one course (max 2, min 1).
    expect(Math.max(...nonLaneCounts)).toBeLessThanOrEqual(2);
    expect(Math.min(...nonLaneCounts)).toBeGreaterThanOrEqual(1);
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

  it("breaks ties by lowest non-lane batch index", () => {
    // A single non-chronogolf course goes to the lowest-index non-lane batch (1),
    // since the chronogolf lane (batch 0) holds only chronogolf courses.
    const courses = [makeCourse("solo", "foreup")];
    const result = assignBatches(courses);
    expect(result[CHRONOGOLF_LANE]).toHaveLength(0);
    expect(result[1]).toHaveLength(1);
    expect(result[1][0].id).toBe("solo");
  });
});

describe("assignBatches chronogolf lane", () => {
  it("assigns every chronogolf course to the lane (batch 0)", () => {
    const courses = [
      makeCourse("a-chrono", "chronogolf"),
      makeCourse("b-cps", "cps_golf"),
      makeCourse("c-chrono", "chronogolf"),
      makeCourse("d-foreup", "foreup"),
    ];
    const result = assignBatches(courses);

    const laneIds = result[CHRONOGOLF_LANE].map((c) => c.id).sort();
    expect(laneIds).toEqual(["a-chrono", "c-chrono"]);
    // No chronogolf course appears outside the lane.
    for (let i = 0; i < BATCH_COUNT; i++) {
      if (i === CHRONOGOLF_LANE) continue;
      expect(result[i].some((c) => c.platform === "chronogolf")).toBe(false);
    }
  });

  it("keeps non-chronogolf courses out of the lane", () => {
    const courses = Array.from({ length: 8 }, (_, i) =>
      makeCourse(`f-${i}`, "foreup")
    );
    const result = assignBatches(courses);

    expect(result[CHRONOGOLF_LANE]).toHaveLength(0);
    const nonLaneTotal = result
      .filter((_, i) => i !== CHRONOGOLF_LANE)
      .reduce((n, b) => n + b.length, 0);
    expect(nonLaneTotal).toBe(8);
  });

  it("balances non-chronogolf weight across the non-lane batches", () => {
    const courses = Array.from({ length: 12 }, (_, i) =>
      makeCourse(`c-${String(i).padStart(2, "0")}`, "cps_golf")
    );
    const result = assignBatches(courses);

    const nonLaneWeights = result
      .map((b, i) => ({ i, w: b.reduce((s, c) => s + platformWeight(c.platform), 0) }))
      .filter((x) => x.i !== CHRONOGOLF_LANE)
      .map((x) => x.w);
    const max = Math.max(...nonLaneWeights);
    const min = Math.min(...nonLaneWeights);
    expect(max - min).toBeLessThanOrEqual(3); // within one CPS course of balanced
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
