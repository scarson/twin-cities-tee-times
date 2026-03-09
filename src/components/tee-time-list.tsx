"use client";

import Link from "next/link";

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
      <p className="py-8 text-center text-gray-500">Loading tee times...</p>
    );
  }

  if (teeTimes.length === 0) {
    return (
      <div className="py-8 text-center text-gray-500">
        <p className="text-lg font-medium">No tee times found</p>
        <p className="mt-1 text-sm">
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
          className="flex items-center justify-between py-3"
        >
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tabular-nums">
                {formatTime(tt.time)}
              </span>
              <Link
                href={`/courses/${tt.course_id}`}
                className="text-sm text-gray-600 hover:text-green-700 hover:underline"
              >
                {tt.course_name}
              </Link>
              <span className="text-xs text-gray-400">{tt.course_city}</span>
            </div>
            <div className="mt-0.5 flex gap-3 text-xs text-gray-500">
              <span>{tt.holes} holes</span>
              <span>
                {tt.open_slots} {tt.open_slots === 1 ? "spot" : "spots"}
              </span>
              {tt.price !== null && <span>${tt.price.toFixed(2)}</span>}
            </div>
          </div>
          <a
            href={tt.booking_url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-4 rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
          >
            Book
          </a>
        </div>
      ))}
    </div>
  );
}

function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${hour12}:${m} ${ampm}`;
}
