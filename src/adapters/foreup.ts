// ABOUTME: ForeUp platform adapter for fetching tee times.
// ABOUTME: Handles API requests, time format conversion, and price parsing.
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";

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
 * Upstream ForeUp returns either a number (9, 18) OR a compound string
 * ("9/18", "9,18") indicating a slot bookable as either. Expands compound
 * strings into the list of variants the adapter should emit.
 *
 * Values other than 9 or 18 (e.g., hypothetical 27-hole courses) are coerced
 * to [18]. 27/36-hole support is explicitly out of scope.
 */
function parseHolesField(h: number | string | null | undefined): (9 | 18)[] {
  if (typeof h === "number") return [h === 9 ? 9 : 18];
  if (h == null) return [18];
  const s = String(h).trim();
  if (s === "") return [18];
  const nums = s
    .split(/\D+/)
    .map((n) => parseInt(n, 10))
    .filter((n) => !Number.isNaN(n));
  const has9 = nums.includes(9);
  const has18 = nums.includes(18);
  if (has9 && has18) return [9, 18];
  if (has9) return [9];
  return [18];
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
