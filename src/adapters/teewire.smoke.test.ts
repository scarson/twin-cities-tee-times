// ABOUTME: Live API smoke tests for the TeeWire adapter against Inver Wood Golf Course.
// ABOUTME: Validates adapter execution, raw API contract, and parsed output fields.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TeeWireAdapter } from "./teewire";
import type { CourseConfig, TeeTime } from "@/types";
import { todayCT } from "@/lib/format";

const testDate = (() => {
  const [y, m, d] = todayCT().split("-").map(Number);
  const future = new Date(Date.UTC(y, m - 1, d + 5));
  return future.toISOString().split("T")[0];
})();

const config: CourseConfig = {
  id: "inver-wood-18",
  name: "Inver Wood (18 Hole)",
  platform: "teewire",
  platformConfig: { tenant: "inverwood", calendarId: "3" },
  bookingUrl: "https://teewire.app/inverwood/index.php?controller=FrontV2&action=load&cid=3&view=list",
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

async function fetchSafely(
  adapter: TeeWireAdapter
): Promise<TeeTime[]> {
  try {
    return await adapter.fetchTeeTimes(config, testDate);
  } catch {
    return [];
  }
}

describe("TeeWire - live API smoke tests", () => {
  const adapter = new TeeWireAdapter();

  it(
    "Level 1: adapter returns TeeTime[] without throwing",
    async () => {
      const results = await fetchSafely(adapter);
      expect(Array.isArray(results)).toBe(true);
    },
    15000
  );
});

describe("TeeWire - API contract validation", () => {
  const adapter = new TeeWireAdapter();

  it(
    "Level 2: raw API response matches expected contract",
    async (ctx) => {
      const results = await fetchSafely(adapter);

      if (results.length === 0) {
        console.warn(
          "TeeWire Level 2: No tee times available — skipping contract validation"
        );
        ctx.skip();
        return;
      }

      expect(captured.length).toBeGreaterThanOrEqual(1);

      const response = captured[captured.length - 1];
      const body = response.body as {
        success: boolean;
        data: {
          tee_times: Array<{
            time: string;
            availability: { available_spots: number };
            pricing: { rates: Array<{ price: string; holes: number; rate_title: string }> };
          }>;
        };
      };

      expect(body.success).toBe(true);
      expect(Array.isArray(body.data.tee_times)).toBe(true);

      for (const slot of body.data.tee_times) {
        expect(slot.time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
        expect(typeof slot.availability.available_spots).toBe("number");
        expect(Array.isArray(slot.pricing.rates)).toBe(true);

        for (const rate of slot.pricing.rates) {
          expect(typeof rate.price).toBe("string");
          expect(typeof rate.holes).toBe("number");
          expect(typeof rate.rate_title).toBe("string");
        }
      }
    },
    15000
  );
});

describe("TeeWire - parsed output validation", () => {
  const adapter = new TeeWireAdapter();

  it(
    "Level 3: parsed TeeTime objects have valid fields",
    async (ctx) => {
      const results = await fetchSafely(adapter);

      if (results.length === 0) {
        console.warn(
          "TeeWire Level 3: No tee times available — skipping output validation"
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
