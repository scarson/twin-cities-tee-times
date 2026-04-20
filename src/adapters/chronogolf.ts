// ABOUTME: Chronogolf/Lightspeed platform adapter for fetching tee times.
// ABOUTME: Handles the v2 marketplace API, time format conversion, and price parsing.
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";

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

export class ChronogolfAdapter implements PlatformAdapter {
  readonly platformId = "chronogolf";

  private static readonly PAGE_SIZE = 24;
  private static readonly MAX_PAGES = 10;

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

      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Chronogolf API returned HTTP ${response.status}`);
      }

      const data: ChronogolfResponse = await response.json();

      for (const tt of data.teetimes) {
        const defaultHoles: 9 | 18 = tt.default_price.bookable_holes === 9 ? 9 : 18;
        const courseHoles = tt.course?.bookable_holes;
        const candidateVariants: (9 | 18)[] = Array.isArray(courseHoles)
          ? courseHoles.filter((h): h is 9 | 18 => h === 9 || h === 18)
          : [defaultHoles];

        // If the course array yielded nothing (empty or all unknown values),
        // fall back to the default variant alone — honest one-record output.
        const variants = candidateVariants.length > 0 ? candidateVariants : [defaultHoles];

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
