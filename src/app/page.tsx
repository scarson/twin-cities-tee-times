"use client";

import { useState, useEffect } from "react";
import { DatePicker } from "@/components/date-picker";
import { TimeFilter } from "@/components/time-filter";
import { TeeTimeList } from "@/components/tee-time-list";
import { getFavorites } from "@/lib/favorites";

export default function Home() {
  const [dates, setDates] = useState<string[]>(() => [
    new Date().toISOString().split("T")[0],
  ]);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [teeTimes, setTeeTimes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [favoritesOnly, setFavoritesOnly] = useState(() => {
    return getFavorites().length > 0;
  });

  useEffect(() => {
    const fetchTeeTimes = async () => {
      setLoading(true);

      try {
        const fetches = dates.map((date) => {
          const params = new URLSearchParams({ date });
          if (favoritesOnly) {
            const favorites = getFavorites();
            if (favorites.length > 0) {
              params.set("courses", favorites.join(","));
            }
          }
          if (startTime) params.set("startTime", startTime);
          if (endTime) params.set("endTime", endTime);
          return fetch(`/api/tee-times?${params}`).then((r) => r.json()) as Promise<{ teeTimes?: never[] }>;
        });

        const results = await Promise.all(fetches);
        const merged = results.flatMap((r) => r.teeTimes ?? []);
        merged.sort((a: { date: string; time: string }, b: { date: string; time: string }) =>
          `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)
        );
        setTeeTimes(merged);
      } catch {
        setTeeTimes([]);
      } finally {
        setLoading(false);
      }
    };

    fetchTeeTimes();
  }, [dates, startTime, endTime, favoritesOnly]);

  const hasFavorites = getFavorites().length > 0;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <div className="flex flex-wrap items-center gap-4">
        <DatePicker selected={dates} onChange={setDates} />
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <TimeFilter
          startTime={startTime}
          endTime={endTime}
          onChange={({ startTime: s, endTime: e }) => {
            setStartTime(s);
            setEndTime(e);
          }}
        />
        {hasFavorites && (
          <button
            onClick={() => setFavoritesOnly(!favoritesOnly)}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              favoritesOnly
                ? "bg-yellow-100 text-yellow-800 border border-yellow-300"
                : "bg-stone-100 text-gray-700 hover:bg-stone-200"
            }`}
          >
            {favoritesOnly ? "Favorites" : "All courses"}
          </button>
        )}
      </div>

      <div className="mt-4">
        <TeeTimeList teeTimes={teeTimes} loading={loading} />
      </div>
    </main>
  );
}
