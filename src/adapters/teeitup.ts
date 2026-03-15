// ABOUTME: TeeItUp/Kenna platform adapter for fetching tee times.
// ABOUTME: Handles API requests, rate selection, and cents-to-dollars price conversion.
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";

interface TeeItUpRate {
  holes: number;
  trade?: boolean;
  greenFeeWalking: number;
  promotion?: {
    greenFeeWalking: number;
  };
}

interface TeeItUpTeeTime {
  teetime: string;
  maxPlayers: number;
  rates: TeeItUpRate[];
}

interface TeeItUpCourseEntry {
  teetimes: TeeItUpTeeTime[];
}

export class TeeItUpAdapter implements PlatformAdapter {
  readonly platformId = "teeitup";

  async fetchTeeTimes(
    config: CourseConfig,
    date: string,
    _env?: CloudflareEnv
  ): Promise<TeeTime[]> {
    const { alias, apiBase, facilityId, timezone } = config.platformConfig;

    if (!alias) throw new Error("Missing alias in platformConfig");
    if (!apiBase) throw new Error("Missing apiBase in platformConfig");
    if (!facilityId) throw new Error("Missing facilityId in platformConfig");

    const url = `${apiBase}/v2/tee-times?date=${date}&facilityIds=${facilityId}`;

    const response = await fetch(url, {
      headers: { "x-be-alias": alias },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`TeeItUp API returned HTTP ${response.status}`);
    }

    const data: TeeItUpCourseEntry[] = await response.json();

    return data.flatMap((entry) =>
      (entry.teetimes ?? [])
        .filter((tt) => tt.maxPlayers > 0 && tt.rates.length > 0)
        .map((tt) => {
          const rate = tt.rates.find((r) => !r.trade) ?? tt.rates[0];
          const priceInCents = rate.promotion?.greenFeeWalking ?? rate.greenFeeWalking;

          return {
            courseId: config.id,
            time: this.toLocalIso(tt.teetime, timezone ?? "America/Chicago"),
            price: priceInCents / 100,
            holes: rate.holes === 9 ? 9 : 18,
            openSlots: tt.maxPlayers,
            bookingUrl: config.bookingUrl,
          };
        })
    );
  }

  /** Convert UTC ISO timestamp to local ISO (no Z suffix) */
  private toLocalIso(timestamp: string, timezone: string): string {
    if (!timestamp.endsWith("Z")) return timestamp;

    const date = new Date(timestamp);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);

    const get = (type: string) => parts.find((p) => p.type === type)!.value;
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
  }
}
