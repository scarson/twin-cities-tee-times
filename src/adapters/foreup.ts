// ABOUTME: ForeUp platform adapter for fetching tee times.
// ABOUTME: Handles API requests, time format conversion, and price parsing.
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";

interface ForeUpTeeTime {
  time: string; // "YYYY-MM-DD HH:MM"
  available_spots: number;
  green_fee: string | null;
  holes: number;
  schedule_id: number;
  teesheet_side_name?: string | null;
  reround_teesheet_side_name?: string | null;
}

export class ForeUpAdapter implements PlatformAdapter {
  readonly platformId = "foreup";

  async fetchTeeTimes(
    config: CourseConfig,
    date: string,
    _env?: CloudflareEnv
  ): Promise<TeeTime[]> {
    const { scheduleId } = config.platformConfig;

    if (!scheduleId) {
      throw new Error("Missing scheduleId in platformConfig");
    }

    // ForeUp API expects MM-DD-YYYY date format
    const [y, m, d] = date.split("-");
    const foreupDate = `${m}-${d}-${y}`;

    const params = new URLSearchParams({
      date: foreupDate,
      time: "all",
      holes: "0",
      players: "0",
      booking_class: "default",
      specials_only: "0",
      schedule_id: scheduleId,
      api_key: "no_limits",
    });

    const url = `https://foreupsoftware.com/index.php/api/booking/times?${params}`;

    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

    if (!response.ok) {
      throw new Error(`ForeUp API returned HTTP ${response.status}`);
    }

    const data: ForeUpTeeTime[] = await response.json();

    return data.map((tt) => {
      const nines = tt.teesheet_side_name && tt.reround_teesheet_side_name
        ? `${tt.teesheet_side_name}/${tt.reround_teesheet_side_name}`
        : undefined;

      return {
        courseId: config.id,
        time: this.toIso(tt.time),
        price: tt.green_fee !== null && !Number.isNaN(parseFloat(tt.green_fee))
          ? parseFloat(tt.green_fee)
          : null,
        holes: tt.holes === 9 ? 9 : 18,
        openSlots: tt.available_spots,
        bookingUrl: config.bookingUrl,
        ...(nines && { nines }),
      };
    });
  }

  /** Convert "YYYY-MM-DD HH:MM" → "YYYY-MM-DDTHH:MM:00" */
  private toIso(timeStr: string): string {
    return timeStr.replace(" ", "T") + ":00";
  }
}
