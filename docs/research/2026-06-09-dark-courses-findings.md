# Dark-Courses Investigation — Findings (2026-06-09)

> Investigation results for the 17 "dark" courses (16 Chronogolf + `deer-run`) that have **never** returned a tee time (`last_had_tee_times IS NULL`, zero `success` rows in `poll_log`). Companion to the brief `docs/plans/2026-06-09-dark-courses-investigation.md`. Sibling fix already planned for the related Oak Glen/Gem Lake case: `docs/plans/2026-06-09-oak-glen-gem-lake-foreup-fix-plan.md`.

## TL;DR

All 17 are real problems, not empty inventory. **None are "recovering" from the Chronogolf 429 fix** — they had already left Chronogolf. The picture:

- **10 → bucket A, migrated to a platform we already support** → flip `courses.json` (same mechanic as Oak Glen). 9 are ready now; `legends-club` needs one CPS id-discovery step first.
- **6 → bucket A, migrated to a platform we have NO adapter for** (Club Caddie ×3, EZLinks ×2, TenFore ×1) → public online tee times exist, but unpollable today. Disable now and/or build adapters (a product call).
- **1 → bucket C**, `royal-golf-club` converted public→private (members-only). Disable.
- **0 → bucket B** (recovering).

## How each was determined (method + key signals)

1. **Production `poll_log` (prod D1, `--remote`):** every one of the 17 shows **only `error` + `no_data`, never a single `success`**, across the full retention window (dates `2026-06-02`→`2026-06-21`). Critically, the `error` rows (Chronogolf 429s) all stop at/before `2026-06-09T00:35Z` — the PR #131 fix boundary — but `no_data` rows **continue** past `06:03Z`. So post-fix these courses poll cleanly (HTTP 200) and the upstream returns an **empty teesheet**. That is the COURSE-3 "silent `no_data` = wrong-platform/closed" signature, not 429 starvation.
2. **Chronogolf clubs API (authoritative):** `GET https://www.chronogolf.com/marketplace/v2/clubs/<clubSlug>` returns `{active, state, name, website, courses:[{uuid,id,name}]}`.
   - For **all 16 Chronogolf courses our stored `courseId` UUID still matches the club's live course list** — so this is **not** a stale-UUID typo (unlike Oak Glen). The clubs themselves went `active:false` (deactivated on the marketplace) → `marketplace/v2/teetimes` returns `status:"closed"` with zero times.
   - `le-sueur` → HTTP **404** (club fully removed from Chronogolf).
   - `royal-golf-club` → the lone `active:true`, yet `teetimes` returns `status:"closed"` for **every** date today→+14 (verified). Active-but-empty = gone-private fingerprint.
3. **Live booking-site verification (COURSE-3 discipline — never trust the catalog):** for each course, followed the course's **own current website "Book Tee Time"** button to the real booking host, identified the platform from the host, and **reproduced a live public tee-times call** where the platform was supported. Tooling note: the live data hosts fingerprint-block Node's `fetch` (HTTP 403) — use **curl** with a browser `User-Agent`; and on Windows, pipe `curl → node` via stdin (the MSYS `/tmp` that curl writes ≠ the Windows `/tmp` node reads).

## Per-course results

Legend — Verdict: **A** = migrated (reconfigure), **C** = no public online tee times (disable), **D** = migrated to an unsupported/hard platform. ✅ = adapter exists; ❌ = no adapter. "Live" = a tee-times call was actually reproduced.

| course_id | old (catalog) config | live platform / ids (verified) | adapter | verdict | live result | recommended action |
|---|---|---|---|---|---|---|
| `crystal-lake` | chronogolf `351035bc…` | **ForeUp** facility `22877` / schedule `12220` | ✅ | **A** | 51 times (06-13) | flip → foreup |
| `deer-run` | **teeitup** facility `3910` | **ForeUp** facility `21800` / schedule `8918` | ✅ | **A** | 16 times | flip → foreup |
| `eagle-valley` | chronogolf `bd6ac210…` | **MemberSports** golfClubId `9133` / golfCourseId `11343` | ✅ | **A** | 85 slots | flip → membersports |
| `elk-river` | chronogolf `50a3cbff…` | **TeeItUp** alias `elk-river-golf-club` / facility `3885` | ✅ | **A** | 46 times | flip → teeitup |
| `oak-marsh` | chronogolf `a7e0c4ab…` | **TeeItUp** alias `oak-marsh-golf-course` / facility `4585` | ✅ | **A** | 32 times | flip → teeitup |
| `rum-river-hills` | chronogolf `60f06328…` | **TeeItUp** alias `rum-river-hills-golf-club` / facility `8793` | ✅ | **A** | 35 times | flip → teeitup |
| `the-refuge` | chronogolf `cc7814f0…` | **TeeItUp** alias `the-refuge-golf-club` / facility `3921` | ✅ | **A** | 71 times | flip → teeitup |
| `the-meadows-at-mystic-lake` | chronogolf `7676fb71…` | **ForeUp** facility `22252` / schedule `10233` | ✅ | **A** | 4 times (18h only) | flip → foreup |
| `le-sueur` | chronogolf `139c6707…` (404) | **TeeWire** tenant `le-sueur` / calendarId `1` | ✅* | **A** | 50 times (curl_cffi) | flip → teewire (+ walking-rate fix) |
| `legends-club` | chronogolf `bcc1d8e7…` | **CPS Golf** subdomain `legendsmn` / courseIds `1` / websiteId `30bb60d4-447d-4f71-6792-08db3854da2c` | ✅ | **A** | 27 times (06-13, $107.96/18h) | flip → cps_golf |
| `fox-hollow` | chronogolf `8804eb6e…` | **Club Caddie** clubid `103436` (view `gdfdabab`) | ❌ | **A/D** | public booking confirmed (SPA) | disable=1; flag Club Caddie |
| `riverwood-national` | chronogolf `805c45c8…` | **Club Caddie** `apimanager-cc29` view `ehfdabab` (+ Vintage `fhfdabab`) | ❌ | **A/D** | live sheet rendered (~80 slots) | disable=1; flag Club Caddie |
| `stonebrooke` | chronogolf `68d4d6d6…` | **Club Caddie** `apimanager-cc37` view `cifdabab` / clubid `103482` | ❌ | **A/D** | site confirms public online booking | disable=1; flag Club Caddie |
| `hastings-golf-club` | chronogolf `f65ea518…` | **EZLinks** `hastings.ezlinksgolf.com` (public portal) | ❌ | **A/D** | public portal confirmed (CF-gated) | disable=1; flag EZLinks |
| `the-wilds` | chronogolf `4bef65fa…` | **EZLinks** `wildsgolfclubpub.ezlinksgolf.com` | ❌ | **A/D** | public portal confirmed (CF-gated) | disable=1; flag EZLinks |
| `links-at-northfork` | chronogolf `d2babb81…` | **TenFore Golf** golfCourseID `16553` (`fox.tenfore.golf`) | ❌ | **A/D** | live sheet rendered ($77/18h); times POST is reCAPTCHA-gated | disable=1; flag TenFore (hard) |
| `royal-golf-club` | chronogolf `292c9895…` (`active:true`) | **none — went private** (members-only) | n/a | **C** | no public inventory any date today→+14 | disable=1 (private) |

\* TeeWire routes through the Lambda/curl_cffi proxy in prod (teewire.app is Cloudflare-protected), so `le-sueur` is pollable in prod despite plain curl being blocked locally.

## Exact corrected configs (bucket A, supported — ready to write to `courses.json`)

Schema confirmed against existing entries (braemar/keller/river-oaks/inver-wood-18). Only `platform`, `platformConfig`, `bookingUrl` change; leave `id`/`name`/`city`/`state`/`address`/lat-lng/`googlePlaceId`/`index` untouched.

```jsonc
// crystal-lake
"platform": "foreup",
"platformConfig": { "facilityId": "22877", "scheduleId": "12220" },
"bookingUrl": "https://foreupsoftware.com/index.php/booking/22877/12220"

// deer-run
"platform": "foreup",
"platformConfig": { "facilityId": "21800", "scheduleId": "8918" },
"bookingUrl": "https://foreupsoftware.com/index.php/booking/21800/8918"

// the-meadows-at-mystic-lake  (18-hole only — site states no 9-hole rate)
"platform": "foreup",
"platformConfig": { "facilityId": "22252", "scheduleId": "10233" },
"bookingUrl": "https://foreupsoftware.com/index.php/booking/22252/10233"

// eagle-valley
"platform": "membersports",
"platformConfig": { "golfClubId": "9133", "golfCourseId": "11343" },
"bookingUrl": "https://app.membersports.com/tee-times/9133/11343/0"

// elk-river
"platform": "teeitup",
"platformConfig": { "alias": "elk-river-golf-club", "apiBase": "https://phx-api-be-east-1b.kenna.io", "facilityId": "3885" },
"bookingUrl": "https://elk-river-golf-club.book.teeitup.golf/"

// oak-marsh
"platform": "teeitup",
"platformConfig": { "alias": "oak-marsh-golf-course", "apiBase": "https://phx-api-be-east-1b.kenna.io", "facilityId": "4585" },
"bookingUrl": "https://oak-marsh-golf-course.book.teeitup.golf/"

// rum-river-hills
"platform": "teeitup",
"platformConfig": { "alias": "rum-river-hills-golf-club", "apiBase": "https://phx-api-be-east-1b.kenna.io", "facilityId": "8793" },
"bookingUrl": "https://rum-river-hills-golf-club.book.teeitup.golf/"

// the-refuge   (alias ≠ subdomain — see gotcha)
"platform": "teeitup",
"platformConfig": { "alias": "the-refuge-golf-club", "apiBase": "https://phx-api-be-east-1b.kenna.io", "facilityId": "3921" },
"bookingUrl": "https://refuge-golf-club.book.teeitup.com/"

// le-sueur   (price will be null until the TeeWire walking-rate matcher is generalized — see gotcha)
"platform": "teewire",
"platformConfig": { "tenant": "le-sueur", "calendarId": "1" },
"bookingUrl": "https://teewire.app/le-sueur/"
```

```jsonc
// legends-club  (discovered via GetAllOptions + curl_cffi; full flow live-verified 27 times 06-13)
"platform": "cps_golf",
"platformConfig": { "subdomain": "legendsmn", "courseIds": "1", "websiteId": "30bb60d4-447d-4f71-6792-08db3854da2c" },
"bookingUrl": "https://legendsmn.cps.golf/onlineresweb"
```
(Discovery method, for the record: short-lived token at `/identityapi/myconnect/token/short` → `GET /onlineres/onlineapi/api/v1/onlinereservation/GetAllOptions/legendsmn?product=3` with the bearer + `x-componentid`/`x-moduleid`/`x-productid` headers → `webSiteId` top-level + `courseOptions[].courseId`. v5 flow, no `authType`.)

## Gotchas surfaced (carry into the fix)

1. **`.book.teeitup.golf` vs `.book.teeitup.com`.** Several migrated courses use the `.golf` TLD. The TeeItUp adapter only talks to the `kenna.io` `apiBase` with the `x-be-alias` header, so the adapter is unaffected — only the user-facing `bookingUrl` host differs. Existing catalog uses `.com/?course=<id>`; the `.golf` form also works.
2. **TeeItUp alias ≠ URL subdomain (The Refuge).** Subdomain is `refuge-golf-club` but the kenna `x-be-alias` is `the-refuge-golf-club`. Using the subdomain as alias → "Not Found". Always read the embedded `<input id="alias">` from the booking page. (The `.golf` sibling tenant for The Refuge returns HTTP 500 — use `.com`.)
3. **TeeWire walking-rate matcher (le-sueur).** `src/adapters/teewire.ts:95` selects the walking price via `rate_title.includes("Walking")`. Le Sueur's titles are plain `"9 Holes"` / `"18 Holes"` (cart variants `"… w/ Cart"`), so nothing matches → `price = null`. Le Sueur will surface tee times but with null prices until the matcher is generalized (treat the non-"Cart" title as walking) — and any change must not break the existing TeeWire course whose titles DO contain "Walking". TDD applies (production-code change).
4. **Stale aggregator/Squarespace pages mislead.** Le Sueur's old Squarespace page still advertises EZLinks; the live `lsccgolf.com` uses TeeWire. Rum River Hills' own page lists `*.ezlinksgolf.com` hosts, but those are league/member/patron sheets — the **public** "Book Now" is TeeItUp. Always trust the current primary domain's public booking button, not cached pages or member portals.
5. **Riverwood = two courses.** The Club Caddie facility runs Riverwood National (`ehfdabab`) **and** Vintage (`fhfdabab`); the catalog has only one `riverwood-national` row. Capture both if/when an adapter exists.
6. **Club Caddie zero-price artifact.** Club Caddie shows a `$0.00 – $59.95` rate *range*; the real green fee is the upper bound (same shape as the Eagle Club zero-pricing quirk).

## New platform coverage gaps (adapter candidates)

| platform | courses | difficulty | notes |
|---|---|---|---|
| **Club Caddie** | `fox-hollow`, `riverwood-national`, `stonebrooke` (3) | medium | Times via `POST .../webapi/TeeTimes` gated by a PHPSESSID + Interaction-token handshake bootstrapped in JS — not stateless. Highest-value (3 courses). |
| **EZLinks** | `hastings-golf-club`, `the-wilds` (2) | medium-hard | `<tenant>.ezlinksgolf.com` SPA behind a hard Cloudflare challenge (needs the curl_cffi/Lambda proxy path, like CPS). An `ezlinks.smoke.test.ts` exists but there is **no** `ezlinks.ts` adapter. |
| **TenFore Golf** | `links-at-northfork` (1) | hard | `swan.tenfore.golf` times POST is **reCAPTCHA-gated** ("reCAPTCHA token is required.") — defeats a stateless HTTP adapter. Lowest priority (1 course). |

## Recommendation

These findings + the Oak Glen/Gem Lake plan are **one bug class** (course migrates booking provider → old platform answers without error → silent `no_data` forever → only signal is `last_had_tee_times IS NULL`). Recommend **one consolidated catalog-fix plan** via `writing-plans-enhanced`, structured as phases:

- **10 ready reconfigurations** (all supported-platform bucket-A courses, including `legends-club` — its CPS ids were discovered + live-verified 2026-06-09). Pure `courses.json` flip + `scripts/seed.sql` regen. No app code, TDD-exempt. Review-class (catalog/data integrity).
- **Disable the 7 unpollable courses** (6 unsupported-platform + `royal-golf-club` private) via `disabled: 1` in `courses.json`. All 17 are present in `courses.json` (unlike Oak Glen's orphans), and the seed UPSERT already carries `disabled` (`scripts/seed.ts` emits `disabled=excluded.disabled`; 15 catalog entries already use the flag) — so **no migration is needed**, just the flag.
- **TeeWire walking-rate fix** for le-sueur (production-code, TDD).
- Fold in the Oak Glen/Gem Lake 4 flips + orphan-row migration (`docs/plans/2026-06-09-oak-glen-gem-lake-foreup-fix-plan.md`).

**Decisions made (Sam, 2026-06-09):** ✅ one consolidated plan (written: `docs/plans/2026-06-09-dark-courses-catalog-fix-plan.md`); ✅ disable the 6 unsupported-platform courses now, build Club Caddie / EZLinks / TenFore adapters later (journaled as candidates).

Merge class: Review (catalog correctness + prod `courses` table), per `docs/git-strategy.md`.
