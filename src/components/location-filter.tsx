"use client";
// ABOUTME: Collapsible location filter for proximity-based course filtering.
// ABOUTME: Provides GPS and zip code input with radius selection.

import { useState } from "react";
import { useLocation, RADIUS_OPTIONS, SORT_OPTIONS } from "@/hooks/use-location";
import type { SortOrder } from "@/hooks/use-location";

export function LocationFilter() {
  const {
    location,
    zip,
    radiusMiles,
    sortOrder,
    gpsLoading,
    gpsError,
    setZip,
    requestGps,
    setRadiusMiles,
    setSortOrder,
    clearLocation,
  } = useLocation();

  const [expanded, setExpanded] = useState(false);
  const [zipInput, setZipInput] = useState(zip);

  const hasLocation = location !== null;

  const handleZipSubmit = () => {
    const trimmed = zipInput.trim();
    // Only trigger lookup if zip changed (avoids redundant fetches on blur)
    if (trimmed.length === 5 && trimmed !== zip) {
      setZip(trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleZipSubmit();
    }
  };

  const radiusLabel = radiusMiles === 0 ? "any distance" : `${radiusMiles} mi`;
  const toggleLabel = hasLocation
    ? `📍 Within ${radiusLabel} of ${location.label}`
    : "📍 Filter by location";

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-1.5 text-sm lg:text-base ${
          hasLocation
            ? "text-green-700"
            : "text-gray-400 hover:text-gray-600"
        }`}
      >
        <span>{toggleLabel}</span>
        <span
          className={`text-sm text-gray-900 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        >
          ›
        </span>
      </button>

      {expanded && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={requestGps}
              disabled={gpsLoading}
              className="rounded bg-stone-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-stone-200 disabled:opacity-50 lg:text-sm"
            >
              {gpsLoading ? "Locating…" : "Use my location"}
            </button>

            <input
              type="text"
              inputMode="numeric"
              maxLength={5}
              placeholder="Zip code"
              value={zipInput}
              onChange={(e) => setZipInput(e.target.value.replace(/\D/g, ""))}
              onKeyDown={handleKeyDown}
              onBlur={handleZipSubmit}
              className="w-20 rounded border border-gray-200 px-2 py-1.5 text-xs focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 lg:text-sm"
            />

            <select
              value={radiusMiles}
              onChange={(e) => setRadiusMiles(Number(e.target.value))}
              className="rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-700 lg:text-sm"
            >
              {RADIUS_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r === 0 ? "Any" : `${r} mi`}
                </option>
              ))}
            </select>

            {hasLocation && (
              <button
                onClick={() => {
                  clearLocation();
                  setZipInput("");
                }}
                className="text-xs text-gray-400 hover:text-red-500"
              >
                Clear
              </button>
            )}
          </div>

          {hasLocation && (
            <div className="mt-1.5 text-xs text-gray-500 lg:text-sm">
              Sort by:{" "}
              {SORT_OPTIONS.map((option, i) => (
                <span key={option}>
                  {i > 0 && <span className="mx-1 text-gray-300">|</span>}
                  <button
                    onClick={() => setSortOrder(option as SortOrder)}
                    className={
                      sortOrder === option
                        ? "font-medium text-green-700 underline underline-offset-2"
                        : "text-gray-400 hover:text-gray-600"
                    }
                  >
                    {option === "time" ? "Time" : "Distance"}
                  </button>
                </span>
              ))}
            </div>
          )}

          {gpsError && (
            <p className="mt-1 text-xs text-red-500">{gpsError}</p>
          )}
        </>
      )}
    </div>
  );
}
