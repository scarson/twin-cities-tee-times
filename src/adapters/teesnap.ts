// ABOUTME: Teesnap platform adapter for fetching tee times.
// ABOUTME: Calculates availability from booking/golfer data; handles seasonal closures.
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";
import { proxyFetch, type ProxyConfig } from "@/lib/proxy-fetch";
import { classifyHoles } from "@/lib/parse-holes";

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
    env?: CloudflareEnv
  ): Promise<TeeTime[]> {
    const { subdomain, courseId } = config.platformConfig;

    if (!subdomain) throw new Error("Missing subdomain in platformConfig");
    if (!courseId) throw new Error("Missing courseId in platformConfig");

    const url =
      `https://${subdomain}.teesnap.net/customer-api/teetimes-day` +
      `?course=${courseId}&date=${date}&players=1&holes=18&addons=off`;

    const origin = `https://${subdomain}.teesnap.net`;

    const proxy = this.getProxyConfig(env);
    const response = await this.doFetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: `${origin}/`,
      },
    }, proxy);

    if (!response.ok) {
      throw new Error(`Teesnap API returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as TeensnapResponse;

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
        for (const bookingId of section.bookings ?? []) {
          totalBooked += golferCounts.get(bookingId) ?? 0;
        }
      }

      if (allHeld) continue;

      const openSlots = 4 - totalBooked;
      if (openSlots <= 0) continue;

      // Emit one record per known roundType price variant. Iterates in the
      // order the API returned. Unknown roundTypes are logged and skipped
      // (so future drift surfaces in logs instead of silently dropping
      // tee times — see decision D-1 in docs/plans/2026-04-20-overnight-decisions.md).
      for (const priceEntry of tt.prices) {
        const holes = classifyHoles(priceEntry.roundType);
        if (holes === null) {
          console.warn(
            `Teesnap: unknown roundType "${priceEntry.roundType}" for course ${config.id} — skipping`
          );
          continue;
        }

        const priceNum =
          priceEntry.price && !Number.isNaN(parseFloat(priceEntry.price))
            ? parseFloat(priceEntry.price)
            : null;

        results.push({
          courseId: config.id,
          time: tt.teeTime,
          price: priceNum,
          holes,
          openSlots,
          bookingUrl: config.bookingUrl,
        });
      }
    }

    return results;
  }

  private getProxyConfig(env?: CloudflareEnv): ProxyConfig | null {
    const hasUrl = !!env?.FETCH_PROXY_URL;
    const hasKey = !!env?.AWS_ACCESS_KEY_ID;
    const hasSecret = !!env?.AWS_SECRET_ACCESS_KEY;

    if (hasUrl && hasKey && hasSecret) {
      return {
        proxyUrl: env.FETCH_PROXY_URL!,
        accessKeyId: env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
      };
    }

    return null;
  }

  private async doFetch(
    url: string,
    init: { method: string; headers: Record<string, string> },
    proxy: ProxyConfig | null
  ): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
    if (proxy) {
      const result = await proxyFetch(
        { url, method: init.method, headers: init.headers },
        proxy
      );
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        json: () => Promise.resolve(JSON.parse(result.body)),
      };
    }
    const response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      signal: AbortSignal.timeout(10000),
    });
    return { ok: response.ok, status: response.status, json: () => response.json() };
  }
}
