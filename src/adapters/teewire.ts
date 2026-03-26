// ABOUTME: TeeWire platform adapter for fetching tee times.
// ABOUTME: Handles API requests, walking rate selection, and price parsing.
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";

interface TeeWireRate {
  rate_id: number;
  rate_title: string;
  holes: number;
  price: string; // "$51.00"
  description: string;
}

interface TeeWireSlot {
  time: string; // "09:00:00"
  date: string; // "2026-04-15"
  availability: {
    available_spots: number;
    max_spots: number;
  };
  pricing: {
    rates: TeeWireRate[];
  };
}

interface TeeWireResponse {
  success: boolean;
  data: {
    tee_times: TeeWireSlot[];
  };
}

export class TeeWireAdapter implements PlatformAdapter {
  readonly platformId = "teewire";

  async fetchTeeTimes(
    config: CourseConfig,
    date: string,
    _env?: CloudflareEnv
  ): Promise<TeeTime[]> {
    const { tenant, calendarId } = config.platformConfig;

    if (!tenant) {
      throw new Error("Missing tenant in platformConfig");
    }
    if (!calendarId) {
      throw new Error("Missing calendarId in platformConfig");
    }

    const params = new URLSearchParams({
      action: "tee-times",
      calendar_id: calendarId,
      date,
    });

    const url = `https://teewire.app/${tenant}/online/application/web/api/golf-api.php?${params}`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "TwinCitiesTeeTimes/1.0" },
    });

    if (!response.ok) {
      throw new Error(`TeeWire API returned HTTP ${response.status}`);
    }

    const body: TeeWireResponse = await response.json();

    if (!body.success) {
      throw new Error("TeeWire API returned success: false");
    }

    return body.data.tee_times
      .filter((slot) => slot.availability.available_spots > 0)
      .map((slot) => {
        const walkingRate = slot.pricing.rates.find((r) =>
          r.rate_title.includes("Walking")
        );

        const price = walkingRate
          ? parseFloat(walkingRate.price.replace(/[^0-9.]/g, ""))
          : null;

        const holes = walkingRate
          ? walkingRate.holes
          : slot.pricing.rates[0]?.holes ?? 18;

        return {
          courseId: config.id,
          time: `${date}T${slot.time}`,
          price,
          holes: holes === 9 ? 9 : 18,
          openSlots: slot.availability.available_spots,
          bookingUrl: config.bookingUrl,
        } satisfies TeeTime;
      });
  }
}
