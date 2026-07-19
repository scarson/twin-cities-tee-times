// ABOUTME: Live API smoke tests for the Teesnap adapter against StoneRidge.
// ABOUTME: Validates adapter execution, raw API contract, and parsed output fields.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TeensnapAdapter } from "./teesnap";
import type { CourseConfig, TeeTime } from "@/types";
import { todayCT } from "@/lib/format";

const testDate = (() => {
  const [y, m, d] = todayCT().split("-").map(Number);
  const future = new Date(Date.UTC(y, m - 1, d + 3));
  return future.toISOString().split("T")[0];
})();

const config: CourseConfig = {
  id: "stoneridge",
  name: "StoneRidge",
  platform: "teesnap",
  platformConfig: {
    subdomain: "stoneridgegc",
    courseId: "1320",
  },
  bookingUrl: "https://stoneridgegc.teesnap.net",
};

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

async function fetchTeeTimes(adapter: TeensnapAdapter): Promise<TeeTime[]> {
  captured = [];
  return adapter.fetchTeeTimes(config, testDate);
}

describe("Teesnap - live API smoke tests", () => {
  const adapter = new TeensnapAdapter();

  it(
    "Level 1: adapter returns TeeTime[] without throwing",
    async () => {
      const results = await fetchTeeTimes(adapter);
      expect(Array.isArray(results)).toBe(true);
    },
    15000
  );
});

describe("Teesnap - API contract validation", () => {
  const adapter = new TeensnapAdapter();

  it(
    "Level 2: raw API response matches expected contract",
    async (ctx) => {
      const results = await fetchTeeTimes(adapter);

      if (results.length === 0) {
        console.warn(
          "Teesnap Level 2: No tee times available — skipping contract validation"
        );
        ctx.skip();
        return;
      }

      expect(captured.length).toBeGreaterThanOrEqual(1);

      const response = captured[captured.length - 1];
      const data = response.body as {
        teeTimes: {
          teeTimes: { teeTime: string; prices: unknown[]; teeOffSections: unknown[] }[];
          bookings: unknown[];
        };
      };

      expect(Array.isArray(data.teeTimes.teeTimes)).toBe(true);
      expect(Array.isArray(data.teeTimes.bookings)).toBe(true);

      for (const tt of data.teeTimes.teeTimes) {
        expect(typeof tt.teeTime).toBe("string");
        expect(tt.teeTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
        expect(Array.isArray(tt.prices)).toBe(true);
        expect(Array.isArray(tt.teeOffSections)).toBe(true);
      }
    },
    15000
  );
});

describe("Teesnap - parsed output validation", () => {
  const adapter = new TeensnapAdapter();

  it(
    "Level 3: parsed TeeTime objects have valid fields",
    async (ctx) => {
      const results = await fetchTeeTimes(adapter);

      if (results.length === 0) {
        console.warn(
          "Teesnap Level 3: No tee times available — skipping output validation"
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
        expect(tt.openSlots).toBeGreaterThan(0);
        expect(tt.bookingUrl).toBeTruthy();
      }
    },
    15000
  );
});
