// ABOUTME: Home page showing tee times across all courses with date and time filtering.
// ABOUTME: Supports favorites toggle to filter to user's preferred courses.
"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { DatePicker } from "@/components/date-picker";
import { TimeFilter } from "@/components/time-filter";
import { TeeTimeList } from "@/components/tee-time-list";
import { ShareDialog } from "@/components/share-dialog";
import { useFavorites } from "@/hooks/use-favorites";
import { useAuth } from "@/components/auth-provider";
import { todayCT } from "@/lib/format";
import { decodeFavorites, buildShareUrl, resolveSharedCourses } from "@/lib/share";
import courseCatalog from "@/config/courses.json";

export default function Home() {
  const { favorites, favoriteDetails, mergeFavorites, favoritesReady } = useFavorites();
  const { showToast } = useAuth();
  const [dates, setDates] = useState<string[]>(() => [todayCT()]);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [teeTimes, setTeeTimes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  // Auto-enable favorites filter once favorites load from localStorage (one-shot)
  const favoritesInitialized = useRef(false);
  useEffect(() => {
    if (!favoritesInitialized.current && favorites.length > 0) {
      setFavoritesOnly(true);
      favoritesInitialized.current = true;
    }
  }, [favorites]);

  // Share link handling
  const [sharedCourses, setSharedCourses] = useState<{ id: string; name: string }[]>([]);
  const shareProcessed = useRef(false);

  const stripShareParam = () => {
    const params = new URLSearchParams(window.location.search);
    params.delete("f");
    history.replaceState({}, "", window.location.pathname + (params.toString() ? "?" + params : ""));
  };

  useEffect(() => {
    if (shareProcessed.current || !favoritesReady) return;

    const params = new URLSearchParams(window.location.search);
    const fParam = params.get("f");
    if (!fParam) return;

    shareProcessed.current = true;

    const indices = decodeFavorites(fParam);
    if (indices.length === 0) {
      stripShareParam();
      return;
    }

    const catalog = courseCatalog.map((c) => ({
      index: c.index,
      id: c.id,
      name: c.name,
    }));
    const resolved = resolveSharedCourses(indices, catalog);
    const newCourses = resolved.filter((c) => !favorites.includes(c.id));

    if (newCourses.length === 0) {
      showToast("You already have all these courses");
      stripShareParam();
      return;
    }

    setSharedCourses(newCourses);
  }, [favoritesReady, favorites, showToast]);

  useEffect(() => {
    const fetchTeeTimes = async () => {
      setLoading(true);

      try {
        const fetches = dates.map((date) => {
          const params = new URLSearchParams({ date });
          if (favoritesOnly) {
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
  }, [dates, startTime, endTime, favoritesOnly, favorites]);

  const hasFavorites = favorites.length > 0;
  const [showFavList, setShowFavList] = useState(false);
  const favListRef = useRef<HTMLDivElement>(null);

  const handleShare = async () => {
    const indices = favorites
      .map((id) => {
        const course = courseCatalog.find((c) => c.id === id);
        return course?.index ?? -1;
      })
      .filter((i) => i >= 0);

    const url = buildShareUrl(window.location.origin + window.location.pathname, indices);
    try {
      await navigator.clipboard.writeText(url);
      showToast("Share link copied!");
    } catch {
      showToast("Couldn\u2019t copy link");
    }
    setShowFavList(false);
  };

  const handleAcceptShare = async () => {
    await mergeFavorites(sharedCourses);
    showToast(`Added ${sharedCourses.length} ${sharedCourses.length === 1 ? "course" : "courses"} to favorites`);
    setSharedCourses([]);
    stripShareParam();
  };

  const handleCancelShare = () => {
    setSharedCourses([]);
    stripShareParam();
  };

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
              <button
                onClick={handleShare}
                className="block w-full px-4 py-1.5 text-left text-sm font-medium text-green-700 hover:bg-stone-50"
              >
                Share favorites
              </button>
              <div className="mx-2 my-1 border-t border-gray-100" />
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

      {sharedCourses.length > 0 && (
        <ShareDialog
          courses={sharedCourses}
          onAccept={handleAcceptShare}
          onCancel={handleCancelShare}
        />
      )}
    </main>
  );
}
