// ABOUTME: Client-side favorites management using localStorage.
// ABOUTME: Stores favorite course IDs with SSR-safe window guard.

const STORAGE_KEY = "tct-favorites";

export interface FavoriteEntry {
  id: string;
  name: string;
}

function readRaw(): FavoriteEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    // Migrate legacy string[] format
    return parsed.map((item: string | FavoriteEntry) =>
      typeof item === "string" ? { id: item, name: item } : item
    );
  } catch {
    return [];
  }
}

function writeRaw(entries: FavoriteEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function getFavorites(): string[] {
  return readRaw().map((e) => e.id);
}

export function getFavoriteDetails(): FavoriteEntry[] {
  return readRaw();
}

export function setFavorites(entries: FavoriteEntry[]): void {
  writeRaw(entries);
}

export function toggleFavorite(courseId: string, courseName?: string): string[] {
  const current = readRaw();
  const exists = current.some((e) => e.id === courseId);
  const next = exists
    ? current.filter((e) => e.id !== courseId)
    : [...current, { id: courseId, name: courseName ?? courseId }];
  writeRaw(next);
  return next.map((e) => e.id);
}

export function isFavorite(courseId: string): boolean {
  return getFavorites().includes(courseId);
}
