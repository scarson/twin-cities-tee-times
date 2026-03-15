// ABOUTME: TypeScript interfaces for the app's domain model.
// ABOUTME: Defines CourseConfig, TeeTime, PlatformAdapter, D1 row types, and auth row types.
/** Platform-specific configuration for a course's booking system */
export interface CourseConfig {
  id: string;
  name: string;
  platform: string;
  platformConfig: Record<string, string>;
  bookingUrl: string;
}

/** A single available tee time */
export interface TeeTime {
  courseId: string;
  time: string; // ISO 8601 local time (no Z suffix) — adapters convert UTC to course timezone
  price: number | null;
  holes: 9 | 18;
  openSlots: number;
  bookingUrl: string;
}

/** Platform adapter interface — each booking platform implements this */
export interface PlatformAdapter {
  platformId: string;
  fetchTeeTimes(config: CourseConfig, date: string, env?: CloudflareEnv): Promise<TeeTime[]>;
}

/** Course row from D1 */
export interface CourseRow {
  id: string;
  name: string;
  city: string;
  platform: string;
  platform_config: string; // JSON string
  booking_url: string;
  is_active: number; // SQLite boolean
  last_had_tee_times: string | null;
}

/** Tee time row from D1 */
export interface TeeTimeRow {
  id: number;
  course_id: string;
  date: string;
  time: string;
  price: number | null;
  holes: number;
  open_slots: number;
  booking_url: string;
  fetched_at: string;
}

/** Poll log row from D1 */
export interface PollLogRow {
  id: number;
  course_id: string;
  date: string;
  polled_at: string;
  status: "success" | "error" | "no_data";
  tee_time_count: number;
  error_message: string | null;
}

export type { UserRow, SessionRow, UserFavoriteRow, BookingClickRow } from "./auth";
