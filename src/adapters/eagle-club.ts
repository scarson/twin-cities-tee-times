// ABOUTME: Eagle Club Systems platform adapter for fetching tee times.
// ABOUTME: Uses POST requests with a BCC wrapper object containing the dbname identifier.
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";

const API_URL =
  "https://api.eagleclubsystems.online/api/online/OnlineAppointmentRetrieve";

interface EagleClubAppointment {
  Date: string; // "YYYYMMDD"
  Time: string; // "HHMM"
  Slots: number;
  EighteenFee: string; // e.g. "33.30"
  NineFee: string; // e.g. "30.52"
}

interface EagleClubResponse {
  BG: {
    BoolSuccess: boolean;
    StrResult: string;
    StrExceptions: string[];
  };
  LstAppointment: EagleClubAppointment[];
}

export class EagleClubAdapter implements PlatformAdapter {
  readonly platformId = "eagle_club";

  async fetchTeeTimes(
    config: CourseConfig,
    date: string,
    _env?: CloudflareEnv
  ): Promise<TeeTime[]> {
    const { dbname } = config.platformConfig;

    if (!dbname) {
      throw new Error("Missing dbname in platformConfig");
    }

    // Eagle Club uses YYYYMMDD date format (no dashes)
    const eagleDate = date.replace(/-/g, "");

    const body = {
      BCC: {
        StrServer: "GSERVER",
        StrURL: "https://api.EagleClubSystems.online",
        StrDatabase: dbname,
        IntOrganizationID: 1,
        IntOperatorID: 2,
        EmailErrors: false,
        SignalRConnectionID: "",
        PreviousServerDateTime: null,
        PreviousServerDateTimeAsString: null,
        Information: "",
        PrinterName: "",
        CampaignMonitorMasterListName: "",
        CampaignMonitorApiKey: "",
        CampaignMonitorClientID: "",
        LsteInterfaceID: [],
        ipAddress: "",
      },
      StrDate: eagleDate,
      // API requires non-empty StrTime or it throws a DateTime parse error
      StrTime: "0000",
      TeePriceClassID: 0,
      IncludeExisting: false,
      Master_CarriageID: 0,
      Master_TeePriceClassIDs: "",
      OnlineBookingFormat: 0,
      OnlineBookingMaxDays: 1,
    };

    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Eagle Club API returned HTTP ${response.status}`);
    }

    const data: EagleClubResponse = await response.json();

    if (!data.BG.BoolSuccess) {
      const message = data.BG.StrResult || data.BG.StrExceptions.join("; ");
      throw new Error(`Eagle Club API error: ${message}`);
    }

    // Each appointment can carry both NineFee and EighteenFee. Emit one
    // record per populated fee so the app surfaces every bookable variant
    // (mirrors CPS Golf multi-hole expansion).
    const parseFee = (fee: string | undefined | null): number | null => {
      if (!fee) return null;
      const n = parseFloat(fee);
      return Number.isNaN(n) ? null : n;
    };

    const results: TeeTime[] = [];
    for (const appt of data.LstAppointment) {
      const time = this.toIso(date, appt.Time);
      if (appt.EighteenFee) {
        results.push({
          courseId: config.id,
          time,
          price: parseFee(appt.EighteenFee),
          holes: 18,
          openSlots: appt.Slots,
          bookingUrl: config.bookingUrl,
        });
      }
      if (appt.NineFee) {
        results.push({
          courseId: config.id,
          time,
          price: parseFee(appt.NineFee),
          holes: 9,
          openSlots: appt.Slots,
          bookingUrl: config.bookingUrl,
        });
      }
    }
    return results;
  }

  /** Convert "HHMM" time and "YYYY-MM-DD" date to "YYYY-MM-DDTHH:MM:00" */
  private toIso(date: string, time: string): string {
    const hh = time.slice(0, 2);
    const mm = time.slice(2, 4);
    return `${date}T${hh}:${mm}:00`;
  }
}
