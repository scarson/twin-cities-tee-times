// ABOUTME: Live API smoke tests for the Chronogolf adapter against Baker National.
// ABOUTME: Validates adapter execution, raw API contract, and parsed output fields.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ChronogolfAdapter } from "./chronogolf";
import type { CourseConfig, TeeTime } from "@/types";
import { todayCT } from "@/lib/format";

const testDate = (() => {
  const [y, m, d] = todayCT().split("-").map(Number);
  const future = new Date(Date.UTC(y, m - 1, d + 5));
  return future.toISOString().split("T")[0];
})();

const courses: CourseConfig[] = [
  {
    id: "baker-national-championship",
    name: "Baker National Championship",
    platform: "chronogolf",
    platformConfig: {
      clubSlug: "baker-national-golf-club",
      courseId: "e9d8899b-a26b-44fa-a6f6-ebaec3db1656",
    },
    bookingUrl: "https://www.chronogolf.com/club/baker-national-golf-club#teetimes",
  },
  {
    id: "baker-national-evergreen",
    name: "Baker National Evergreen",
    platform: "chronogolf",
    platformConfig: {
      clubSlug: "baker-national-golf-club",
      courseId: "49987288-e1cd-415b-b1cc-a3e8b243ee40",
    },
    bookingUrl: "https://www.chronogolf.com/club/baker-national-golf-club#teetimes",
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

// Chronogolf's CDN blocks Node.js undici fetch (TLS fingerprinting) with 403.
// The adapter works from Cloudflare Workers and curl. Smoke tests skip on 403.
async function fetchWithFallback(
  adapter: ChronogolfAdapter
): Promise<{ results: TeeTime[]; config: CourseConfig; blocked: boolean }> {
  for (const config of courses) {
    captured = [];
    try {
      const results = await adapter.fetchTeeTimes(config, testDate);
      if (results.length > 0) {
        return { results, config, blocked: false };
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("HTTP 403")) {
        return { results: [], config, blocked: true };
      }
      throw e;
    }
  }
  return { results: [], config: courses[0], blocked: false };
}

describe("Chronogolf - live API smoke tests", () => {
  const adapter = new ChronogolfAdapter();

  it(
    "Level 1: adapter returns TeeTime[] without throwing",
    async (ctx) => {
      const { results, blocked } = await fetchWithFallback(adapter);
      if (blocked) {
        console.warn(
          "Chronogolf Level 1: API returned 403 (TLS fingerprint block from Node.js undici) — skipping"
        );
        ctx.skip();
        return;
      }
      expect(Array.isArray(results)).toBe(true);
    },
    15000
  );
});

describe("Chronogolf - API contract validation", () => {
  const adapter = new ChronogolfAdapter();

  it(
    "Level 2: raw API response matches expected contract",
    async (ctx) => {
      const { results, blocked } = await fetchWithFallback(adapter);

      if (blocked) {
        console.warn(
          "Chronogolf Level 2: API returned 403 (TLS fingerprint block) — skipping"
        );
        ctx.skip();
        return;
      }

      if (results.length === 0) {
        console.warn(
          "Chronogolf Level 2: No tee times available from any test course — skipping contract validation"
        );
        ctx.skip();
        return;
      }

      expect(captured.length).toBeGreaterThanOrEqual(1);

      const response = captured[captured.length - 1];
      const data = response.body as { status: string; teetimes: Record<string, unknown>[] };

      expect(typeof data.status).toBe("string");
      expect(Array.isArray(data.teetimes)).toBe(true);

      for (const entry of data.teetimes) {
        expect(typeof entry.start_time).toBe("string");
        expect(typeof entry.date).toBe("string");
        expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(typeof entry.max_player_size).toBe("number");

        const price = entry.default_price as Record<string, unknown>;
        expect(typeof price.green_fee).toBe("number");
        expect(typeof price.bookable_holes).toBe("number");
      }
    },
    15000
  );
});

describe("Chronogolf - parsed output validation", () => {
  const adapter = new ChronogolfAdapter();

  it(
    "Level 3: parsed TeeTime objects have valid fields",
    async (ctx) => {
      const { results, config, blocked } = await fetchWithFallback(adapter);

      if (blocked) {
        console.warn(
          "Chronogolf Level 3: API returned 403 (TLS fingerprint block) — skipping"
        );
        ctx.skip();
        return;
      }

      if (results.length === 0) {
        console.warn(
          "Chronogolf Level 3: No tee times available from any test course — skipping output validation"
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
