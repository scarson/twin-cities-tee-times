// ABOUTME: ForeUp platform adapter for fetching tee times.
// ABOUTME: Handles API requests, time format conversion, and price parsing.
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";
import { parseHoleVariants } from "@/lib/parse-holes";

interface ForeUpTeeTime {
  time: string; // "YYYY-MM-DD HH:MM"
  available_spots: number;
  green_fee: string | null;
  holes: number | string | null;
  schedule_id: number;
  teesheet_side_name?: string | null;
  reround_teesheet_side_name?: string | null;
}

/**
 * Parse the upstream `holes` field into one or more hole-count variants.
 * ForeUp returns either a number (9, 18) OR a compound string ("9/18",
 * "9,18") indicating a slot bookable as either. Delegates to the shared
 * `parseHoleVariants` helper; unknown/empty values fall back to [18] to
 * preserve historical behavior (a ForeUp record with unparseable holes
 * should still surface, annotated as 18-hole).
 */
function parseHolesField(h: number | string | null | undefined): (9 | 18)[] {
  const variants = parseHoleVariants(h);
  return variants.length > 0 ? variants : [18];
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

    return data.flatMap((tt) => {
      const isInformative = (name: string | null | undefined): name is string =>
        !!name && name !== "New Tee Sheet";
      const nines = isInformative(tt.teesheet_side_name) && isInformative(tt.reround_teesheet_side_name)
        ? `${tt.teesheet_side_name}/${tt.reround_teesheet_side_name}`
        : undefined;

      const priceNum = tt.green_fee !== null && !Number.isNaN(parseFloat(tt.green_fee))
        ? parseFloat(tt.green_fee)
        : null;

      const holeVariants = parseHolesField(tt.holes);

      return holeVariants.map((holes) => ({
        courseId: config.id,
        time: this.toIso(tt.time),
        price: priceNum,
        holes,
        openSlots: tt.available_spots,
        bookingUrl: config.bookingUrl,
        ...(nines && { nines }),
      }));
    });
  }

  /** Convert "YYYY-MM-DD HH:MM" → "YYYY-MM-DDTHH:MM:00" */
  private toIso(timeStr: string): string {
    return timeStr.replace(" ", "T") + ":00";
  }
}
