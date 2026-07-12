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
 * Minimum delay between consecutive Chronogolf HTTP requests (~15 req/min).
 * Chronogolf's Cloudflare rate rule admits roughly 20 requests/min per IP
 * before serving HTTP 429 for ~60s (measured from poll_log telemetry,
 * 2026-07); this spacing — combined with the single batch lane
 * (CHRONOGOLF_LANE in src/lib/batch.ts) — keeps the global request rate
 * under that ceiling. See docs/plans/2026-06-08-chronogolf-rate-limit-pacing-plan.md
 * and docs/plans/2026-07-12-chronogolf-429-backoff.md.
 */
export const CHRONOGOLF_MIN_REQUEST_INTERVAL_MS = 4000;

/**
 * Delay applied before the next Chronogolf request after an HTTP 429.
 * Sized to outlast the observed ~60s block window so the lane stops sending
 * into a mitigation period where every request is wasted. If the block is
 * longer, the next request draws another 429 and re-arms the backoff, so the
 * effective rate self-corrects at one probe per backoff window.
 */
export const CHRONOGOLF_429_BACKOFF_MS = 61_000;

export class ChronogolfAdapter implements PlatformAdapter {
  readonly platformId = "chronogolf";

  private static readonly PAGE_SIZE = 24;
  private static readonly MAX_PAGES = 10;

  private readonly minRequestIntervalMs: number;
  private readonly rateLimitBackoffMs: number;
  private nextAllowedAt = 0;

  constructor(opts?: { minRequestIntervalMs?: number; rateLimitBackoffMs?: number }) {
    this.minRequestIntervalMs =
      opts?.minRequestIntervalMs ?? CHRONOGOLF_MIN_REQUEST_INTERVAL_MS;
    this.rateLimitBackoffMs =
      opts?.rateLimitBackoffMs ?? CHRONOGOLF_429_BACKOFF_MS;
  }

  /**
   * Wait until at least minRequestIntervalMs has elapsed since the previous
   * Chronogolf request, then reserve the next slot. Instance state spaces every
   * request in one invocation — across pages AND across courses, since the
   * registry reuses one adapter instance. The single-lane invariant means only
   * one invocation polls Chronogolf at a time, so nextAllowedAt is never
   * contended across invocations; a value left over in a warm isolate is
   * either in the past (no wait) or a 429 backoff that is still correct to
   * honor.
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
        if (response.status === 429) {
          // Push the next request past the block window instead of sending
          // into it; requests during mitigation are rejected anyway.
          this.nextAllowedAt = Math.max(
            this.nextAllowedAt,
            Date.now() + this.rateLimitBackoffMs
          );
          const retryAfter = response.headers.get("Retry-After");
          throw new Error(
            `Chronogolf API returned HTTP 429${retryAfter ? ` (Retry-After: ${retryAfter})` : ""}`
          );
        }
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
