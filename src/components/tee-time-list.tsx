// ABOUTME: Tee time list component rendering available times with price, slots, and staleness.
// ABOUTME: Groups times by course with links to course detail pages.
"use client";

import Link from "next/link";
import { formatTime, staleAge } from "@/lib/format";

interface TeeTimeItem {
  course_id: string;
  course_name: string;
  course_city: string;
  date: string;
  time: string;
  price: number | null;
  holes: number;
  open_slots: number;
  booking_url: string;
  fetched_at: string;
}

interface TeeTimeListProps {
  teeTimes: TeeTimeItem[];
  loading: boolean;
}

export function TeeTimeList({ teeTimes, loading }: TeeTimeListProps) {
  if (loading) {
    return (
      <p className="py-8 text-center text-gray-500 lg:text-lg">Loading tee times...</p>
    );
  }

  if (teeTimes.length === 0) {
    return (
      <div className="py-8 text-center text-gray-500">
        <p className="text-lg font-medium lg:text-xl">No tee times found</p>
        <p className="mt-1 text-sm lg:text-base">
          Try a different date, widen the time window, or add more courses to
          your favorites.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {teeTimes.map((tt, i) => (
        <div
          key={`${tt.course_id}-${tt.time}-${i}`}
          className="flex items-center rounded-lg py-3 -mx-3 px-3 transition-colors hover:bg-stone-50 lg:py-4"
        >
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tabular-nums lg:text-xl">
                {formatTime(tt.time)}
              </span>
              <Link
                href={`/courses/${tt.course_id}`}
                className="text-sm text-gray-600 hover:text-green-700 hover:underline lg:text-base"
              >
                {tt.course_name}
              </Link>
              <span className="text-xs text-gray-400 lg:text-sm">{tt.course_city}</span>
            </div>
            <div className="mt-0.5 flex gap-3 text-xs text-gray-500 lg:text-sm lg:gap-4">
              <span>{tt.holes} holes</span>
              <span>
                {tt.open_slots} {tt.open_slots === 1 ? "spot" : "spots"}
              </span>
              {tt.price !== null && <span>${tt.price.toFixed(2)}</span>}
              {isStale(tt.fetched_at) && (
                <span className="text-amber-600/70">* stale ({staleAge(tt.fetched_at)})</span>
              )}
            </div>
          </div>
          <a
            href={tt.booking_url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-4 rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 lg:px-4 lg:py-2 lg:text-base"
          >
            Book
          </a>
        </div>
      ))}
    </div>
  );
}

export const STALE_THRESHOLD_MS = 75 * 60 * 1000;

export function isStale(fetchedAt: string): boolean {
  return Date.now() - new Date(fetchedAt).getTime() > STALE_THRESHOLD_MS;
}

