// ABOUTME: Live API smoke tests for the CPS Golf adapter against San Diego courses.
// ABOUTME: Validates adapter execution, raw API contract (3-fetch auth chain), and parsed output.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CpsGolfAdapter } from "./cps-golf";
import type { CourseConfig, TeeTime } from "@/types";
import { todayCT } from "@/lib/format";

const testDate = (() => {
  const [y, m, d] = todayCT().split("-").map(Number);
  const future = new Date(Date.UTC(y, m - 1, d + 5));
  return future.toISOString().split("T")[0];
})();

const basePlatformConfig = {
  subdomain: "jcgsc5",
  websiteId: "94ce5060-0b39-444f-2756-08d8d81fed21",
  siteId: "16",
  terminalId: "3",
  timezone: "America/Los_Angeles",
};

const courses: CourseConfig[] = [
  {
    id: "encinitas-ranch",
    name: "Encinitas Ranch",
    platform: "cps_golf",
    platformConfig: { ...basePlatformConfig, courseIds: "6" },
    bookingUrl: "https://jcgsc5.cps.golf/onlineresweb",
  },
  {
    id: "twin-oaks",
    name: "Twin Oaks",
    platform: "cps_golf",
    platformConfig: { ...basePlatformConfig, courseIds: "4" },
    bookingUrl: "https://jcgsc5.cps.golf/onlineresweb",
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
  adapter: CpsGolfAdapter
): Promise<{ results: TeeTime[]; config: CourseConfig }> {
  for (const config of courses) {
    captured = [];
    // No env arg — direct fetch (no proxy) in Node.js
    const results = await adapter.fetchTeeTimes(config, testDate);
    if (results.length > 0) {
      return { results, config };
    }
  }
  return { results: [], config: courses[0] };
}

describe("CPS Golf - live API smoke tests", () => {
  const adapter = new CpsGolfAdapter();

  it(
    "Level 1: adapter returns TeeTime[] without throwing",
    async () => {
      const { results } = await fetchWithFallback(adapter);
      expect(Array.isArray(results)).toBe(true);
    },
    15000
  );
});

describe("CPS Golf - API contract validation", () => {
  const adapter = new CpsGolfAdapter();

  it(
    "Level 2: raw tee times response matches expected contract",
    async (ctx) => {
      const { results } = await fetchWithFallback(adapter);

      if (results.length === 0) {
        console.warn(
          "CPS Golf Level 2: No tee times available from any test course — skipping contract validation"
        );
        ctx.skip();
        return;
      }

      // CPS makes 3 sequential fetches; find the tee times response
      const teeTimesCapture = captured.find((c) =>
        c.url.includes("TeeTimes")
      );
      expect(teeTimesCapture).toBeDefined();

      const data = teeTimesCapture!.body as Record<string, unknown>;

      // content is either an array (tee times) or object with messageKey
      expect(data.content).toBeDefined();

      if (Array.isArray(data.content)) {
        for (const entry of data.content as Record<string, unknown>[]) {
          expect(typeof entry.startTime).toBe("string");
          expect(entry.startTime as string).toMatch(/\d{4}-\d{2}-\d{2}/);

          if (entry.shItemPrices !== undefined) {
            expect(Array.isArray(entry.shItemPrices)).toBe(true);
            for (const price of entry.shItemPrices as Record<
              string,
              unknown
            >[]) {
              expect(typeof price.price).toBe("number");
            }
          }

          expect(typeof entry.maxPlayer).toBe("number");
          expect(Number.isInteger(entry.maxPlayer)).toBe(true);

          expect(typeof entry.holes).toBe("number");
          expect(Number.isInteger(entry.holes)).toBe(true);
        }
      } else {
        // messageKey response — no tee times available for this date
        expect(
          (data.content as Record<string, unknown>).messageKey
        ).toBeDefined();
      }
    },
    15000
  );
});

describe("CPS Golf - parsed output validation", () => {
  const adapter = new CpsGolfAdapter();

  it(
    "Level 3: parsed TeeTime objects have valid fields",
    async (ctx) => {
      const { results, config } = await fetchWithFallback(adapter);

      if (results.length === 0) {
        console.warn(
          "CPS Golf Level 3: No tee times available from any test course — skipping output validation"
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
