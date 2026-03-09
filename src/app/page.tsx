"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { DatePicker } from "@/components/date-picker";
import { TimeFilter } from "@/components/time-filter";
import { TeeTimeList } from "@/components/tee-time-list";
import { getFavorites, getFavoriteDetails } from "@/lib/favorites";
import { todayCT } from "@/lib/format";

export default function Home() {
  const [dates, setDates] = useState<string[]>(() => [todayCT()]);
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
      } catch (err) {
        console.error("Failed to fetch tee times:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchTeeTimes();
  }, [dates, startTime, endTime, favoritesOnly]);

  const favorites = getFavorites();
  const favoriteDetails = getFavoriteDetails();
  const hasFavorites = favorites.length > 0;
  const [showFavList, setShowFavList] = useState(false);
  const favListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showFavList) return;
    function handleClickOutside(e: MouseEvent) {
      if (favListRef.current && !favListRef.current.contains(e.target as Node)) {
        setShowFavList(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showFavList]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 lg:max-w-3xl lg:py-8">
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
      </div>

      {hasFavorites && (
        <div className="relative mt-2 text-sm text-gray-600 lg:text-base" ref={favListRef}>
          Showing:{" "}
          <button
            onClick={() => {
              if (favoritesOnly) {
                setShowFavList(!showFavList);
              } else {
                setFavoritesOnly(true);
                setShowFavList(false);
              }
            }}
            className={`font-medium ${
              favoritesOnly
                ? "text-green-700 underline underline-offset-2"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            Favorites ({favorites.length})
          </button>
          <span className="mx-1.5 text-gray-300">|</span>
          <button
            onClick={() => {
              setFavoritesOnly(false);
              setShowFavList(false);
            }}
            className={`font-medium ${
              !favoritesOnly
                ? "text-green-700 underline underline-offset-2"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            All courses
          </button>

          {showFavList && (
            <div className="absolute left-0 top-full z-10 mt-1 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              {favoriteDetails.map((fav) => (
                <Link
                  key={fav.id}
                  href={`/courses/${fav.id}`}
                  className="block px-4 py-1.5 text-sm text-gray-700 hover:bg-stone-50 hover:text-green-700"
                >
                  {fav.name}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4">
        <TeeTimeList teeTimes={teeTimes} loading={loading} />
      </div>
    </main>
  );
}
