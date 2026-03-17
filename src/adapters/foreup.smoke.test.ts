// ABOUTME: Live API smoke tests for the ForeUp adapter against San Diego courses.
// ABOUTME: Validates adapter execution, raw API contract, and parsed output fields.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ForeUpAdapter } from "./foreup";
import type { CourseConfig, TeeTime } from "@/types";

const testDate = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 5);
  return d.toISOString().split("T")[0];
})();

const courses: CourseConfig[] = [
  {
    id: "balboa-park",
    name: "Balboa Park",
    platform: "foreup",
    platformConfig: { facilityId: "19348", scheduleId: "1470" },
    bookingUrl: "https://foreupsoftware.com/index.php/booking/19348/1470",
  },
  {
    id: "goat-hill-park",
    name: "Goat Hill Park",
    platform: "foreup",
    platformConfig: { facilityId: "20906", scheduleId: "6161" },
    bookingUrl: "https://foreupsoftware.com/index.php/booking/20906/6161",
  },
];

let captured: { url: string; body: unknown }[];
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  captured = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init?) => {
    const response = await originalFetch(input, init);
    const clone = response.clone();
    try {
      captured.push({ url: String(input), body: await clone.json() });
    } catch {
      /* non-JSON response */
    }
    return response;
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function fetchWithFallback(
  adapter: ForeUpAdapter
): Promise<{ results: TeeTime[]; config: CourseConfig }> {
  for (const config of courses) {
    captured = [];
    const results = await adapter.fetchTeeTimes(config, testDate);
    if (results.length > 0) {
      return { results, config };
    }
  }
  return { results: [], config: courses[0] };
}

describe("ForeUp - live API smoke tests", () => {
  const adapter = new ForeUpAdapter();

  it(
    "Level 1: adapter returns TeeTime[] without throwing",
    async () => {
      const { results } = await fetchWithFallback(adapter);
      expect(Array.isArray(results)).toBe(true);
    },
    15000
  );
});

describe("ForeUp - API contract validation", () => {
  const adapter = new ForeUpAdapter();

  it(
    "Level 2: raw API response matches expected contract",
    async (ctx) => {
      const { results } = await fetchWithFallback(adapter);

      if (results.length === 0) {
        console.warn(
          "ForeUp Level 2: No tee times available from any test course — skipping contract validation"
        );
        ctx.skip();
        return;
      }

      expect(captured.length).toBeGreaterThanOrEqual(1);

      const response = captured[captured.length - 1];
      const data = response.body as Record<string, unknown>[];

      expect(Array.isArray(data)).toBe(true);

      for (const entry of data) {
        expect(entry.time).toMatch(
          /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
        );

        expect(
          entry.green_fee === null ||
            typeof entry.green_fee === "string" ||
            typeof entry.green_fee === "number"
        ).toBe(true);

        expect(typeof entry.available_spots).toBe("number");

        expect(typeof entry.holes).toBe("number");
      }
    },
    15000
  );
});

describe("ForeUp - parsed output validation", () => {
  const adapter = new ForeUpAdapter();

  it(
    "Level 3: parsed TeeTime objects have valid fields",
    async (ctx) => {
      const { results, config } = await fetchWithFallback(adapter);

      if (results.length === 0) {
        console.warn(
          "ForeUp Level 3: No tee times available from any test course — skipping output validation"
        );
        ctx.skip();
        return;
      }

      for (const tt of results) {
        expect(tt.courseId).toBe(config.id);
        expect(tt.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
        expect(new Date(tt.time).getTime()).not.toBeNaN();

        if (tt.price !== null) {
          expect(typeof tt.price).toBe("number");
          expect(Number.isNaN(tt.price)).toBe(false);
        }

        expect([9, 18]).toContain(tt.holes);
        expect(Number.isInteger(tt.openSlots)).toBe(true);
        expect(tt.openSlots).toBeGreaterThanOrEqual(0);
        expect(tt.bookingUrl).toBeTruthy();
      }
    },
    15000
  );
});
