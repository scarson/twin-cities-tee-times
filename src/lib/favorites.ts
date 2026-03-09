const STORAGE_KEY = "tct-favorites";

export function getFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function setFavorites(courseIds: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(courseIds));
}

export function toggleFavorite(courseId: string): string[] {
  const current = getFavorites();
  const next = current.includes(courseId)
    ? current.filter((id) => id !== courseId)
    : [...current, courseId];
  setFavorites(next);
  return next;
}

export function isFavorite(courseId: string): boolean {
  return getFavorites().includes(courseId);
}
