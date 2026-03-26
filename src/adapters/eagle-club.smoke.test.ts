// ABOUTME: Live API smoke tests for the Eagle Club Systems adapter against Valleywood.
// ABOUTME: Validates adapter execution, raw API contract, and parsed output fields.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EagleClubAdapter } from "./eagle-club";
import type { CourseConfig, TeeTime } from "@/types";
import { todayCT } from "@/lib/format";

const testDate = (() => {
  const [y, m, d] = todayCT().split("-").map(Number);
  const future = new Date(Date.UTC(y, m - 1, d + 5));
  return future.toISOString().split("T")[0];
})();

const config: CourseConfig = {
  id: "valleywood",
  name: "Valleywood",
  platform: "eagle_club",
  platformConfig: {
    dbname: "mnvalleywood20250115",
  },
  bookingUrl:
    "https://player.eagleclubsystems.online/#/tee-slot?dbname=mnvalleywood20250115",
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

async function fetchTeeTimes(
  adapter: EagleClubAdapter
): Promise<TeeTime[]> {
  captured = [];
  return adapter.fetchTeeTimes(config, testDate);
}

describe("Eagle Club - live API smoke tests", () => {
  const adapter = new EagleClubAdapter();

  it(
    "Level 1: adapter returns TeeTime[] without throwing",
    async () => {
      const results = await fetchTeeTimes(adapter);
      expect(Array.isArray(results)).toBe(true);
    },
    15000
  );
});

describe("Eagle Club - API contract validation", () => {
  const adapter = new EagleClubAdapter();

  it(
    "Level 2: raw API response matches expected contract",
    async (ctx) => {
      const results = await fetchTeeTimes(adapter);

      if (results.length === 0) {
        console.warn(
          "Eagle Club Level 2: No tee times available — skipping contract validation"
        );
        ctx.skip();
        return;
      }

      expect(captured.length).toBeGreaterThanOrEqual(1);

      const response = captured[captured.length - 1];
      const data = response.body as {
        BG: { BoolSuccess: boolean };
        LstAppointment: Record<string, unknown>[];
      };

      expect(data.BG.BoolSuccess).toBe(true);
      expect(Array.isArray(data.LstAppointment)).toBe(true);

      for (const entry of data.LstAppointment) {
        expect(typeof entry.Date).toBe("string");
        expect(entry.Date).toMatch(/^\d{8}$/);

        expect(typeof entry.Time).toBe("string");
        expect(entry.Time).toMatch(/^\d{4}$/);

        expect(typeof entry.Slots).toBe("number");
        expect(typeof entry.EighteenFee).toBe("string");
        expect(typeof entry.NineFee).toBe("string");
      }
    },
    15000
  );
});

describe("Eagle Club - parsed output validation", () => {
  const adapter = new EagleClubAdapter();

  it(
    "Level 3: parsed TeeTime objects have valid fields",
    async (ctx) => {
      const results = await fetchTeeTimes(adapter);

      if (results.length === 0) {
        console.warn(
          "Eagle Club Level 3: No tee times available — skipping output validation"
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

        expect(tt.holes).toBe(18);
        expect(Number.isInteger(tt.openSlots)).toBe(true);
        expect(tt.openSlots).toBeGreaterThanOrEqual(0);
        expect(tt.bookingUrl).toBeTruthy();
      }
    },
    15000
  );
});
