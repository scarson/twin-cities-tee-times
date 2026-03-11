// ABOUTME: Course browser page listing all courses grouped by area.
// ABOUTME: Supports favoriting, collapsible area sections, and ?test=true for SD courses.
"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useFavorites } from "@/hooks/use-favorites";
import { groupByArea, mapsUrl } from "@/config/areas";
import courseCatalog from "@/config/courses.json";

const COLLAPSED_KEY = "tct-collapsed-areas";

interface CatalogCourse {
  id: string;
  name: string;
  city: string;
  address?: string;
  bookingUrl: string;
  is_active?: number;
}

function getCollapsedAreas(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCollapsedAreas(areas: string[]) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(areas));
  } catch {
    // localStorage unavailable
  }
}

function CourseBrowser() {
  const searchParams = useSearchParams();
  const showTest = searchParams.get("test") === "true";
  const { toggleFavorite, isFavorite } = useFavorites();
  const [collapsed, setCollapsed] = useState<string[]>([]);

  // Load collapsed state from localStorage after mount
  useEffect(() => {
    setCollapsed(getCollapsedAreas());
  }, []);

  const toggleArea = useCallback((area: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(area)
        ? prev.filter((a) => a !== area)
        : [...prev, area];
      saveCollapsedAreas(next);
      return next;
    });
  }, []);

  // Filter out SD test courses unless ?test=true
  const visibleCourses = (courseCatalog as CatalogCourse[]).filter(
    (c) => showTest || !c.id.startsWith("sd-")
  );

  const groups = groupByArea(visibleCourses);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 lg:max-w-3xl lg:py-8">
      <h1 className="text-2xl font-bold lg:text-3xl">Golf Courses</h1>
      <p className="mt-1 text-sm text-gray-500 lg:text-base">
        Browse courses and add them to your favorites.
      </p>

      <div className="mt-6 space-y-6">
        {groups.map(({ area, courses }) => {
          const isCollapsed = collapsed.includes(area);
          return (
            <section key={area}>
              <button
                onClick={() => toggleArea(area)}
                className="flex items-center gap-2 text-left"
              >
                <h2 className="text-lg font-semibold lg:text-xl">
                  {area}
                </h2>
                <span className="text-sm text-gray-400">
                  ({courses.length})
                </span>
                <span
                  className={`text-sm text-gray-900 transition-transform ${
                    isCollapsed ? "" : "rotate-90"
                  }`}
                >
                  ›
                </span>
              </button>

              {!isCollapsed && (
                <ul className="mt-2 divide-y divide-gray-100">
                  {courses.map((course) => {
                    const favorited = isFavorite(course.id);
                    return (
                      <li
                        key={course.id}
                        className="flex items-center justify-between gap-3 py-3"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/courses/${course.id}`}
                            className="font-medium text-gray-900 hover:text-green-700 lg:text-lg"
                          >
                            {course.name}
                            {course.is_active === 0 && (
                              <span className="ml-1.5 text-xs font-normal text-gray-400">
                                (inactive)
                              </span>
                            )}
                          </Link>
                          {course.address && (
                            <a
                              href={mapsUrl(course.address)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block truncate text-xs text-gray-400 hover:text-green-700 lg:text-sm"
                            >
                              {course.address}
                            </a>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <a
                            href={course.bookingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-green-700 hover:underline"
                            title="Book online"
                          >
                            Book
                          </a>
                          <button
                            onClick={() =>
                              toggleFavorite(course.id, course.name)
                            }
                            className={`text-xl leading-none ${
                              favorited
                                ? "text-yellow-500"
                                : "text-gray-300 hover:text-yellow-400"
                            }`}
                            title={
                              favorited
                                ? "Remove from favorites"
                                : "Add to favorites"
                            }
                          >
                            {favorited ? "★" : "☆"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}

export default function CoursesPage() {
  return (
    <Suspense>
      <CourseBrowser />
    </Suspense>
  );
}
