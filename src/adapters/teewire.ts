// ABOUTME: TeeWire platform adapter for fetching tee times.
// ABOUTME: Handles API requests, walking rate selection, and price parsing.
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";
import { proxyFetch, type ProxyConfig } from "@/lib/proxy-fetch";
import { classifyHoles } from "@/lib/parse-holes";

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
    env?: CloudflareEnv
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

    const proxy = this.getProxyConfig(env);
    const response = await this.doFetch(url, {
      method: "GET",
      headers: { "User-Agent": "TwinCitiesTeeTimes/1.0" },
    }, proxy);

    if (!response.ok) {
      throw new Error(`TeeWire API returned HTTP ${response.status}`);
    }

    const body = (await response.json()) as TeeWireResponse;

    if (!body.success) {
      throw new Error("TeeWire API returned success: false");
    }

    return body.data.tee_times
      .filter((slot) => slot.availability.available_spots > 0)
      .flatMap((slot) => {
        // Group rates by hole count; within each group, prefer Walking rate.
        // If no Walking rate in a group, emit the group with price=null
        // (Riding rates include cart costs — not comparable to green fees).
        // Unknown rate.holes values (e.g. 27) are skipped rather than
        // silently collapsed to 18.
        const ratesByHoles = new Map<9 | 18, TeeWireRate[]>();
        for (const rate of slot.pricing.rates) {
          const holes = classifyHoles(rate.holes);
          if (holes === null) continue;
          if (!ratesByHoles.has(holes)) {
            ratesByHoles.set(holes, []);
          }
          ratesByHoles.get(holes)!.push(rate);
        }

        const records: TeeTime[] = [];
        for (const [holes, rates] of ratesByHoles) {
          const walkingRate = rates.find((r) => r.rate_title.includes("Walking"));
          const price = walkingRate
            ? parseFloat(walkingRate.price.replace(/[^0-9.]/g, ""))
            : null;

          records.push({
            courseId: config.id,
            time: `${date}T${slot.time}`,
            price,
            holes,
            openSlots: slot.availability.available_spots,
            bookingUrl: config.bookingUrl,
          } satisfies TeeTime);
        }
        return records;
      });
  }

  private getProxyConfig(env?: CloudflareEnv): ProxyConfig | null {
    if (env?.FETCH_PROXY_URL && env?.AWS_ACCESS_KEY_ID && env?.AWS_SECRET_ACCESS_KEY) {
      return {
        proxyUrl: env.FETCH_PROXY_URL,
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
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
