// ABOUTME: Bitfield encoding/decoding for sharing favorite courses via URL.
// ABOUTME: Encodes course indices as a compact base64url string with v1. version prefix.

const VERSION_PREFIX = "v1.";

/**
 * Encode an array of course indices into a versioned base64url string.
 * Each index sets a bit in a byte array: index N sets bit (7 - N%8) of byte floor(N/8).
 */
export function encodeFavorites(indices: number[]): string {
  if (indices.length === 0) return VERSION_PREFIX;

  const maxIndex = Math.max(...indices);
  const byteCount = Math.floor(maxIndex / 8) + 1;
  const bytes = new Uint8Array(byteCount);

  for (const idx of indices) {
    const bytePos = Math.floor(idx / 8);
    const bitPos = 7 - (idx % 8);
    bytes[bytePos] |= 1 << bitPos;
  }

  // Base64url encode (no padding)
  const base64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return VERSION_PREFIX + base64;
}

/**
 * Decode a versioned base64url string back to an array of course indices.
 * Returns empty array on any invalid input.
 */
export function decodeFavorites(encoded: string): number[] {
  if (!encoded || typeof encoded !== "string") return [];
  if (!encoded.startsWith(VERSION_PREFIX)) return [];

  const base64Part = encoded.slice(VERSION_PREFIX.length);
  if (!base64Part) return [];

  try {
    // Restore standard base64
    const padded =
      base64Part.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (base64Part.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));

    const indices: number[] = [];
    for (let bytePos = 0; bytePos < bytes.length; bytePos++) {
      for (let bitPos = 7; bitPos >= 0; bitPos--) {
        if (bytes[bytePos] & (1 << bitPos)) {
          indices.push(bytePos * 8 + (7 - bitPos));
        }
      }
    }
    return indices;
  } catch {
    return [];
  }
}

interface CatalogEntry {
  index: number;
  id: string;
  name: string;
}

/**
 * Build a share URL with the encoded favorites as a query parameter.
 */
export function buildShareUrl(baseUrl: string, indices: number[]): string {
  const url = new URL(baseUrl);
  url.searchParams.set("f", encodeFavorites(indices));
  return url.toString();
}

/**
 * Resolve bitfield indices to course {id, name} pairs using the catalog.
 * Skips indices that don't match any catalog entry.
 */
export function resolveSharedCourses(
  indices: number[],
  catalog: CatalogEntry[]
): { id: string; name: string }[] {
  const indexMap = new Map(catalog.map((c) => [c.index, { id: c.id, name: c.name }]));
  return indices
    .map((idx) => indexMap.get(idx))
    .filter((entry): entry is { id: string; name: string } => entry !== undefined);
}
