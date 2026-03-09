"use client";

import { toggleFavorite, isFavorite } from "@/lib/favorites";
import { useState } from "react";

interface CourseHeaderProps {
  course: {
    id: string;
    name: string;
    city: string;
    booking_url: string;
    last_polled: string | null;
  };
}

export function CourseHeader({ course }: CourseHeaderProps) {
  const [favorited, setFavorited] = useState(() => isFavorite(course.id));

  const handleToggle = () => {
    toggleFavorite(course.id);
    setFavorited(!favorited);
  };

  return (
    <div className="flex items-start justify-between">
      <div>
        <h1 className="text-2xl font-bold">{course.name}</h1>
        <p className="text-sm text-gray-500">{course.city}</p>
        {course.last_polled && (
          <p className="mt-1 text-xs text-gray-400">
            Last updated {timeAgo(course.last_polled)}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleToggle}
          className={`rounded border px-3 py-1 text-sm ${
            favorited
              ? "border-yellow-400 bg-yellow-50 text-yellow-700"
              : "border-gray-300 text-gray-600 hover:bg-gray-50"
          }`}
        >
          {favorited ? "Favorited" : "Add to Favorites"}
        </button>
        <a
          href={course.booking_url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded bg-green-600 px-3 py-1 text-sm font-medium text-white hover:bg-green-700"
        >
          Book online
        </a>
      </div>
    </div>
  );
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
