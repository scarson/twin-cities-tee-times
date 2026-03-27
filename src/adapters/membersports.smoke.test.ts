// ABOUTME: Live API smoke tests for the MemberSports adapter against River Oaks.
// ABOUTME: Validates adapter execution, raw API contract, and parsed output fields.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemberSportsAdapter } from "./membersports";
import type { CourseConfig, TeeTime } from "@/types";
import { todayCT } from "@/lib/format";

const testDate = (() => {
  const [y, m, d] = todayCT().split("-").map(Number);
  const future = new Date(Date.UTC(y, m - 1, d + 3));
  return future.toISOString().split("T")[0];
})();

const config: CourseConfig = {
  id: "river-oaks",
  name: "River Oaks Municipal",
  platform: "membersports",
  platformConfig: {
    golfClubId: "9431",
    golfCourseId: "11701",
  },
  bookingUrl: "https://app.membersports.com/tee-times/9431/11701/0",
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
  adapter: MemberSportsAdapter
): Promise<TeeTime[]> {
  captured = [];
  return adapter.fetchTeeTimes(config, testDate);
}

describe.skip("MemberSports - live API smoke tests", () => {
  const adapter = new MemberSportsAdapter();

  it(
    "Level 1: adapter returns TeeTime[] without throwing",
    async () => {
      const results = await fetchTeeTimes(adapter);
      expect(Array.isArray(results)).toBe(true);
    },
    15000
  );
});

describe.skip("MemberSports - API contract validation", () => {
  const adapter = new MemberSportsAdapter();

  it(
    "Level 2: raw API response matches expected contract",
    async (ctx) => {
      const results = await fetchTeeTimes(adapter);

      if (results.length === 0) {
        console.warn(
          "MemberSports Level 2: No tee times available — skipping contract validation"
        );
        ctx.skip();
        return;
      }

      expect(captured.length).toBeGreaterThanOrEqual(1);

      const response = captured[captured.length - 1];
      const data = response.body as {
        teeTime: number;
        items: { teeTime: number; price: number; playerCount: number }[];
      }[];

      expect(Array.isArray(data)).toBe(true);

      for (const slot of data) {
        expect(typeof slot.teeTime).toBe("number");
        expect(slot.teeTime).toBeGreaterThanOrEqual(0);
        expect(slot.teeTime).toBeLessThan(1440);
        expect(Array.isArray(slot.items)).toBe(true);

        for (const item of slot.items) {
          expect(typeof item.teeTime).toBe("number");
          expect(typeof item.price).toBe("number");
          expect(typeof item.playerCount).toBe("number");
        }
      }
    },
    15000
  );
});

describe.skip("MemberSports - parsed output validation", () => {
  const adapter = new MemberSportsAdapter();

  it(
    "Level 3: parsed TeeTime objects have valid fields",
    async (ctx) => {
      const results = await fetchTeeTimes(adapter);

      if (results.length === 0) {
        console.warn(
          "MemberSports Level 3: No tee times available — skipping output validation"
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
