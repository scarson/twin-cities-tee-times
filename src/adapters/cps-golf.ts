import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";

interface CpsTeeTimes {
  TeeTimes: Array<{
    TeeTimeId: number;
    TeeDateTime: string;
    GreenFee: number;
    NumberOfOpenSlots: number;
    Holes: number;
    CourseId: number;
    CourseName: string;
  }>;
}

export class CpsGolfAdapter implements PlatformAdapter {
  readonly platformId = "cps_golf";

  async fetchTeeTimes(
    config: CourseConfig,
    date: string
  ): Promise<TeeTime[]> {
    const { subdomain, apiKey, websiteId, siteId, terminalId, courseIds } =
      config.platformConfig;

    if (!apiKey) {
      throw new Error("Missing apiKey in platformConfig");
    }

    const baseUrl = `https://${subdomain}.cps.golf/onlineres/onlineapi/api/v1/onlinereservation`;

    // CPS Golf uses JS Date toString format: "Wed Apr 15 2026"
    const searchDate = this.formatCpsDate(date);

    const params = new URLSearchParams({
      searchDate,
      courseIds: courseIds ?? "",
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

    const url = `${baseUrl}/TeeTimes?${params}`;

    const response = await fetch(url, {
        headers: {
          "x-apikey": apiKey,
          "client-id": "onlineresweb",
          ...(websiteId && { "x-websiteid": websiteId }),
          ...(siteId && { "x-siteid": siteId }),
          ...(terminalId && { "x-terminalid": terminalId }),
          "x-componentid": "1",
          "x-moduleid": "7",
          "x-productid": "1",
          "x-ismobile": "false",
          "x-timezone-offset": "300",
          "x-timezoneid": "America/Chicago",
        },
      });

      if (!response.ok) {
        throw new Error(`CPS Golf API returned HTTP ${response.status}`);
      }

      const data: CpsTeeTimes = await response.json();

      return (data.TeeTimes ?? []).map((tt) => ({
        courseId: config.id,
        time: tt.TeeDateTime,
        price: tt.GreenFee ?? null,
        holes: tt.Holes === 9 ? 9 : 18,
        openSlots: tt.NumberOfOpenSlots,
        bookingUrl: config.bookingUrl,
      }));
  }

  /** Convert "2026-04-15" → "Wed Apr 15 2026" (CPS Golf's expected format) */
  private formatCpsDate(isoDate: string): string {
    const d = new Date(isoDate + "T12:00:00Z"); // noon UTC to avoid timezone issues
    // toLocaleDateString adds commas ("Wed, Apr 15, 2026") but CPS expects
    // the Date.toDateString() format without commas ("Wed Apr 15 2026")
    return d
      .toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "2-digit",
        year: "numeric",
        timeZone: "America/Chicago",
      })
      .replace(/,/g, "");
  }
}
