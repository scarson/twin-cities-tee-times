// ABOUTME: Chronogolf/Lightspeed platform adapter for fetching tee times.
// ABOUTME: Handles the v2 marketplace API, time format conversion, and price parsing.
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";
import { classifyHoles, parseHoleVariants } from "@/lib/parse-holes";

interface ChronogolfTeeTime {
  start_time: string; // local time e.g. "9:15"
  date: string; // "YYYY-MM-DD"
  max_player_size: number;
  course?: {
    bookable_holes?: number | number[] | null;
  };
  default_price: {
    green_fee: number;
    bookable_holes: number;
  };
}

interface ChronogolfResponse {
  status: string;
  teetimes: ChronogolfTeeTime[];
}

/**
 * Minimum delay between consecutive Chronogolf HTTP requests (~0.9 req/sec).
 * Chronogolf enforces a per-IP rate limit (~1 req/sec) shared across all
 * concurrent Worker invocations; this spacing — combined with the single batch
 * lane (CHRONOGOLF_LANE in src/lib/batch.ts) — keeps the global request rate
 * under that ceiling. See docs/plans/2026-06-08-chronogolf-rate-limit-pacing-plan.md.
 */
export const CHRONOGOLF_MIN_REQUEST_INTERVAL_MS = 1100;

export class ChronogolfAdapter implements PlatformAdapter {
  readonly platformId = "chronogolf";

  private static readonly PAGE_SIZE = 24;
  private static readonly MAX_PAGES = 10;

  private readonly minRequestIntervalMs: number;
  private nextAllowedAt = 0;

  constructor(opts?: { minRequestIntervalMs?: number }) {
    this.minRequestIntervalMs =
      opts?.minRequestIntervalMs ?? CHRONOGOLF_MIN_REQUEST_INTERVAL_MS;
  }

  /**
   * Wait until at least minRequestIntervalMs has elapsed since the previous
   * Chronogolf request, then reserve the next slot. Instance state spaces every
   * request in one invocation — across pages AND across courses, since the
   * registry reuses one adapter instance. The single-lane invariant means only
   * one invocation polls Chronogolf at a time, so nextAllowedAt is never
   * contended across invocations; a value left over in a warm isolate is always
   * in the past and causes no wait.
   */
  private async throttle(): Promise<void> {
    const now = Date.now();
    const wait = this.nextAllowedAt - now;
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.nextAllowedAt = Math.max(now, this.nextAllowedAt) + this.minRequestIntervalMs;
  }

  async fetchTeeTimes(
    config: CourseConfig,
    date: string,
    _env?: CloudflareEnv
  ): Promise<TeeTime[]> {
    const { courseId } = config.platformConfig;

    if (!courseId) {
      throw new Error("Missing courseId in platformConfig");
    }

    const allTeeTimes: TeeTime[] = [];

    for (let page = 1; page <= ChronogolfAdapter.MAX_PAGES; page++) {
      const params = new URLSearchParams({
        start_date: date,
        course_ids: courseId,
        holes: "9,18",
        start_time: "00:00",
        page: String(page),
      });

      const url = `https://www.chronogolf.com/marketplace/v2/teetimes?${params}`;

      await this.throttle();
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Chronogolf API returned HTTP ${response.status}`);
      }

      const data: ChronogolfResponse = await response.json();

      for (const tt of data.teetimes) {
        // The per-rate `default_price.bookable_holes` tells us which variant
        // the quoted price applies to; the per-course `course.bookable_holes`
        // (array when multi-hole) enumerates every variant bookable in this
        // slot. When neither parses cleanly we fall back to 18 so a
        // misclassified record is still surfaced (the alternative — silently
        // dropping it — is worse).
        const defaultHoles: 9 | 18 = classifyHoles(tt.default_price.bookable_holes) ?? 18;
        const courseVariants = parseHoleVariants(tt.course?.bookable_holes);
        const variants: (9 | 18)[] = courseVariants.length > 0 ? courseVariants : [defaultHoles];

        for (const h of variants) {
          allTeeTimes.push({
            courseId: config.id,
            time: this.toIso(tt.date, tt.start_time),
            price: h === defaultHoles ? tt.default_price.green_fee : null,
            holes: h,
            openSlots: tt.max_player_size,
            bookingUrl: config.bookingUrl,
          });
        }
      }

      if (data.teetimes.length < ChronogolfAdapter.PAGE_SIZE) break;
    }

    return allTeeTimes;
  }

  /** Convert date "YYYY-MM-DD" and start_time "H:MM" → "YYYY-MM-DDTHH:MM:00" */
  private toIso(date: string, startTime: string): string {
    const [h, m] = startTime.split(":");
    return `${date}T${h.padStart(2, "0")}:${m}:00`;
  }
}
