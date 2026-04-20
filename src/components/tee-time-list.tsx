// ABOUTME: Tee time list component rendering available times with price, slots, and staleness.
// ABOUTME: Groups times by date with collapsible headers and links to course detail pages.
"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { formatTime, staleAge } from "@/lib/format";

export interface TeeTimeItem {
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
  nines?: string | null;
  distance?: number;
}

interface TeeTimeListProps {
  teeTimes: TeeTimeItem[];
  loading: boolean;
  selectedDateCount?: number;
}

function formatDateHeader(dateStr: string): string {
  // dateStr is YYYY-MM-DD. Parse as local date to avoid timezone shift.
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function TeeTimeList({ teeTimes, loading, selectedDateCount }: TeeTimeListProps) {
  const { isLoggedIn } = useAuth();
  const [collapsed, setCollapsed] = useState<string[]>([]);

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

  // Group tee times by date, preserving input order
  const dateGroups: { date: string; items: TeeTimeItem[] }[] = [];
  for (const tt of teeTimes) {
    const last = dateGroups[dateGroups.length - 1];
    if (last && last.date === tt.date) {
      last.items.push(tt);
    } else {
      dateGroups.push({ date: tt.date, items: [tt] });
    }
  }

  const hasMultipleDates = dateGroups.length > 1 || (selectedDateCount != null && selectedDateCount > 1);

  const toggleDate = (date: string) => {
    setCollapsed((prev) =>
      prev.includes(date)
        ? prev.filter((d) => d !== date)
        : [...prev, date]
    );
  };

  const courseCount = new Set(teeTimes.map((tt) => tt.course_id)).size;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400 lg:text-sm">
        {teeTimes.length} tee {teeTimes.length === 1 ? "time" : "times"} at {courseCount} {courseCount === 1 ? "course" : "courses"}
      </p>
      {dateGroups.map(({ date, items }) => {
        const isCollapsed = collapsed.includes(date);

        return (
          <div key={date}>
            {hasMultipleDates && (
              <button
                onClick={() => toggleDate(date)}
                className="flex w-full items-center gap-2 text-left mb-1"
              >
                <h3 className="text-base font-semibold text-gray-700 lg:text-lg">
                  {formatDateHeader(date)}
                </h3>
                <span className="text-xs text-gray-400">
                  ({items.length})
                </span>
                <span
                  className={`text-sm text-gray-900 transition-transform ${
                    isCollapsed ? "" : "rotate-90"
                  }`}
                >
                  ›
                </span>
              </button>
            )}
            {(!hasMultipleDates || !isCollapsed) && (
              <div className="divide-y divide-gray-100">
                {items.map((tt, i) => (
                  <div
                    key={`${tt.course_id}-${tt.date}-${tt.time}-${i}`}
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
                        {tt.distance != null && (
                          <span className="text-xs text-green-700 lg:text-sm">
                            {tt.distance.toFixed(1)} mi
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex gap-3 text-xs text-gray-500 lg:text-sm lg:gap-4">
                        <span>{tt.holes} holes{tt.nines ? ` (${tt.nines})` : ""}</span>
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
                      onClick={() => {
                        if (isLoggedIn) {
                          navigator.sendBeacon(
                            "/api/user/booking-clicks",
                            new Blob(
                              [JSON.stringify({ courseId: tt.course_id, date: tt.date, time: tt.time })],
                              { type: "application/json" }
                            )
                          );
                        }
                      }}
                      className="ml-4 rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 lg:px-4 lg:py-2 lg:text-base"
                    >
                      Book
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const STALE_THRESHOLD_MS = 75 * 60 * 1000;

export function isStale(fetchedAt: string): boolean {
  return Date.now() - new Date(fetchedAt).getTime() > STALE_THRESHOLD_MS;
}
