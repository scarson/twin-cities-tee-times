// ABOUTME: MemberSports platform adapter for fetching tee times.
// ABOUTME: Uses POST with static API key; converts minutes-since-midnight to ISO times.
import type { CourseConfig, PlatformAdapter, TeeTime } from "@/types";
import { classifyHoles } from "@/lib/parse-holes";

const API_URL =
  "https://api.membersports.com/api/v1.0/GolfClubs/onlineBookingTeeTimes";
const API_KEY = "A9814038-9E19-4683-B171-5A06B39147FC";

interface MemberSportsItem {
  bookingNotAllowed: boolean;
  golfCourseNumberOfHoles: number;
  hide: boolean;
  playerCount: number;
  price: number;
  teeTime: number;
}

interface MemberSportsSlot {
  teeTime: number;
  items: MemberSportsItem[];
}

export class MemberSportsAdapter implements PlatformAdapter {
  readonly platformId = "membersports";

  async fetchTeeTimes(
    config: CourseConfig,
    date: string,
    _env?: CloudflareEnv
  ): Promise<TeeTime[]> {
    const { golfClubId, golfCourseId } = config.platformConfig;

    if (!golfClubId) throw new Error("Missing golfClubId in platformConfig");
    if (!golfCourseId) throw new Error("Missing golfCourseId in platformConfig");

    const clubId = parseInt(golfClubId, 10);
    const courseId = parseInt(golfCourseId, 10);
    if (Number.isNaN(clubId)) throw new Error("Invalid golfClubId in platformConfig");
    if (Number.isNaN(courseId)) throw new Error("Invalid golfCourseId in platformConfig");

    const body = {
      configurationTypeId: 0,
      date,
      golfClubGroupId: 0,
      golfClubId: clubId,
      golfCourseId: courseId,
      groupSheetTypeId: 0,
      memberProfileId: 0,
    };

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-api-key": API_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`MemberSports API returned HTTP ${response.status}`);
    }

    const data: MemberSportsSlot[] = await response.json();

    if (!Array.isArray(data)) {
      throw new Error("MemberSports API returned unexpected response shape");
    }

    const results: TeeTime[] = [];

    for (const slot of data) {
      if (slot.items.length === 0) continue;

      // River Oaks (our only MS course) always returns one item per slot,
      // but the schema allows multiple. Surface that via a warn so a future
      // MS course with multi-hole slots can't silently drop variants.
      if (slot.items.length > 1) {
        console.warn(
          `MemberSports: slot ${slot.teeTime} has ${slot.items.length} items for course ${config.id} — only first is used`
        );
      }

      const item = slot.items[0];
      if (item.bookingNotAllowed || item.hide) continue;

      const holes = classifyHoles(item.golfCourseNumberOfHoles);
      if (holes === null) {
        console.warn(
          `MemberSports: unknown golfCourseNumberOfHoles=${item.golfCourseNumberOfHoles} for course ${config.id} — skipping`
        );
        continue;
      }

      // availableCount is always 0 in unauthenticated responses; use standard foursome max
      const openSlots = 4 - item.playerCount;
      if (openSlots <= 0) continue;

      results.push({
        courseId: config.id,
        time: this.minutesToIso(date, slot.teeTime),
        price: item.price != null && !Number.isNaN(item.price) ? item.price : null,
        holes,
        openSlots,
        bookingUrl: config.bookingUrl,
      });
    }

    return results;
  }

  /** Convert minutes since midnight to "YYYY-MM-DDTHH:MM:00" */
  private minutesToIso(date: string, minutes: number): string {
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    return `${date}T${hh}:${mm}:00`;
  }
}
