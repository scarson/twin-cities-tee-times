// ABOUTME: Course browser page listing all courses grouped by area.
// ABOUTME: Supports favoriting and collapsible area sections.
"use client";

import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useFavorites } from "@/hooks/use-favorites";
import { groupByArea, mapsUrl } from "@/config/areas";
import { LocationFilter } from "@/components/location-filter";
import { useLocation } from "@/hooks/use-location";
import { haversineDistance } from "@/lib/distance";
import courseCatalog from "@/config/courses.json";

const COLLAPSED_KEY = "tct-collapsed-areas";

interface CatalogCourse {
  id: string;
  name: string;
  city: string;
  address?: string;
  state?: string;
  bookingUrl: string;
  disabled?: number;
  displayNotes?: string;
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
  const { toggleFavorite, isFavorite } = useFavorites();
  const { location, radiusMiles } = useLocation();
  const [collapsed, setCollapsed] = useState<string[]>(getCollapsedAreas);
  const [search, setSearch] = useState("");

  const toggleArea = useCallback((area: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(area)
        ? prev.filter((a) => a !== area)
        : [...prev, area];
      saveCollapsedAreas(next);
      return next;
    });
  }, []);

  const visibleCourses = (courseCatalog as CatalogCourse[]).filter((c) => {
    if (c.disabled && !c.displayNotes) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q);
  });

  const courseDistances = useMemo(() => {
    if (!location) return null;
    const distances = new Map<string, number>();
    for (const course of courseCatalog as Array<{ id: string; name: string; latitude?: number; longitude?: number }>) {
      if (course.latitude != null && course.longitude != null) {
        distances.set(
          course.name,
          haversineDistance(location.lat, location.lng, course.latitude, course.longitude)
        );
      }
    }
    return distances;
  }, [location]);

  const filteredCourses = useMemo(() => {
    if (!location || !courseDistances) return visibleCourses;
    return visibleCourses.filter((course) => {
      const dist = courseDistances.get(course.name);
      return dist != null && dist <= radiusMiles;
    });
  }, [visibleCourses, location, courseDistances, radiusMiles]);

  const groups = groupByArea(filteredCourses, courseDistances ?? undefined);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 lg:max-w-3xl lg:py-8">
      <h1 className="text-2xl font-bold lg:text-3xl">Golf Courses</h1>
      <p className="mt-1 text-sm text-gray-500 lg:text-base">
        Browse courses and add them to your favorites.
      </p>

      <input
        type="text"
        placeholder="Search courses..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mt-4 w-full rounded-lg border border-gray-200 px-4 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 lg:text-base"
      />
      <LocationFilter />

      <div className="mt-6 space-y-6">
        {groups.map(({ area, courses }) => {
          const isCollapsed = collapsed.includes(area);
          return (
            <section key={area}>
              <button
                onClick={() => toggleArea(area)}
                className="flex w-full items-center gap-2 text-left"
              >
                <h2 className="text-xl font-bold lg:text-2xl">
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
                <ul className="mt-2 divide-y divide-gray-100 pl-4">
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
                          </Link>
                          {course.address && (
                            <a
                              href={mapsUrl(course.name, course.city, course.state ?? "MN")}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block truncate text-xs text-gray-400 hover:text-green-700 lg:text-sm"
                            >
                              {course.address}
                            </a>
                          )}
                          {courseDistances && (
                            <span className="text-xs text-green-700 lg:text-sm">
                              {courseDistances.get(course.name)?.toFixed(1)} mi
                            </span>
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
  return <CourseBrowser />;
}
