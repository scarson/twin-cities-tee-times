// ABOUTME: CPS Golf (Club Prophet) platform adapter for fetching tee times.
// ABOUTME: Supports v5 (bearer token + transaction) and v4 (apiKey header) auth flows.
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";
import { proxyFetch, type ProxyConfig } from "@/lib/proxy-fetch";

interface CpsV5TeeTime {
  startTime: string;
  holes: number;
  maxPlayer: number;
  shItemPrices: Array<{
    shItemCode: string;
    price: number;
  }>;
}

interface CpsV5Response {
  transactionId: string;
  isSuccess: boolean;
  content: CpsV5TeeTime[] | { messageKey: string };
}

export class CpsGolfAdapter implements PlatformAdapter {
  readonly platformId = "cps_golf";

  async fetchTeeTimes(
    config: CourseConfig,
    date: string,
    env?: CloudflareEnv
  ): Promise<TeeTime[]> {
    const { subdomain } = config.platformConfig;

    if (!subdomain) {
      throw new Error("Missing subdomain in platformConfig");
    }

    const baseUrl = `https://${subdomain}.cps.golf/onlineres/onlineapi/api/v1/onlinereservation`;
    const timezone = config.platformConfig.timezone ?? "America/Chicago";
    const isV4 = config.platformConfig.authType === "v4";

    const proxy = this.getProxyConfig(env);

    let headers: Record<string, string>;
    const searchDate = this.formatCpsDate(date, timezone);

    const params = new URLSearchParams({
      searchDate,
      courseIds: config.platformConfig.courseIds ?? "",
      holes: "0",
      numberOfPlayer: "0",
      searchTimeType: "0",
      teeOffTimeMin: "0",
      teeOffTimeMax: "23",
      isChangeTeeOffTime: "true",
      teeSheetSearchView: "5",
      classCode: "R",
      defaultOnlineRate: "N",
      isUseCapacityPricing: "false",
      memberStoreId: "1",
      searchType: "1",
    });

    if (isV4) {
      const apiKey = env?.CPS_V4_API_KEY;
      if (!apiKey) {
        throw new Error("Missing CPS_V4_API_KEY secret for v4 auth");
      }
      headers = this.buildV4Headers(config, apiKey, timezone);
      const transactionId = await this.tryRegisterTransaction(
        baseUrl,
        apiKey,
        headers,
        proxy
      );
      if (transactionId) {
        params.set("transactionId", transactionId);
      }
    } else {
      const token = await this.getToken(subdomain, proxy);
      headers = this.buildHeaders(config, token, timezone);
      const transactionId = await this.registerTransaction(
        baseUrl,
        token,
        headers,
        proxy
      );
      params.set("transactionId", transactionId);
    }

    const response = await this.doFetch(`${baseUrl}/TeeTimes?${params}`, {
      method: "GET",
      headers: { ...headers, "x-requestid": crypto.randomUUID() },
    }, proxy);

    if (!response.ok) {
      throw new Error(`CPS Golf API returned HTTP ${response.status}`);
    }

    const data: CpsV5Response = await response.json();

    if (!Array.isArray(data.content)) {
      return [];
    }

    return data.content
      .filter((tt) => tt.maxPlayer > 0)
      .flatMap((tt) => {
        // CPS multi-hole courses encode variants in shItemPrices as
        // `GreenFee9` and `GreenFee18` SKUs. A record with both SKUs is a
        // multi-hole slot; a record with only one is a single-hole slot.
        // The record-level `tt.holes` is unreliable on multi-hole courses
        // (Francis A Gross: always 9 even when 18 is bookable). See D-3.
        const variants: { holes: 9 | 18; price: number }[] = [];
        for (const item of tt.shItemPrices ?? []) {
          if (item.shItemCode === "GreenFee9") {
            variants.push({ holes: 9, price: item.price });
          } else if (item.shItemCode === "GreenFee18") {
            variants.push({ holes: 18, price: item.price });
          }
        }

        return variants.map((v) => ({
          courseId: config.id,
          time: tt.startTime,
          price: v.price,
          holes: v.holes,
          openSlots: tt.maxPlayer,
          bookingUrl: config.bookingUrl,
        }));
      });
  }

  private async getToken(subdomain: string, proxy: ProxyConfig | null): Promise<string> {
    const url = `https://${subdomain}.cps.golf/identityapi/myconnect/token/short`;

    const response = await this.doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "client_id=onlinereswebshortlived",
    }, proxy);

    if (!response.ok) {
      throw new Error(
        `CPS Golf token request failed: HTTP ${response.status}`
      );
    }

    const data: { access_token: string } = await response.json();
    return data.access_token;
  }

  private async registerTransaction(
    baseUrl: string,
    token: string,
    headers: Record<string, string>,
    proxy: ProxyConfig | null
  ): Promise<string> {
    const transactionId = crypto.randomUUID();

    const response = await this.doFetch(`${baseUrl}/RegisterTransactionId`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "x-requestid": crypto.randomUUID(),
      },
      body: JSON.stringify({ transactionId }),
    }, proxy);

    if (!response.ok) {
      throw new Error("CPS Golf transaction registration failed");
    }

    const result: boolean = await response.json();
    if (!result) {
      throw new Error("CPS Golf transaction registration failed");
    }

    return transactionId;
  }

  private async tryRegisterTransaction(
    baseUrl: string,
    token: string,
    headers: Record<string, string>,
    proxy: ProxyConfig | null
  ): Promise<string | null> {
    const transactionId = crypto.randomUUID();

    const response = await this.doFetch(`${baseUrl}/RegisterTransactionId`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "x-requestid": crypto.randomUUID(),
      },
      body: JSON.stringify({ transactionId }),
    }, proxy);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error("CPS Golf transaction registration failed");
    }

    const result: boolean = await response.json();
    if (!result) {
      throw new Error("CPS Golf transaction registration failed");
    }

    return transactionId;
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

    if (hasUrl || hasKey || hasSecret) {
      const present = [hasUrl && "FETCH_PROXY_URL", hasKey && "AWS_ACCESS_KEY_ID", hasSecret && "AWS_SECRET_ACCESS_KEY"].filter(Boolean);
      const missing = [!hasUrl && "FETCH_PROXY_URL", !hasKey && "AWS_ACCESS_KEY_ID", !hasSecret && "AWS_SECRET_ACCESS_KEY"].filter(Boolean);
      console.warn(`Partial proxy config: have ${present.join(", ")} but missing ${missing.join(", ")} — falling back to direct fetch`);
    }

    return null;
  }

  /**
   * Fetch via proxy or direct. In proxy mode, the request goes through
   * the Lambda proxy (which has its own 10s upstream timeout). In direct
   * mode, it's a standard fetch with a 10s AbortSignal timeout.
   *
   * The `signal` property from RequestInit is intentionally NOT forwarded
   * to the proxy path — the Lambda proxy has its own timeout layering.
   * Do NOT "fix" this by adding signal support to proxyFetch.
   */
  private async doFetch(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
    proxy: ProxyConfig | null
  ): Promise<{ ok: boolean; status: number; json: () => Promise<any> }> {
    if (proxy) {
      const result = await proxyFetch(
        {
          url,
          method: init.method,
          headers: init.headers,
          body: init.body,
        },
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
      body: init.body,
      signal: AbortSignal.timeout(10000),
    });
    return { ok: response.ok, status: response.status, json: () => response.json() };
  }

  private buildV4Headers(
    config: CourseConfig,
    apiKey: string,
    timezone: string
  ): Record<string, string> {
    const { websiteId, siteId, terminalId } = config.platformConfig;

    return {
      "x-apikey": apiKey,
      "client-id": "js1",
      ...(websiteId && { "x-websiteid": websiteId }),
      ...(siteId && { "x-siteid": siteId }),
      ...(terminalId && { "x-terminalid": terminalId }),
      "x-componentid": "1",
      "x-moduleid": "7",
      "x-productid": "1",
      "x-ismobile": "false",
      "x-timezone-offset": String(this.getTimezoneOffset(timezone)),
      "x-timezoneid": timezone,
    };
  }

  private buildHeaders(
    config: CourseConfig,
    token: string,
    timezone: string
  ): Record<string, string> {
    const { websiteId, siteId, terminalId } = config.platformConfig;

    return {
      Authorization: `Bearer ${token}`,
      "client-id": "onlineresweb",
      ...(websiteId && { "x-websiteid": websiteId }),
      ...(siteId && { "x-siteid": siteId }),
      ...(terminalId && { "x-terminalid": terminalId }),
      "x-componentid": "1",
      "x-moduleid": "7",
      "x-productid": "1",
      "x-ismobile": "false",
      "x-timezone-offset": String(this.getTimezoneOffset(timezone)),
      "x-timezoneid": timezone,
    };
  }

  private extractGreenFee(
    prices?: Array<{ shItemCode: string; price: number }>
  ): number | null {
    const greenFee = prices?.find((p) =>
      p.shItemCode.startsWith("GreenFee")
    );
    return greenFee?.price ?? null;
  }

  private getTimezoneOffset(timezone: string): number {
    const now = new Date();
    const utc = new Date(
      now.toLocaleString("en-US", { timeZone: "UTC" })
    );
    const local = new Date(
      now.toLocaleString("en-US", { timeZone: timezone })
    );
    return (utc.getTime() - local.getTime()) / 60000;
  }

  /** Convert "2026-04-15" → "Wed Apr 15 2026" (CPS Golf's expected format) */
  private formatCpsDate(isoDate: string, timezone: string): string {
    const d = new Date(isoDate + "T12:00:00Z"); // noon UTC to avoid timezone issues
    return d
      .toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "2-digit",
        year: "numeric",
        timeZone: timezone,
      })
      .replace(/,/g, "");
  }
}
