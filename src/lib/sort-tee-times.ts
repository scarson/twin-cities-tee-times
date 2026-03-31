// ABOUTME: Pure sort functions for proximity-filtered tee time results.
// ABOUTME: Supports time-first (default) and distance-first sort modes.

export type SortOrder = "time" | "distance";

export interface SortableTeeTime {
  date: string;
  time: string;
  distance?: number;
}

/**
 * Sort tee times by the given mode. Returns a new array (does not mutate input).
 *
 * - "time": primary sort by date+time, ties broken by distance
 * - "distance": primary sort by distance (0.01mi threshold for same-course grouping),
 *   ties broken by date+time
 */
export function sortTeeTimes<T extends SortableTeeTime>(
  items: T[],
  order: SortOrder
): T[] {
  return [...items].sort((a, b) => {
    if (order === "distance") {
      const distA = a.distance ?? Infinity;
      const distB = b.distance ?? Infinity;
      const distDiff = distA - distB;
      if (Math.abs(distDiff) > 0.01) return distDiff;
      return `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`);
    }

    // time mode: sort by date+time, break ties by distance
    const timeDiff = `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`);
    if (timeDiff !== 0) return timeDiff;
    return (a.distance ?? Infinity) - (b.distance ?? Infinity);
  });
}