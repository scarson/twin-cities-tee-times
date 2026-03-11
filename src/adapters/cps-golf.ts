// ABOUTME: CPS Golf (Club Prophet) platform adapter for fetching tee times.
// ABOUTME: Handles v5 OAuth2 auth flow, transaction registration, and response parsing.
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";

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
    date: string
  ): Promise<TeeTime[]> {
    const { subdomain } = config.platformConfig;

    if (!subdomain) {
      throw new Error("Missing subdomain in platformConfig");
    }

    const baseUrl = `https://${subdomain}.cps.golf/onlineres/onlineapi/api/v1/onlinereservation`;
    const timezone = config.platformConfig.timezone ?? "America/Chicago";

    const token = await this.getToken(subdomain);
    const headers = this.buildHeaders(config, token, timezone);
    const transactionId = await this.registerTransaction(
      baseUrl,
      token,
      headers
    );

    const searchDate = this.formatCpsDate(date, timezone);

    const params = new URLSearchParams({
      searchDate,
      courseIds: config.platformConfig.courseIds ?? "",
      transactionId,
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

    const response = await fetch(`${baseUrl}/TeeTimes?${params}`, {
      headers: { ...headers, "x-requestid": crypto.randomUUID() },
    });

    if (!response.ok) {
      throw new Error(`CPS Golf API returned HTTP ${response.status}`);
    }

    const data: CpsV5Response = await response.json();

    if (!Array.isArray(data.content)) {
      return [];
    }

    return data.content
      .filter((tt) => tt.maxPlayer > 0)
      .map((tt) => ({
        courseId: config.id,
        time: tt.startTime, // already ISO 8601 from CPS API
        price: this.extractGreenFee(tt.shItemPrices),
        holes: tt.holes === 9 ? 9 : 18,
        openSlots: tt.maxPlayer,
        bookingUrl: config.bookingUrl,
      }));
  }

  private async getToken(subdomain: string): Promise<string> {
    const url = `https://${subdomain}.cps.golf/identityapi/myconnect/token/short`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "client_id=onlinereswebshortlived",
    });

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
    headers: Record<string, string>
  ): Promise<string> {
    const transactionId = crypto.randomUUID();

    const response = await fetch(`${baseUrl}/RegisterTransactionId`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "x-requestid": crypto.randomUUID(),
      },
      body: JSON.stringify({ transactionId }),
    });

    if (!response.ok) {
      throw new Error("CPS Golf transaction registration failed");
    }

    const result: boolean = await response.json();
    if (!result) {
      throw new Error("CPS Golf transaction registration failed");
    }

    return transactionId;
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
    prices: Array<{ shItemCode: string; price: number }>
  ): number | null {
    const greenFee = prices.find((p) =>
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
