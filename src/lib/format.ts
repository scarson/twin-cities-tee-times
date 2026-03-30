// ABOUTME: Shared time and date formatting utilities.
// ABOUTME: Used by tee-time-list, course-header, and other components.

export function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${hour12}:${m} ${ampm}`;
}

export function formatAge(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function staleAge(fetchedAt: string): string {
  const hours = Math.floor(
    (Date.now() - new Date(fetchedAt).getTime()) / 3_600_000
  );
  if (hours < 24) return `${hours}h old`;
  const days = Math.floor(hours / 24);
  return `${days}d old`;
}

/** Today's date as YYYY-MM-DD in Central Time (America/Chicago).
 * All golf courses in the app are in the Twin Cities metro, so Central Time
 * is the canonical timezone for date logic. San Diego test courses also
 * display in CT — this is intentional. */
export function todayCT(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

/** Current time as HH:MM in Central Time. */
export function nowTimeCT(): string {
  return new Date().toLocaleTimeString("en-GB", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
