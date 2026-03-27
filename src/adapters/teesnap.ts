// ABOUTME: Teesnap platform adapter for fetching tee times.
// ABOUTME: Calculates availability from booking/golfer data; handles seasonal closures.
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";

interface TeensnapBooking {
  bookingId: number;
  golfers: number[];
}

interface TeensnapPrice {
  roundType: string;
  price: string;
  rackRatePrice: string;
}

interface TeensnapSection {
  teeOff: string;
  bookings: number[];
  isHeld: boolean;
}

interface TeensnapTeeTime {
  teeTime: string;
  prices: TeensnapPrice[];
  teeOffSections: TeensnapSection[];
}

interface TeensnapResponse {
  errors?: string;
  teeTimes?: {
    bookings: TeensnapBooking[];
    teeTimes: TeensnapTeeTime[];
  };
}

export class TeensnapAdapter implements PlatformAdapter {
  readonly platformId = "teesnap";

  async fetchTeeTimes(
    config: CourseConfig,
    date: string,
    _env?: CloudflareEnv
  ): Promise<TeeTime[]> {
    const { subdomain, courseId } = config.platformConfig;

    if (!subdomain) throw new Error("Missing subdomain in platformConfig");
    if (!courseId) throw new Error("Missing courseId in platformConfig");

    const url =
      `https://${subdomain}.teesnap.net/customer-api/teetimes-day` +
      `?course=${courseId}&date=${date}&players=1&holes=18&addons=off`;

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Teesnap API returned HTTP ${response.status}`);
    }

    const data: TeensnapResponse = await response.json();

    // date_not_allowed means the course is closed for the season — not an error
    if (data.errors === "date_not_allowed") {
      return [];
    }

    if (!data.teeTimes) {
      throw new Error("Teesnap API returned unexpected response shape");
    }

    // Build booking lookup: bookingId -> golfer count
    const golferCounts = new Map<number, number>();
    for (const booking of data.teeTimes.bookings ?? []) {
      golferCounts.set(booking.bookingId, booking.golfers.length);
    }

    const results: TeeTime[] = [];

    for (const tt of data.teeTimes.teeTimes) {
      // Sum booked golfers across all non-held sections
      let allHeld = true;
      let totalBooked = 0;

      for (const section of tt.teeOffSections) {
        if (section.isHeld) continue;
        allHeld = false;
        for (const bookingId of section.bookings) {
          totalBooked += golferCounts.get(bookingId) ?? 0;
        }
      }

      if (allHeld) continue;

      const openSlots = 4 - totalBooked;
      if (openSlots <= 0) continue;

      // Prefer 18-hole price, fall back to 9-hole
      const eighteenPrice = tt.prices.find(
        (p) => p.roundType === "EIGHTEEN_HOLE"
      );
      const ninePrice = tt.prices.find((p) => p.roundType === "NINE_HOLE");
      const selectedPrice = eighteenPrice ?? ninePrice;

      results.push({
        courseId: config.id,
        time: tt.teeTime,
        price: selectedPrice && !Number.isNaN(parseFloat(selectedPrice.price))
          ? parseFloat(selectedPrice.price)
          : null,
        holes: eighteenPrice ? 18 : 9,
        openSlots,
        bookingUrl: config.bookingUrl,
      });
    }

    return results;
  }
}
