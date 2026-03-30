// ABOUTME: Course detail page header with name, city, favorite toggle, booking link,
// ABOUTME: and inline refresh trigger next to the "last updated" timestamp.
"use client";

import { formatAge } from "@/lib/format";
import { useFavorites } from "@/hooks/use-favorites";
import { useEffect, useRef, useState } from "react";

interface CourseHeaderProps {
  course: {
    id: string;
    name: string;
    city: string;
    booking_url: string;
    last_polled: string | null;
  };
  address?: string;
  mapsUrl?: string;
  dates: string[];
  teeTimes: { fetched_at: string }[];
  onRefreshed: () => void;
}

export function CourseHeader({ course, address, mapsUrl: mapsHref, dates, teeTimes, onRefreshed }: CourseHeaderProps) {
  const { toggleFavorite, isFavorite } = useFavorites();
  const [refreshing, setRefreshing] = useState(false);
  const [coolingDown, setCoolingDown] = useState(false);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    };
  }, []);

  const favorited = isFavorite(course.id);

  const handleToggle = () => {
    toggleFavorite(course.id, course.name);
  };

  const refreshDisabled = refreshing || coolingDown;

  const handleRefresh = async () => {
    if (refreshDisabled) return;
    setRefreshing(true);
    try {
      const responses = await Promise.all(
        dates.map((date) =>
          fetch(`/api/courses/${course.id}/refresh?date=${date}`, {
            method: "POST",
          })
        )
      );
      // 429 = rate-limited (data is fresh), not a real failure
      const failed = responses.filter((r) => !r.ok && r.status !== 429);
      if (failed.length > 0) {
        console.error(`Refresh failed for ${failed.length}/${responses.length} dates`);
      }
      onRefreshed();
      setCoolingDown(true);
      cooldownTimer.current = setTimeout(() => setCoolingDown(false), 30_000);
    } finally {
      setRefreshing(false);
    }
  };

  // Derive "Last updated" from the oldest fetched_at in the displayed tee times,
  // falling back to the last successful poll timestamp from the DB.
  const oldestFetchedAt = teeTimes.length > 0
    ? teeTimes.reduce((oldest, tt) =>
        tt.fetched_at < oldest ? tt.fetched_at : oldest,
      teeTimes[0].fetched_at)
    : null;
  const displayTimestamp = oldestFetchedAt ?? course.last_polled;

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold lg:text-3xl">{course.name}</h1>
        <p className="text-sm text-gray-500 lg:text-base">{course.city}</p>
        {address && mapsHref && (
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-green-700 lg:text-sm"
          >
            {address}
          </a>
        )}
        <p className="mt-1 text-xs text-gray-400 lg:text-sm">
          {displayTimestamp ? (
            <>
              Last updated {formatAge(displayTimestamp)}
              {" · "}
              {refreshing ? (
                <span className="text-gray-400">Refreshing…</span>
              ) : coolingDown ? null : (
                <button
                  onClick={handleRefresh}
                  className="text-green-700 hover:underline"
                >
                  Refresh
                </button>
              )}
            </>
          ) : refreshing ? (
            <span className="text-gray-400">Refreshing…</span>
          ) : (
            <button
              onClick={handleRefresh}
              disabled={refreshDisabled}
              className="text-green-700 hover:underline disabled:opacity-50"
            >
              Refresh now
            </button>
          )}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          onClick={handleToggle}
          className={`inline-flex items-center rounded border px-3 py-1 text-sm lg:px-4 lg:py-1.5 lg:text-base ${
            favorited
              ? "border-yellow-400 bg-yellow-50 text-yellow-700"
              : "border-gray-300 text-gray-600 hover:bg-gray-50"
          }`}
        >
          {favorited ? "★ Favorite" : "☆ Favorite"}
        </button>
        <a
          href={course.booking_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center rounded bg-green-600 px-3 py-1 text-center text-sm font-medium text-white hover:bg-green-700 lg:px-4 lg:py-1.5 lg:text-base"
        >
          Book online
        </a>
      </div>
    </div>
  );
}
