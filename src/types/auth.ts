// ABOUTME: TypeScript interfaces for auth-related D1 row types.
// ABOUTME: Used by auth library and route handlers for type-safe D1 queries.

/** User row from D1 */
export interface UserRow {
  id: string;
  google_id: string;
  email: string;
  name: string;
  created_at: string;
}

/** Session row from D1 */
export interface SessionRow {
  token_hash: string;
  user_id: string;
  expires_at: string;
  created_at: string;
}

/** User favorite row from D1 (joined with courses for API responses) */
export interface UserFavoriteRow {
  user_id: string;
  course_id: string;
  created_at: string;
}

/** Booking click row from D1 */
export interface BookingClickRow {
  id: number;
  user_id: string;
  course_id: string;
  date: string;
  time: string;
  clicked_at: string;
}
