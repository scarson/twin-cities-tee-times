# Share Favorites via Link — Design

**Goal:** Let users share their favorite courses with others via a compact URL. Recipients see a confirmation dialog listing the courses before accepting.

**Architecture:** Encode favorite course indices as a bitfield in a URL query parameter. Decode on the recipient's page load, show confirmation, union-merge into their favorites. Pure client-side — no new API endpoints needed (logged-in users reuse the existing merge endpoint).

## URL Encoding

Each course in `courses.json` has a permanent `index` field (monotonically increasing integer, never reused even if a course is deactivated). The share URL encodes the user's favorites as a bitfield:

1. Build a byte array where bit N is set if the course at index N is favorited
2. Base64url-encode the byte array (URL-safe, no padding)
3. Prefix with `v1.` for format versioning (`.` is not in the base64url alphabet, so it's an unambiguous delimiter that doesn't get percent-encoded in URLs)
4. Attach as `?f=v1.UAAA` query parameter

**Scaling:** 19 courses = 3 bytes = 4 base64 chars. 100 courses = 13 bytes = 18 chars. 200 courses = 25 bytes = 34 chars. Well within URL length limits even for text messages.

**Stable indices:** Course indices are permanent. New courses get `max(existing indices) + 1`. Deactivated courses keep their index. This ensures old share links remain valid.

## Sharing (Sender)

- The favorites dropdown on the home page shows a "Share" link as its first item (only visible when dropdown is open and user has favorites)
- Clicking "Share" builds the bitfield URL and copies it to clipboard via `navigator.clipboard.writeText()`
- Toast confirms: "Share link copied!"

## Receiving (Recipient)

- On page load, `page.tsx` checks for `?f=` query parameter
- Waits for favorites to finish loading (localStorage + server fetch for logged-in users) before processing — avoids race condition where we can't correctly deduplicate
- Decodes the bitfield to course IDs, resolves names from the course catalog
- Filters out courses the recipient already has favorited
- If new courses remain: shows a confirmation dialog listing course names with Accept/Cancel
- If all shared courses are already favorited: shows toast "You already have all these courses"
- On accept: union-merges into favorites
  - Anonymous: writes to localStorage directly
  - Logged-in: calls `POST /api/user/favorites/merge` (existing endpoint)
- On accept or cancel: strips `?f=` from URL via `history.replaceState()`

## Ordering with `justSignedIn`

If both `?justSignedIn=true` and `?f=` are present (user signed in via a share link), process `justSignedIn` first (post-login merge), then handle the share link. The auth provider already strips `justSignedIn`; the share dialog waits for favorites to stabilize.

## Edge Cases

- **Invalid/corrupted `?f=` value:** silently strip the param, no dialog
- **Unknown course index in bitfield:** skip that index (course may have been removed)
- **No favorites to share:** "Share" button doesn't appear (dropdown requires favorites)
- **All shared courses already favorited:** toast instead of dialog
- **Version prefix mismatch:** if the prefix isn't `v1.`, silently ignore (forward-compatible)

## New Files

- `src/lib/share.ts` — encode/decode functions (pure, testable)
- `src/lib/share.test.ts` — bitfield encoding round-trips, edge cases
- `src/components/share-dialog.tsx` — confirmation dialog component

## Modified Files

- `src/config/courses.json` — add `index` field to every course
- `src/app/page.tsx` — read `?f=` param, show dialog, handle accept/cancel
- `src/hooks/use-favorites.ts` — expose a `mergeFavorites` function for bulk adds
- Possibly `src/types/index.ts` — add `index` to `CourseConfig` if needed
