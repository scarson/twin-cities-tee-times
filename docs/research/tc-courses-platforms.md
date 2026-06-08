# Twin Cities Public Golf Courses - Booking Platform Catalog

**Last updated:** 2026-03-08
**Status:** Living document - research ongoing

## Platform Summary

| Platform | 18-Hole | 9-Hole/Par 3 | Total |
|----------|---------|---------------|-------|
| CPS Golf (Club Prophet) | 12 | 2 | 14 |
| Chronogolf/Lightspeed | 27 | 8 | 35 |
| TeeItUp | 7 | 1 | 8 |
| ForeUp | 5 | 1 | 6 |
| Teesnap | 2 | 0 | 2 |
| MemberSports | 1 | 0 | 1 |
| GolfNow (primary) | 3 | 2 | 5 |
| Eagle Club Systems | 1 | 0 | 1 |
| EZLinks | 1 | 0 | 1 |
| City/Custom System | 0 | 3 | 3 |
| Unknown/Closed | 2 | 2 | 4 |
| **Total** | **61** | **19** | **80** |

> **Course count note:** The total exceeds the input list because all 11 previously-known
> favorites are included alongside the newly-researched courses. Some facilities have
> multiple course entries (e.g., Highland National 18 + Highland 9-Hole).

> **Note:** Some courses appear on multiple aggregators (GolfNow, Chronogolf, etc.) as resellers.
> The platform listed here is the **primary/direct booking system** when identifiable.
> "Chronogolf" listings may be the direct system OR just an aggregator listing -- marked with notes where unclear.

---

## CPS Golf (Club Prophet Systems)

Courses using `{subdomain}.cps.golf` for direct online reservations.

| Course Name | City | Holes | Booking URL/ID | Notes |
|---|---|---|---|---|
| Theodore Wirth | Minneapolis | 18 | minneapolistheodorewirth.cps.golf | *Favorite* - Minneapolis Park Board |
| Gross National | Minneapolis | 18 | minneapolisgrossnational.cps.golf | *Favorite* - Minneapolis Park Board |
| Meadowbrook | Minneapolis | 18 | minneapolismeadowbrook.cps.golf | *Favorite* - Minneapolis Park Board |
| Columbia | Minneapolis | 18 | minneapoliscolumbia.cps.golf | *Favorite* - Minneapolis Park Board |
| Hiawatha | Minneapolis | 18 | minneapolishiawatha.cps.golf | Minneapolis Park Board |
| Phalen | St. Paul | 18 | phalen.cps.golf | *Favorite* - St. Paul city course |
| Chaska Town Course | Chaska | 18 | chaska.cps.golf | *Favorite* |
| Edinburgh USA | Brooklyn Park | 18 | edinburghusa.cps.golf | City of Brooklyn Park |
| Oak Glen | Stillwater | 18 | oakglen.cps.golf | 27 holes (18 championship + 9 executive) |
| Highland National | St. Paul | 18 | highlandnationalmn.cps.golf | St. Paul city course; includes Highland 9-Hole |
| Highland 9-Hole | St. Paul | 9 | highlandnationalmn.cps.golf | Shares CPS system with Highland National |
| Como Park | St. Paul | 18 | como.cps.golf | St. Paul city course |
| Victory Links | Blaine | 18 | victorylinksmn.cps.golf | National Sports Center |
| Gem Lake Hills | White Bear Lake | 9 | gem.cps.golf | Also listed on TeeItUp; two 9-hole courses |

**Notes:**
- Minneapolis Park Board courses (Wirth, Gross, Meadowbrook, Columbia, Hiawatha) all use CPS Golf.
- St. Paul city courses (Como, Phalen, Highland) also use CPS Golf.
- CPS Golf uses a static x-apikey for API access; 5 req/sec rate limit. See `booking-platform-investigation.md`.

---

## TeeItUp

Courses using `{tenant}.book.teeitup.com` or `book.teeitup.golf` for reservations.

| Course Name | City | Holes | Booking URL/ID | Notes |
|---|---|---|---|---|
| Keller | Maplewood | 18 | ramsey-county-golf.book.teeitup.com (course 17055) | *Favorite* - Ramsey County |
| Goodrich | Maplewood | 18 | ramsey-county-golf.book.teeitup.com (course 16959) | Ramsey County |
| Manitou Ridge | White Bear Lake | 18 | manitou-ridge-golf-course.book.teeitup.com | Ramsey County |
| Deer Run | Victoria | 18 | teeitup.com/golf/teetime.m?C=55386 | |
| Inver Wood | Inver Grove Heights | 18 | inverwood-golf-course.book.teeitup.golf | 27 holes (18 + 9 executive) |
| Bluff Creek | Chaska | 18 | teeitup.com/golf/course.wpl?C=55317 | |
| Logger's Trail | Stillwater | 18 | loggers-trail-golf-club.book.teeitup.golf | |
| Brightwood Hills | New Brighton | 9 | brightwood-hills-golf.book.teeitup.com | Par 30; may be closed - verify status |

**Notes:**
- Ramsey County courses (Keller, Goodrich, Manitou Ridge) share tenant `ramsey-county-golf`.
- TeeItUp provides both `.book.teeitup.com` and newer `.book.teeitup.golf` domains.

---

## Chronogolf / Lightspeed

Courses confirmed booking through Chronogolf (chronogolf.com). Some may use Chronogolf as their primary system; others may only appear as an aggregator listing alongside their actual POS. Listed here are courses where Chronogolf appears to be the **primary** booking platform (no other direct system found).

| Course Name | City | Holes | Chronogolf Club ID/URL | Notes |
|---|---|---|---|---|
| Baker National | Medina | 18 | chronogolf.com/club/8320 | *Favorite* - Three Rivers Park District |
| Brookview | Golden Valley | 18 | chronogolf.com/club/brookview-golf-course | City of Golden Valley |
| Crystal Lake | Lakeville | 18 | chronogolf.com/club/crystal-lake-golf-club-minnesota | |
| Dahlgreen | Chaska | 18 | chronogolf.com/club/dahlgreen-golf-club | Semi-private |
| Dwan | Bloomington | 18 | chronogolf.com/club/dwan-golf-club | City of Bloomington; login via Chronogolf |
| Eagle Valley | Woodbury | 18 | chronogolf.com/club/eagle-valley-golf-course-minnesota | |
| Elk River Golf Club | Elk River | 18 | chronogolf.com/club/elk-river-country-club | Semi-private, public welcome |
| Fountain Valley | Farmington | 18 | chronogolf.com/club/fountain-valley-golf-club | |
| Fox Hollow | St. Michael | 18 | chronogolf.com/club/fox-hollow-golf-club-minnesota | 27 holes |
| Green Haven | Anoka | 18 | chronogolf.com/club/greenhaven-golf-course | Book up to 21 days in advance |
| Hastings Golf Club | Hastings | 18 | chronogolf.com/club/hastings-country-club-minnesota | Semi-private |
| Legends Club | Prior Lake | 18 | chronogolf.com/club/legends-golf-club | |
| Links at Northfork | Ramsey | 18 | chronogolf.com/club/the-links-at-northfork | |
| Majestic Oaks | Ham Lake | 18 | chronogolf.com/club/majestic-oaks-golf-club | 45 holes; Arcis Golf managed |
| Oak Marsh | Oakdale | 18 | chronogolf.com/club/oak-marsh-golf-course | |
| Oneka Ridge | White Bear Lake | 18 | chronogolf.com/club/oneka-ridge-golf-course | |
| Pioneer Creek | Maple Plain | 18 | chronogolf.com/club/pioneer-creek-golf-course | Also listed on TeeItUp |
| Prestwick | Woodbury | 18 | chronogolf.com/club/prestwick-golf-club-at-wedgewood | |
| The Refuge | Oak Grove | 18 | chronogolf.com/club/the-refuge-golf-club-minnesota | |
| Riverwood National | Otsego | 18 | chronogolf.com/club/riverwood-national-golf-club | Also uses Club Caddie |
| Royal Golf Club | Lake Elmo | 18 | chronogolf.com/club/the-royal-club-minnesota | Annika/Palmer design |
| Rum River Hills | Ramsey | 18 | chronogolf.com/club/rum-river-hills-golf-club | |
| Rush Creek | Maple Grove | 18 | chronogolf.com/club/rush-creek-golf-club | |
| Stonebrooke | Shakopee | 18 | chronogolf.com/club/stonebrooke-golf-club | Dynamic pricing |
| The Meadows at Mystic Lake | Prior Lake | 18 | chronogolf.com/club/the-meadows-at-mystic-lake | Casino-owned |
| The Wilds Golf Club | Prior Lake | 18 | chronogolf.com/club/the-wilds-golf-club | Troon managed |
| Viking Meadows | East Bethel | 18 | chronogolf.com/club/viking-meadows-golf-club | 27 holes |
| Arbor Pointe | Inver Grove Heights | 9 | chronogolf.com/club/arbor-pointe-golf-club | Par 31 executive |
| Cleary Lake | Prior Lake | 9 | chronogolf.com/club/cleary-lake-golf-course | Three Rivers Park District |
| Eagle Lake Youth Golf Center | Plymouth | 9 | chronogolf.com/club/eagle-lake-youth-golf-center | Three Rivers Park District |
| Glen Lake Golf | Minnetonka | 9 | chronogolf.com/club/glen-lake-golf-course | Three Rivers Park District |
| Halla Greens | Chanhassen | 9 | chronogolf.com/club/halla-greens-executive | Par 29 executive |
| Hyland Greens | Bloomington | 9 | chronogolf.com/club/hyland-greens-golf-learning-center | Three Rivers Park District |
| Orono | Orono | 9 | chronogolf.com/club/orono-public-golf-course | Oldest public course in MN with grass greens |
| Sundance | Maple Grove | 9 | chronogolf.com/club/sundance-golf-club-minnesota | Course under redesign as of 2025-26 |

**Notes:**
- Three Rivers Park District courses (Baker, Cleary Lake, Eagle Lake, Glen Lake, Hyland Greens) all use Chronogolf.
- Chronogolf is owned by Lightspeed; many courses use it as their primary tee sheet.
- Pioneer Creek also appears on TeeItUp -- may use TeeItUp as primary with Chronogolf as aggregator.

---

## ForeUp

Courses using foreupsoftware.com for reservations.

| Course Name | City | Holes | ForeUp Facility/Schedule ID | Notes |
|---|---|---|---|---|
| Braemar | Edina | 18 | Facility 21445, Schedule 7829 | *Favorite* - City of Edina |
| Bunker Hills | Coon Rapids | 18 | Facility 20252 | *Favorite* - Anoka County |
| Roseville Cedarholm | Roseville | 9 | foreupsoftware.com/index.php/booking/22244/10216 | Par 27 |
| Pheasant Acres | Rogers | 18 | Unknown facility ID | ForeUp confirmed |
| Emerald Greens (Gold) | Hastings | 18 | Facility 19202, Schedule 1266 | 36-hole facility |
| Emerald Greens (Silver) | Hastings | 18 | Facility 19202, Schedule 1308 | 36-hole facility |

**Notes:**
- ForeUp has a public API with `api_key=no_limits`. See `booking-platform-investigation.md`.

---

## Teesnap

Courses using `{subdomain}.teesnap.net` for reservations.

| Course Name | City | Holes | Booking URL | Notes |
|---|---|---|---|---|
| Daytona | Dayton | 18 | daytonagolfclub.teesnap.net | Pay at course |
| StoneRidge | Stillwater | 18 | stoneridgegc.teesnap.net | Dynamic pricing; pre-pay online |

> **Note:** River Oaks Municipal (Cottage Grove) previously used Teesnap but has moved to MemberSports.

---

## MemberSports

Courses using `app.membersports.com` for reservations.

| Course Name | City | Holes | MemberSports IDs | Notes |
|---|---|---|---|---|
| River Oaks Municipal | Cottage Grove | 18 | golfClubId 9431, golfCourseId 11701 | Previously on Teesnap |

**Notes:**
- MemberSports uses a public REST API at `api.membersports.com` with a static `x-api-key`.
- Only River Oaks is confirmed to actively use MemberSports in the TC metro. Other MN courses have MemberSports catalog entries but don't use it for booking.

---

## GolfNow (Primary)

Courses where GolfNow appears to be the primary/only confirmed online booking platform (no direct system found).

| Course Name | City | Holes | GolfNow Facility ID | Notes |
|---|---|---|---|---|
| Chomonix | Lino Lakes | 18 | 7966 | Anoka County; also uses TeeMaster |
| Shamrock | Corcoran | 18 | 16977 | |
| Tanners Brook | Forest Lake | 18 | 13000 | |
| Southern Hills | Farmington | 18 | 3916 | |
| Centerbrook | Brooklyn Center | 9 | 15998 | Par 27; city course |
| New Hope Village | New Hope | 9 | 16040 | Par 27; city course |

**Notes:**
- GolfNow integration could mean these courses use GolfNow's built-in tee sheet, or they use a different POS that feeds into GolfNow.
- Further investigation needed to determine if there's a direct API.

---

## Eagle Club Systems

| Course Name | City | Holes | Booking URL/ID | Notes |
|---|---|---|---|---|
| Valleywood | Apple Valley | 18 | player.eagleclubsystems.online (mnvalleywood20250115) | *Favorite* |

---

## EZLinks

| Course Name | City | Holes | Booking URL | Notes |
|---|---|---|---|---|
| Heritage Links | Lakeville | 18 | bookteetimes.ezlinks.com/?1=heritagelinks | |

---

## City/Custom Booking Systems

Courses using their own municipal registration systems or other custom platforms.

| Course Name | City | Holes | Booking System | Notes |
|---|---|---|---|---|
| Birnamwood | Burnsville | 9 | City of Burnsville WebTrac / TeeMaster | Par 27; registration.burnsvillemn.gov |
| Mendota Heights Par 3 | Mendota Heights | 9 | City website (MendotaHeightsMN.gov/TeeTime) | Par 27; requires account |
| Island Lake | Shoreview | 9 | TeeMaster (teemaster.com) | Par 28 |

---

## Unknown / Needs Further Research

Courses where the primary direct booking platform could not be confirmed from web searches.

| Course Name | City | Holes | Known Aggregator Listings | Notes |
|---|---|---|---|---|
| Pinewood Golf Club | Elk River | 9 | GolfNow (16031) | Executive 9-hole |
| Brookland Golf Park | Brooklyn Park | 9 | GolfNow (16956) | Par 30; may be phone-only |
| U of M Les Bolstad | St. Paul | 18 | Chronogolf | **CLOSED after 2025 season** - land being sold |

> **Note:** Emerald Greens (Hastings) was previously listed here but uses ForeUp as its primary booking system (facility 19202).

---

## Courses Confirmed Closed / Not Available

| Course Name | City | Holes | Status |
|---|---|---|---|
| U of M Les Bolstad | St. Paul | 18 | Closed after 2025 season; university selling land |

---

## Platform Research Notes

### Platforms with known API access (from previous research)
- **CPS Golf:** Static x-apikey header, JSON TeeTimes endpoint, 5 req/sec rate limit
- **ForeUp:** Public API, `api_key=no_limits`, JSON array response
- **Baker National / Chronogolf:** Club ID 8320 -- not yet investigated for API
- **TeeItUp:** Not yet investigated for API
- **Eagle Club Systems:** Not yet investigated for API

### Platforms needing API investigation
- **Chronogolf/Lightspeed:** Largest group (~35 courses). High priority for API research.
- **TeeItUp:** 8 courses including Ramsey County. Medium priority.
- **Teesnap:** 2 courses. Adapter implemented.
- **MemberSports:** 1 course (River Oaks). Adapter implemented.
- **GolfNow:** 6 courses as primary. May require different approach (GolfNow is a marketplace).
- **EZLinks:** 1 course. Low priority.

### Aggregator vs. Primary Platform Ambiguity
Many courses appear on Chronogolf as a listing but may use a different system as their actual tee sheet. The Chronogolf listings above are best-effort based on web research. Where a course has a confirmed direct booking URL (e.g., `*.cps.golf`, `*.book.teeitup.com`, `*.teesnap.net`), that is listed as the primary platform even if Chronogolf also lists the course.
