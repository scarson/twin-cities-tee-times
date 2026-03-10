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
    date: string
  ): Promise<TeeTime[]> {
    const { alias, apiBase, facilityId } = config.platformConfig;

    if (!alias) throw new Error("Missing alias in platformConfig");
    if (!apiBase) throw new Error("Missing apiBase in platformConfig");
    if (!facilityId) throw new Error("Missing facilityId in platformConfig");

    const url = `${apiBase}/v2/tee-times?date=${date}&facilityIds=${facilityId}`;

    const response = await fetch(url, {
      headers: { "x-be-alias": alias },
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
            time: tt.teetime,
            price: priceInCents / 100,
            holes: rate.holes === 9 ? 9 : 18,
            openSlots: tt.maxPlayers,
            bookingUrl: config.bookingUrl,
          };
        })
    );
  }
}
