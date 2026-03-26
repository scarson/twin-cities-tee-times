// ABOUTME: Chronogolf/Lightspeed platform adapter for fetching tee times.
// ABOUTME: Handles the v2 marketplace API, time format conversion, and price parsing.
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";

interface ChronogolfTeeTime {
  start_time: string; // local time e.g. "9:15"
  date: string; // "YYYY-MM-DD"
  max_player_size: number;
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

  async fetchTeeTimes(
    config: CourseConfig,
    date: string,
    _env?: CloudflareEnv
  ): Promise<TeeTime[]> {
    const { courseId } = config.platformConfig;

    if (!courseId) {
      throw new Error("Missing courseId in platformConfig");
    }

    const params = new URLSearchParams({
      start_date: date,
      course_ids: courseId,
      holes: "9,18",
      start_time: "00:00",
      page: "1",
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

    return data.teetimes.map((tt) => ({
      courseId: config.id,
      time: this.toIso(tt.date, tt.start_time),
      price: tt.default_price.green_fee,
      holes: tt.default_price.bookable_holes === 9 ? 9 : 18,
      openSlots: tt.max_player_size,
      bookingUrl: config.bookingUrl,
    }));
  }

  /** Convert date "YYYY-MM-DD" and start_time "H:MM" → "YYYY-MM-DDTHH:MM:00" */
  private toIso(date: string, startTime: string): string {
    const [h, m] = startTime.split(":");
    return `${date}T${h.padStart(2, "0")}:${m}:00`;
  }
}
