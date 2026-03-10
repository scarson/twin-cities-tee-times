# Share Favorites via Link — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users share their favorite courses via a compact URL that recipients can accept to union-merge into their own favorites.

**Architecture:** Each course has a permanent numeric index. Favorites are encoded as a bitfield (one bit per index), base64url-encoded with a `v1/` version prefix, and passed as a `?f=` query parameter. The home page detects this param, shows a confirmation dialog listing the shared courses, and merges on accept. Works for both anonymous (localStorage) and logged-in (server API) users.

**Tech Stack:** TypeScript, React, Vitest, Tailwind CSS, existing `/api/user/favorites/merge` endpoint

---

## Subagent Execution Notes

**Batch 1:** Task 1 (course indices) — foundation, must complete first
**Batch 2:** Task 2 (share.ts encode/decode) — depends on Task 1's index data
**Batch 3:** Task 3 (mergeFavorites in hook) — independent of Task 2
**Batch 4:** Task 4 (share button) and Task 5 (dialog component) in parallel — both create/modify independent files
**Batch 5:** Task 6 (integration in page.tsx) — depends on Tasks 3, 4, and 5
**Batch 6:** Task 7 (final verification)

### Critical context for all subagents

- **courses.json is a JSON import, NOT a D1 table.** The `index` field added in Task 1 is only in `src/config/courses.json` (the client-side catalog). Do NOT add `index` to the `CourseConfig` interface in `src/types/index.ts` — that type represents D1 rows, not the JSON catalog. The seed script (`scripts/seed.ts`) reads courses.json via `JSON.parse` and ignores extra fields, so adding `index` won't break it.
- **`useState` and `useRef` are already imported in `page.tsx`.** Do not add duplicate imports.
- **`useAuth` is NOT currently imported in `page.tsx`.** Task 4 adds it; Task 6 must not re-add it.
- **The `showToast` function lives on `useAuth()`, not `useFavorites()`.** Task 4 adds `const { showToast } = useAuth()` to page.tsx; Task 6 uses it but must not re-declare it.

---

## Task 1: Add stable indices to courses.json

Each course needs a permanent `index` field for bitfield encoding. Indices are assigned alphabetically by `id` for the initial batch. New courses added later will get `max + 1`.

**Context for subagent:** The `index` field is ONLY for share-link encoding. It does NOT go into the D1 database or the `CourseConfig` TypeScript interface. The seed script (`scripts/seed.ts`) reads courses.json but maps only specific fields — extra fields like `index` are silently ignored.

**Files:**
- Modify: `src/config/courses.json`

**Step 1: Add index fields**

Add an `"index"` field to each course in `src/config/courses.json`. Assign indices 0–18 in alphabetical order by course `id`. The exact mapping:

| index | id |
|-------|-----|
| 0 | braemar |
| 1 | bunker-hills |
| 2 | chaska-town-course |
| 3 | columbia |
| 4 | como-park |
| 5 | edinburgh-usa |
| 6 | gem-lake-hills |
| 7 | gross-national |
| 8 | hiawatha |
| 9 | highland-national |
| 10 | meadowbrook |
| 11 | oak-glen |
| 12 | phalen |
| 13 | roseville-cedarholm |
| 14 | sd-balboa-park |
| 15 | sd-goat-hill |
| 16 | sd-oceanside |
| 17 | theodore-wirth-18 |
| 18 | victory-links |

For each course, add `"index": N` as the first field in the object (after the opening `{`). Example for the first course in the file (Theodore Wirth, which gets index 17):

```json
{
    "index": 17,
    "id": "theodore-wirth-18",
    "name": "Theodore Wirth",
    ...
}
```

**Step 2: Run tests + type-check**

Run: `npm test`
Expected: All pass (courses.json is runtime data, not consumed by tests)

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/config/courses.json
git commit -m "feat: add stable numeric index to each course for share encoding"
```

---

## Task 2: Create share encoding/decoding module

Pure functions to encode a set of course indices into a `v1/`-prefixed base64url string, and decode it back. Also a helper to build the full share URL and to resolve indices from the course catalog.

**Files:**
- Create: `src/lib/share.ts`
- Create: `src/lib/share.test.ts`

**Step 1: Write the failing tests**

Create `src/lib/share.test.ts` with these contents:

```typescript
// ABOUTME: Tests for share-favorites bitfield encoding and decoding.
// ABOUTME: Covers round-trips, edge cases, invalid input, and course catalog resolution.

import { describe, it, expect } from "vitest";
import { encodeFavorites, decodeFavorites, buildShareUrl, resolveSharedCourses } from "./share";

describe("encodeFavorites", () => {
  it("encodes a single index", () => {
    const result = encodeFavorites([0]);
    expect(result).toMatch(/^v1\//);
    // Bit 0 set = byte 0x80 = base64url "gA"
    expect(result).toBe("v1/gA");
  });

  it("encodes multiple indices", () => {
    const result = encodeFavorites([0, 7]);
    // Bits 0 and 7 set = byte 0x81 = base64url "gQ"
    expect(result).toBe("v1/gQ");
  });

  it("encodes indices spanning multiple bytes", () => {
    const result = encodeFavorites([0, 8]);
    // Bit 0 in byte 0 = 0x80, bit 8 (= bit 0 of byte 1) = 0x80
    // Bytes: [0x80, 0x80] = base64url "gIA"
    expect(result).toBe("v1/gIA");
  });

  it("returns v1/ prefix with empty base64 for empty input", () => {
    expect(encodeFavorites([])).toBe("v1/");
  });

  it("round-trips with decodeFavorites", () => {
    const indices = [0, 3, 7, 12, 18];
    const encoded = encodeFavorites(indices);
    const decoded = decodeFavorites(encoded);
    expect(decoded).toEqual(indices);
  });

  it("handles high indices (future-proofing)", () => {
    const indices = [0, 99, 200];
    const encoded = encodeFavorites(indices);
    const decoded = decodeFavorites(encoded);
    expect(decoded).toEqual(indices);
  });
});

describe("decodeFavorites", () => {
  it("returns empty array for empty v1/ prefix", () => {
    expect(decodeFavorites("v1/")).toEqual([]);
  });

  it("returns empty array for invalid version prefix", () => {
    expect(decodeFavorites("v2/gA")).toEqual([]);
  });

  it("returns empty array for missing version prefix", () => {
    expect(decodeFavorites("gA")).toEqual([]);
  });

  it("returns empty array for corrupted base64", () => {
    expect(decodeFavorites("v1/!!!invalid!!!")).toEqual([]);
  });

  it("returns empty array for null/undefined input", () => {
    expect(decodeFavorites(null as unknown as string)).toEqual([]);
    expect(decodeFavorites(undefined as unknown as string)).toEqual([]);
    expect(decodeFavorites("")).toEqual([]);
  });
});

describe("buildShareUrl", () => {
  it("builds URL with f query param containing v1/ prefix", () => {
    const url = buildShareUrl("https://example.com/", [0, 3]);
    const parsed = new URL(url);
    // Use searchParams.get() which auto-decodes %2F back to /
    const fParam = parsed.searchParams.get("f");
    expect(fParam).toMatch(/^v1\//);
  });

  it("preserves existing path", () => {
    const url = buildShareUrl("https://example.com/some/path", [0]);
    expect(new URL(url).pathname).toBe("/some/path");
  });

  it("round-trips through URL encoding", () => {
    const url = buildShareUrl("https://example.com/", [0, 3, 17]);
    const parsed = new URL(url);
    const decoded = decodeFavorites(parsed.searchParams.get("f")!);
    expect(decoded).toEqual([0, 3, 17]);
  });
});

describe("resolveSharedCourses", () => {
  const catalog = [
    { index: 0, id: "braemar", name: "Braemar" },
    { index: 1, id: "bunker-hills", name: "Bunker Hills" },
    { index: 5, id: "edinburgh-usa", name: "Edinburgh USA" },
  ];

  it("resolves indices to course entries", () => {
    const result = resolveSharedCourses([0, 5], catalog);
    expect(result).toEqual([
      { id: "braemar", name: "Braemar" },
      { id: "edinburgh-usa", name: "Edinburgh USA" },
    ]);
  });

  it("skips unknown indices", () => {
    const result = resolveSharedCourses([0, 99], catalog);
    expect(result).toEqual([{ id: "braemar", name: "Braemar" }]);
  });

  it("returns empty array for no valid indices", () => {
    const result = resolveSharedCourses([50, 99], catalog);
    expect(result).toEqual([]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/share.test.ts`
Expected: FAIL — module `./share` does not exist

**Step 3: Write the implementation**

Create `src/lib/share.ts`:

```typescript
// ABOUTME: Bitfield encoding/decoding for sharing favorite courses via URL.
// ABOUTME: Encodes course indices as a compact base64url string with v1/ version prefix.

const VERSION_PREFIX = "v1/";

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
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/share.test.ts`
Expected: All pass

**Step 5: Run full test suite + type-check**

Run: `npm test`
Expected: All pass

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/lib/share.ts src/lib/share.test.ts
git commit -m "feat: add bitfield encode/decode for sharing favorites via URL"
```

---

## Task 3: Add mergeFavorites and favoritesReady to useFavorites hook

The hook needs a `mergeFavorites` function for bulk-adding courses. Anonymous mode writes to localStorage directly. Logged-in mode calls the existing `/api/user/favorites/merge` endpoint. Also expose a `favoritesReady` flag so consumers know when favorites have finished loading (needed to avoid the race condition on share link processing).

**CRITICAL: `favoritesReady` must account for server fetch.** For logged-in users, the hook loads localStorage first, then fetches server favorites (which overwrite state). `favoritesReady` must NOT become `true` until the server fetch completes — otherwise share link deduplication runs against stale localStorage data. For anonymous users, `favoritesReady` becomes `true` once auth has resolved and we know no server fetch will happen.

**IMPORTANT: Auth state is async.** At mount, `isLoggedIn` is ALWAYS `false` because the auth provider hasn't finished its `/api/auth/me` fetch. You cannot check `isLoggedIn` in the mount effect `useEffect([], [])` — it will always be false. Instead, use a separate effect that watches `isLoading` from `useAuth()`:
- When `isLoading` becomes `false` AND `isLoggedIn` is `false` → anonymous user → set `favoritesReady = true`
- When `isLoading` becomes `false` AND `isLoggedIn` is `true` → wait for server fetch effect to set `favoritesReady = true`

**Context for subagent:** Read `src/hooks/use-favorites.ts` first. Note the existing effects:
1. `useEffect(() => { ... }, [])` — loads localStorage (runs for all users at mount)
2. `useEffect(() => { if (!isLoggedIn) return; ... }, [isLoggedIn, favoritesVersion])` — fetches server favorites (runs only when logged in)

Currently the hook destructures: `const { isLoggedIn, favoritesVersion, showToast } = useAuth();` — you'll need to add `isLoading` to this destructuring.

`favoritesReady` should be set to `true`:
- In a NEW effect watching `[isLoading, isLoggedIn]`, when auth resolves to anonymous
- In effect #2 (server fetch), after the fetch completes (success or failure)

**Files:**
- Modify: `src/hooks/use-favorites.ts`
- Modify: `src/hooks/use-favorites.test.ts`

**Step 1: Write the failing tests**

In `src/hooks/use-favorites.test.ts`, add these tests inside the `describe("anonymous mode")` block. Insert them after the closing `});` of the `"isFavorite returns based on current favorites state"` test (around line 108):

```typescript
    it("mergeFavorites adds new courses to localStorage", async () => {
      mockedGetFavorites.mockReturnValue(["existing"]);
      mockedGetFavoriteDetails
        .mockReturnValueOnce([{ id: "existing", name: "Existing" }])
        .mockReturnValue([
          { id: "existing", name: "Existing" },
          { id: "new-a", name: "New A" },
          { id: "new-b", name: "New B" },
        ]);

      const { result } = renderHook(() => useFavorites());

      await waitFor(() => {
        expect(result.current.favorites).toContain("existing");
      });

      await act(async () => {
        await result.current.mergeFavorites([
          { id: "new-a", name: "New A" },
          { id: "new-b", name: "New B" },
        ]);
      });

      expect(mockedSetFavorites).toHaveBeenCalled();
      expect(result.current.favorites).toContain("new-a");
      expect(result.current.favorites).toContain("new-b");
      expect(result.current.favorites).toContain("existing");
    });

    it("mergeFavorites skips duplicates", async () => {
      mockedGetFavorites.mockReturnValue(["existing"]);
      mockedGetFavoriteDetails.mockReturnValue([
        { id: "existing", name: "Existing" },
      ]);

      const { result } = renderHook(() => useFavorites());

      await waitFor(() => {
        expect(result.current.favorites).toContain("existing");
      });

      await act(async () => {
        await result.current.mergeFavorites([
          { id: "existing", name: "Existing" },
        ]);
      });

      // Should not duplicate
      expect(result.current.favorites.filter((id: string) => id === "existing")).toHaveLength(1);
    });

    it("exposes favoritesReady as true after mount (anonymous)", async () => {
      mockedGetFavorites.mockReturnValue([]);
      mockedGetFavoriteDetails.mockReturnValue([]);

      const { result } = renderHook(() => useFavorites());

      await waitFor(() => {
        expect(result.current.favoritesReady).toBe(true);
      });
    });
```

Add these tests inside the `describe("logged-in mode")` block. Insert them after the closing `});` of the `"toggleFavorite rolls back and shows toast on failure"` test (around line 264):

```typescript
    it("mergeFavorites calls server merge endpoint for logged-in users", async () => {
      mockedGetFavorites.mockReturnValue([]);
      mockedGetFavoriteDetails.mockReturnValue([]);
      // Initial server fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ favorites: [] }),
      });
      // Merge endpoint
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ merged: 2, total: 2 }),
      });

      const { result } = renderHook(() => useFavorites());

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/user/favorites");
      });

      await act(async () => {
        await result.current.mergeFavorites([
          { id: "course-a", name: "Course A" },
          { id: "course-b", name: "Course B" },
        ]);
      });

      expect(mockFetch).toHaveBeenCalledWith("/api/user/favorites/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseIds: ["course-a", "course-b"] }),
      });
    });

    it("favoritesReady is false until server fetch completes", async () => {
      mockedGetFavorites.mockReturnValue([]);
      mockedGetFavoriteDetails.mockReturnValue([]);

      // Use a manually-resolved promise to control fetch timing
      let resolveFetch!: (value: unknown) => void;
      const fetchPromise = new Promise((resolve) => {
        resolveFetch = resolve;
      });
      mockFetch.mockReturnValueOnce(fetchPromise);

      const { result } = renderHook(() => useFavorites());

      // Before fetch resolves, favoritesReady must still be false
      expect(result.current.favoritesReady).toBe(false);

      // Resolve the fetch
      await act(async () => {
        resolveFetch({
          ok: true,
          json: async () => ({ favorites: [] }),
        });
      });

      // Now favoritesReady should be true
      expect(result.current.favoritesReady).toBe(true);
    });

    it("favoritesReady becomes true even when server fetch returns non-ok", async () => {
      mockedGetFavorites.mockReturnValue([]);
      mockedGetFavoriteDetails.mockReturnValue([]);
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const { result } = renderHook(() => useFavorites());

      await waitFor(() => {
        expect(result.current.favoritesReady).toBe(true);
      });
    });

    it("favoritesReady becomes true when server fetch throws", async () => {
      mockedGetFavorites.mockReturnValue([]);
      mockedGetFavoriteDetails.mockReturnValue([]);
      mockFetch.mockRejectedValueOnce(new Error("network failure"));

      const { result } = renderHook(() => useFavorites());

      await waitFor(() => {
        expect(result.current.favoritesReady).toBe(true);
      });
    });
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/use-favorites.test.ts`
Expected: FAIL — `mergeFavorites` and `favoritesReady` are not returned by the hook

**Step 3: Implement the changes**

In `src/hooks/use-favorites.ts`:

1. Add `isLoading` to the useAuth destructuring. Find:
```typescript
  const { isLoggedIn, favoritesVersion, showToast } = useAuth();
```
Replace with:
```typescript
  const { isLoggedIn, isLoading, favoritesVersion, showToast } = useAuth();
```

2. Add a `favoritesReady` state. Find:
```typescript
  const [favoriteDetails, setFavoriteDetails] = useState<FavoriteEntry[]>([]);
```
Add after it:
```typescript
  const [favoritesReady, setFavoritesReady] = useState(false);
```

3. Do NOT modify the existing localStorage useEffect (`useEffect([], [])`). Leave it as-is. Add a NEW effect AFTER the localStorage effect to handle anonymous `favoritesReady`. Insert this right after the `useEffect(() => { setFavorites(...); setFavoriteDetails(...); }, []);` block:
```typescript
  // Mark favorites ready once auth resolves for anonymous users
  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      setFavoritesReady(true);
    }
  }, [isLoading, isLoggedIn]);
```

4. Set `favoritesReady` after server fetch completes (for logged-in users). Find the existing server fetch effect — look for the `fetchServerFavorites` function. The function currently has a `try`/`catch` structure. **Add a `finally` block** to set `favoritesReady` in ALL exit paths (success, non-ok response, network error):

The current code structure looks like:
```typescript
    async function fetchServerFavorites() {
      try {
        const res = await fetch("/api/user/favorites");
        if (!res.ok || cancelled) return;
        // ... process response ...
        localSetFavorites(details);
      } catch {
        // Keep localStorage data on fetch failure
      }
    }
```

Add a `finally` block after the `catch`:
```typescript
    async function fetchServerFavorites() {
      try {
        const res = await fetch("/api/user/favorites");
        if (!res.ok || cancelled) return;
        // ... process response ...
        localSetFavorites(details);
      } catch {
        // Keep localStorage data on fetch failure
      } finally {
        if (!cancelled) {
          setFavoritesReady(true);
        }
      }
    }
```

**Why `finally` instead of adding to both `try` and `catch`:** The existing code has `if (!res.ok || cancelled) return;` which early-returns from the try block on non-ok responses. This `return` skips any code after it in the try block but does NOT skip `finally`. So `finally` covers all three paths:
- **Success:** try completes normally → finally runs ✓
- **Non-ok response:** `return` exits try → finally runs ✓
- **Network error:** catch handles it → finally runs ✓
- **Cancelled (unmounted):** `!cancelled` guard prevents setting state on unmounted component ✓

5. Add the `mergeFavorites` callback. Add this after the `isFavorite` callback (before the `return` statement):

```typescript
  const mergeFavorites = useCallback(
    async (entries: FavoriteEntry[]) => {
      // Deduplicate against current favorites
      const newEntries = entries.filter(
        (e) => !favorites.includes(e.id)
      );
      if (newEntries.length === 0) return;

      // Update local state + localStorage
      const merged = [...favoriteDetails, ...newEntries];
      setFavoriteDetails(merged);
      setFavorites(merged.map((d) => d.id));
      localSetFavorites(merged);

      // Logged-in: also sync to server
      if (isLoggedIn) {
        try {
          await fetch("/api/user/favorites/merge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ courseIds: newEntries.map((e) => e.id) }),
          });
        } catch {
          // localStorage already updated; server will catch up on next login
        }
      }
    },
    [isLoggedIn, favorites, favoriteDetails]
  );
```

6. Update the return statement. Find:
```typescript
  return { favorites, favoriteDetails, toggleFavorite, isFavorite };
```
Replace with:
```typescript
  return { favorites, favoriteDetails, toggleFavorite, isFavorite, mergeFavorites, favoritesReady };
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/use-favorites.test.ts`
Expected: All pass

**Step 5: Run full test suite + type-check**

Run: `npm test`
Expected: All pass

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/hooks/use-favorites.ts src/hooks/use-favorites.test.ts
git commit -m "feat: add mergeFavorites and favoritesReady to useFavorites hook"
```

---

## Task 4: Add "Share" button to favorites dropdown

Add a "Share" link as the first item in the favorites dropdown. When clicked, it encodes the current favorites as a bitfield URL and copies it to the clipboard.

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Add imports**

In `src/app/page.tsx`, find:
```typescript
import { todayCT } from "@/lib/format";
```
Add after it:
```typescript
import { encodeFavorites, buildShareUrl } from "@/lib/share";
import courseCatalog from "@/config/courses.json";
```

**Step 2: Add the useAuth import and hook call**

`page.tsx` does NOT currently import or use `useAuth`. We need it for `showToast`. Add the import after the existing `useFavorites` import line:

Find:
```typescript
import { useFavorites } from "@/hooks/use-favorites";
```
Add after it:
```typescript
import { useAuth } from "@/components/auth-provider";
```

Then add the `useAuth` call. Find:
```typescript
  const { favorites, favoriteDetails } = useFavorites();
```
Add this line immediately after it:
```typescript
  const { showToast } = useAuth();
```

**Step 3: Add the share handler**

Add the share handler function inside the `Home` component, after the `favListRef` declaration (after `const favListRef = useRef<HTMLDivElement>(null);`):

```typescript
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
```

Note: After Task 1 adds `"index"` to every course in courses.json, TypeScript infers the type from the JSON import. `course.index` and `course.id` are known types — no explicit type annotations or casts needed.

**Step 4: Add the Share button to the dropdown**

In `src/app/page.tsx`, find the favorites dropdown content:
```typescript
          {showFavList && (
            <div className="absolute left-0 top-full z-10 mt-1 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              {favoriteDetails.map((fav) => (
```

Replace the opening of the dropdown div to insert the Share button before the course list:
```typescript
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
```

**Step 5: Run tests + type-check**

Run: `npm test`
Expected: All pass

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add share button to favorites dropdown"
```

---

## Task 5: Create the share confirmation dialog

A modal dialog that lists the shared courses and lets the recipient accept or cancel.

**Files:**
- Create: `src/components/share-dialog.tsx`
- Create: `src/components/share-dialog.test.tsx`

**Step 1: Write the failing tests**

Create `src/components/share-dialog.test.tsx`:

```typescript
// @vitest-environment jsdom
// ABOUTME: Tests for the share favorites confirmation dialog.
// ABOUTME: Covers rendering, accept, cancel, and empty state.

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ShareDialog } from "./share-dialog";

describe("ShareDialog", () => {
  const courses = [
    { id: "braemar", name: "Braemar" },
    { id: "edinburgh-usa", name: "Edinburgh USA" },
  ];

  it("renders course names", () => {
    render(<ShareDialog courses={courses} onAccept={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Braemar")).toBeDefined();
    expect(screen.getByText("Edinburgh USA")).toBeDefined();
  });

  it("shows count in heading", () => {
    render(<ShareDialog courses={courses} onAccept={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/Add 2 courses/)).toBeDefined();
  });

  it("calls onAccept when accept button is clicked", () => {
    const onAccept = vi.fn();
    render(<ShareDialog courses={courses} onAccept={onAccept} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("Add to favorites"));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("calls onCancel when cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<ShareDialog courses={courses} onAccept={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("No thanks"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("uses singular heading for one course", () => {
    render(
      <ShareDialog
        courses={[{ id: "braemar", name: "Braemar" }]}
        onAccept={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText(/Add 1 course/)).toBeDefined();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/share-dialog.test.tsx`
Expected: FAIL — module does not exist

**Step 3: Write the implementation**

Create `src/components/share-dialog.tsx`:

```typescript
"use client";
// ABOUTME: Confirmation dialog shown when a user opens a share-favorites link.
// ABOUTME: Lists the shared courses and offers Accept/Cancel before merging.

interface ShareDialogProps {
  courses: { id: string; name: string }[];
  onAccept: () => void;
  onCancel: () => void;
}

export function ShareDialog({ courses, onAccept, onCancel }: ShareDialogProps) {
  const count = courses.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="mx-4 w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">
          Add {count} {count === 1 ? "course" : "courses"} to your favorites?
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Someone shared their favorite courses with you:
        </p>
        <ul className="mt-3 space-y-1">
          {courses.map((course) => (
            <li
              key={course.id}
              className="rounded px-2 py-1 text-sm text-gray-700 bg-stone-50"
            >
              {course.name}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex gap-3">
          <button
            onClick={onAccept}
            className="flex-1 rounded bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            Add to favorites
          </button>
          <button
            onClick={onCancel}
            className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            No thanks
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/share-dialog.test.tsx`
Expected: All pass

**Step 5: Run full test suite + type-check**

Run: `npm test`
Expected: All pass

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/components/share-dialog.tsx src/components/share-dialog.test.tsx
git commit -m "feat: add share favorites confirmation dialog component"
```

---

## Task 6: Integrate share link receiving into page.tsx

When page.tsx detects a `?f=` query parameter, it decodes the bitfield, resolves course names from the catalog, filters out duplicates, and shows the ShareDialog. On accept, it calls `mergeFavorites`. On accept or cancel, it strips the `?f=` param.

**Context for subagent:** Read `src/app/page.tsx` first. After Tasks 3 and 4 have run, the file will have:
- `import { encodeFavorites, buildShareUrl } from "@/lib/share";` (added by Task 4)
- `import courseCatalog from "@/config/courses.json";` (added by Task 4)
- `import { useAuth } from "@/components/auth-provider";` (added by Task 4)
- `const { favorites, favoriteDetails } = useFavorites();` (original, unchanged)
- `const { showToast } = useAuth();` (added by Task 4, right after useFavorites line)
- A `handleShare` function (added by Task 4)
- `useState` and `useRef` are already imported from React (line 5 of original file)

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Update the share import**

Find the import that Task 4 added:
```typescript
import { encodeFavorites, buildShareUrl } from "@/lib/share";
```
Replace with:
```typescript
import { encodeFavorites, decodeFavorites, buildShareUrl, resolveSharedCourses } from "@/lib/share";
```

**Step 2: Add the ShareDialog import**

Find:
```typescript
import { TeeTimeList } from "@/components/tee-time-list";
```
Add after it:
```typescript
import { ShareDialog } from "@/components/share-dialog";
```

**Step 3: Update useFavorites destructuring**

Find:
```typescript
  const { favorites, favoriteDetails } = useFavorites();
```
Replace with:
```typescript
  const { favorites, favoriteDetails, mergeFavorites, favoritesReady } = useFavorites();
```

**Step 4: Add state and effect for share link detection**

Add this state and effect after the `favoritesInitialized` effect (the one ending with `}, [favorites]`). Note: `useState` and `useRef` are already imported — do NOT add duplicate imports.

```typescript
  // Share link handling
  const [sharedCourses, setSharedCourses] = useState<{ id: string; name: string }[]>([]);
  const shareProcessed = useRef(false);

  useEffect(() => {
    if (shareProcessed.current || !favoritesReady) return;

    const params = new URLSearchParams(window.location.search);
    const fParam = params.get("f");
    if (!fParam) return;

    shareProcessed.current = true;

    const indices = decodeFavorites(fParam);
    if (indices.length === 0) {
      // Invalid encoding — silently strip param
      params.delete("f");
      history.replaceState({}, "", window.location.pathname + (params.toString() ? "?" + params : ""));
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
      params.delete("f");
      history.replaceState({}, "", window.location.pathname + (params.toString() ? "?" + params : ""));
      return;
    }

    setSharedCourses(newCourses);
  }, [favoritesReady, favorites, showToast]);
```

**Step 5: Add accept/cancel handlers**

Add these after the `handleShare` function (which was added by Task 4):

```typescript
  const handleAcceptShare = async () => {
    await mergeFavorites(sharedCourses);
    showToast(`Added ${sharedCourses.length} ${sharedCourses.length === 1 ? "course" : "courses"} to favorites`);
    setSharedCourses([]);
    const params = new URLSearchParams(window.location.search);
    params.delete("f");
    history.replaceState({}, "", window.location.pathname + (params.toString() ? "?" + params : ""));
  };

  const handleCancelShare = () => {
    setSharedCourses([]);
    const params = new URLSearchParams(window.location.search);
    params.delete("f");
    history.replaceState({}, "", window.location.pathname + (params.toString() ? "?" + params : ""));
  };
```

**Step 6: Render the dialog**

In the JSX, add the dialog just before the closing `</main>` tag. Find:
```typescript
      <div className="mt-4">
        <TeeTimeList teeTimes={teeTimes} loading={loading} />
      </div>
    </main>
```
Replace with:
```typescript
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
```

**Step 7: Run tests + type-check**

Run: `npm test`
Expected: All pass

Run: `npx tsc --noEmit`
Expected: No errors

**Step 8: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: detect share links and show confirmation dialog on home page"
```

---

## Task 7: Final verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Lint**

Run: `npm run lint`
Expected: No errors

---

## Summary of Changes

| Task | Files | Description |
|------|-------|-------------|
| 1 | `courses.json` | Add permanent `index` to each course |
| 2 | `share.ts`, `share.test.ts` | Bitfield encode/decode + URL builder + catalog resolver |
| 3 | `use-favorites.ts`, `use-favorites.test.ts` | Add `mergeFavorites()` and `favoritesReady` |
| 4 | `page.tsx` | Share button in favorites dropdown |
| 5 | `share-dialog.tsx`, `share-dialog.test.tsx` | Confirmation dialog component |
| 6 | `page.tsx` | Detect `?f=` param, show dialog, handle accept/cancel |
| 7 | — | Final verification |
