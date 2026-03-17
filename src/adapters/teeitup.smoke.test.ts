// ABOUTME: Live API smoke tests for the TeeItUp adapter against San Diego courses.
// ABOUTME: Validates adapter execution, raw API contract, and parsed output fields.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TeeItUpAdapter } from "./teeitup";
import type { CourseConfig, TeeTime } from "@/types";
import { todayCT } from "@/lib/format";

const testDate = (() => {
  const [y, m, d] = todayCT().split("-").map(Number);
  const future = new Date(Date.UTC(y, m - 1, d + 5));
  return future.toISOString().split("T")[0];
})();

const courses: CourseConfig[] = [
  {
    id: "coronado",
    name: "Coronado",
    platform: "teeitup",
    platformConfig: {
      alias: "coronado-gc-3-14-be",
      apiBase: "https://phx-api-be-east-1b.kenna.io",
      facilityId: "10985",
      timezone: "America/Los_Angeles",
    },
    bookingUrl: "https://coronado-gc-3-14-be.book.teeitup.com",
  },
  {
    id: "lomas-santa-fe",
    name: "Lomas Santa Fe",
    platform: "teeitup",
    platformConfig: {
      alias: "lomas-santa-fe-executive-golf-course",
      apiBase: "https://phx-api-be-east-1b.kenna.io",
      facilityId: "1241",
      timezone: "America/Los_Angeles",
    },
    bookingUrl:
      "https://lomas-santa-fe-executive-golf-course.book.teeitup.com",
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
  adapter: TeeItUpAdapter
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

describe("TeeItUp - live API smoke tests", () => {
  const adapter = new TeeItUpAdapter();

  it(
    "Level 1: adapter returns TeeTime[] without throwing",
    async () => {
      const { results } = await fetchWithFallback(adapter);
      expect(Array.isArray(results)).toBe(true);
    },
    15000
  );
});

describe("TeeItUp - API contract validation", () => {
  const adapter = new TeeItUpAdapter();

  it(
    "Level 2: raw API response matches expected contract",
    async (ctx) => {
      const { results } = await fetchWithFallback(adapter);

      if (results.length === 0) {
        console.warn(
          "TeeItUp Level 2: No tee times available from any test course — skipping contract validation"
        );
        ctx.skip();
        return;
      }

      expect(captured.length).toBeGreaterThanOrEqual(1);

      const response = captured[captured.length - 1];
      const data = response.body as Record<string, unknown>[];

      expect(Array.isArray(data)).toBe(true);

      for (const entry of data) {
        const teetimes = entry.teetimes as Record<string, unknown>[];
        expect(Array.isArray(teetimes)).toBe(true);

        for (const tt of teetimes) {
          expect(typeof tt.teetime).toBe("string");
          expect(tt.teetime as string).toMatch(/Z$/);

          const rates = tt.rates as Record<string, unknown>[];
          expect(Array.isArray(rates)).toBe(true);
          for (const rate of rates) {
            // API may provide greenFeeWalking, greenFeeCart, or both
            const hasGreenFee =
              typeof rate.greenFeeWalking === "number" ||
              typeof rate.greenFeeCart === "number";
            expect(hasGreenFee).toBe(true);
          }

          expect(typeof tt.maxPlayers).toBe("number");
          expect(Number.isInteger(tt.maxPlayers)).toBe(true);
        }
      }
    },
    15000
  );
});

describe("TeeItUp - parsed output validation", () => {
  const adapter = new TeeItUpAdapter();

  it(
    "Level 3: parsed TeeTime objects have valid fields",
    async (ctx) => {
      const { results, config } = await fetchWithFallback(adapter);

      if (results.length === 0) {
        console.warn(
          "TeeItUp Level 3: No tee times available from any test course — skipping output validation"
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
