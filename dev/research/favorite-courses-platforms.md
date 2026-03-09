# Twin Cities Golf Course Booking Platforms Research

Research conducted: 2026-03-08

## Summary

| # | Course | Platform | Booking URL |
|---|--------|----------|-------------|
| 1 | Baker National | Chronogolf/Lightspeed | chronogolf.com/club/8320 (widget on threeriversparks.org) |
| 2 | Braemar | ForeUp | foreupsoftware.com/index.php/booking/21445/7829 |
| 3 | Gross National | CPS Golf (Club Prophet) | minneapolisgrossnational.cps.golf |
| 4 | Meadowbrook | CPS Golf (Club Prophet) | minneapolismeadowbrook.cps.golf |
| 5 | Columbia | CPS Golf (Club Prophet) | minneapoliscolumbia.cps.golf |
| 6 | Keller | TeeItUp | ramsey-county-golf.book.teeitup.com/?course=17055 |
| 7 | Phalen | CPS Golf (Club Prophet) | phalen.cps.golf |
| 8 | Bunker Hills | ForeUp | foreupsoftware.com/index.php/booking/20252 |
| 9 | Chaska Town Course | CPS Golf (Club Prophet) | chaska.cps.golf |
| 10 | Valleywood | Eagle Club Systems | player.eagleclubsystems.online/#/tee-slot?dbname=mnvalleywood20250115 |
| 11 | Theodore Wirth | CPS Golf (Club Prophet) | minneapolistheodorewirth.cps.golf |

## Platform Breakdown

- **CPS Golf (Club Prophet Systems):** 6 courses (Gross National, Meadowbrook, Columbia, Phalen, Chaska Town Course, Theodore Wirth)
- **ForeUp:** 2 courses (Braemar, Bunker Hills)
- **Chronogolf/Lightspeed:** 1 course (Baker National)
- **TeeItUp:** 1 course (Keller)
- **Eagle Club Systems:** 1 course (Valleywood)

---

## Detailed Findings

### 1. Baker National Golf Course
- **Location:** 2935 Parkview Dr, Medina, MN 55340
- **Operator:** Three Rivers Park District
- **Platform:** Chronogolf / Lightspeed
- **Chronogolf Club ID:** 8320
- **Chronogolf slug:** baker-national-golf-club
- **Booking URL:** https://chronogolf.com/club/8320
- **Website:** https://www.threeriversparks.org/location/baker-national-golf
- **Notes:** The Chronogolf widget is embedded on the Three Rivers Parks website. The Chronogolf marketplace page (chronogolf.com/club/baker-national-golf-club) shows "Contact the course directly" but the actual widget (club ID 8320) is functional for booking. The course has both a Championship 18-hole and Evergreen 9-hole executive course. Uses Noteefy for virtual tee time waitlist (bakernational.noteefy.app).

### 2. Braemar Golf Course
- **Location:** 6364 John Harris Dr, Edina, MN 55439
- **Operator:** City of Edina
- **Platform:** ForeUp
- **ForeUp facility_id:** 21445
- **ForeUp schedule_id:** 7829 (Championship 18)
- **Booking URL:** https://foreupsoftware.com/index.php/booking/21445/7829
- **Website:** https://braemargolf.com/
- **Notes:** Two facilities available in ForeUp dropdown: "Academy 9" and "Championship 18". Player types include Daily Fee, Daily Fee Senior, and various Player's Club tiers (Platinum, Gold, Silver). Braemar Golf Dome (simulator facility) has a separate ForeUp booking: facility_id=21475, schedule_id=7885. Uses Noteefy for waitlist (braemargolf.noteefy.app).

### 3. Francis A. Gross Golf Club (Gross National)
- **Location:** 2201 Saint Anthony Blvd, Minneapolis, MN 55418
- **Operator:** Minneapolis Park & Recreation Board
- **Platform:** CPS Golf (Club Prophet Systems)
- **CPS subdomain:** minneapolisgrossnational
- **Booking URL:** https://minneapolisgrossnational.cps.golf/onlineresweb/search-teetime
- **Website:** https://www.minneapolisparks.org/golf/courses/francis-a-gross_golf_club/
- **Notes:** 18-hole course. Has a Chronogolf listing page but it just says "Contact the course directly" -- actual booking is through CPS. Also listed on GolfNow (facility ID 18121).

### 4. Meadowbrook Golf Course
- **Location:** 201 Meadowbrook Rd, Hopkins, MN 55343
- **Operator:** Minneapolis Park & Recreation Board
- **Platform:** CPS Golf (Club Prophet Systems)
- **CPS subdomain:** minneapolismeadowbrook
- **Booking URL:** https://minneapolismeadowbrook.cps.golf/onlineresweb/search-teetime
- **Website:** https://www.minneapolisparks.org/golf/courses/meadowbrook_golf_club/
- **Notes:** 18-hole course, established 1926. Has a Chronogolf listing page but actual booking is through CPS. Also listed on GolfNow (facility ID 18117).

### 5. Columbia Golf Club
- **Location:** 3300 Central Ave NE, Minneapolis, MN 55418
- **Operator:** Minneapolis Park & Recreation Board
- **Platform:** CPS Golf (Club Prophet Systems)
- **CPS subdomain:** minneapoliscolumbia
- **Booking URL:** https://minneapoliscolumbia.cps.golf/onlineresweb/search-teetime
- **Website:** https://www.minneapolisparks.org/golf/courses/columbia_golf_club/
- **Notes:** 18-hole course, par 70, 6,229 yards. Has a Chronogolf listing page but actual booking is through CPS.

### 6. Keller Golf Course
- **Location:** 2166 Maplewood Dr, Maplewood, MN 55109
- **Operator:** Ramsey County
- **Platform:** TeeItUp
- **TeeItUp tenant:** ramsey-county-golf
- **TeeItUp course ID:** 17055
- **Booking URL:** https://ramsey-county-golf.book.teeitup.com/?course=17055
- **Website:** https://www.ramseycountymn.gov/residents/parks-recreation/golf/golf-courses/keller-golf-course
- **Notes:** Championship course opened in 1929. Ramsey County also operates Manitou Ridge (TeeItUp course ID 17056) on the same TeeItUp tenant. Book a Tee Time page: https://www.ramseycountymn.gov/residents/parks-recreation/golf/book-tee-time

### 7. Phalen Golf Course
- **Location:** 1615 Phalen Dr, St. Paul, MN 55106
- **Operator:** City of St. Paul (stpaul.golf)
- **Platform:** CPS Golf (Club Prophet Systems)
- **CPS subdomain:** phalen
- **Booking URL:** https://phalen.cps.golf/onlineresweb/search-teetime
- **Website:** https://www.stpaul.golf/phalen-park-gc
- **Notes:** 18-hole course, par 70, 6,100 yards. Has a Chronogolf listing page (chronogolf.com/club/phalen-park-golf-course) but actual booking is through CPS. Tee times also accessible via https://www.stpaul.golf/tee-times.

### 8. Bunker Hills Golf Club
- **Location:** 12800 Bunker Prairie Rd NW, Coon Rapids, MN 55448
- **Operator:** Anoka County (privately managed)
- **Platform:** ForeUp
- **ForeUp facility_id:** 20252
- **ForeUp schedule_id:** (not specified in main URL; uses default)
- **Booking URL:** https://foreupsoftware.com/index.php/booking/20252#/teetimes
- **Store URL:** https://foreupsoftware.com/index.php/booking/20252/4106#/store
- **Simulator booking:** https://foreupsoftware.com/index.php/booking/20312/4237#teetimes
- **Website:** https://bunkerhillsgolf.com/
- **Notes:** 27-hole championship course (North/East/West nines) plus executive 9. Website designed and hosted by foreUP. Has a Chronogolf listing but it just says "Contact the course directly" -- not an active Chronogolf booking. Course also has a simulator center with separate ForeUp facility (20312).

### 9. Chaska Town Course
- **Location:** 3000 Town Course Dr, Chaska, MN 55318
- **Operator:** City of Chaska
- **Platform:** CPS Golf (Club Prophet Systems)
- **CPS subdomain:** chaska
- **Booking URL:** https://chaska.cps.golf/onlineresweb/search-teetime
- **Website:** https://www.chaskatowncourse.com/
- **Tee times page:** https://www.chaskatowncourse.com/bookteetimes
- **Notes:** The CPS Golf booking is embedded as an iframe on the Chaska Town Course website's tee times page. Has a Chronogolf listing (chronogolf.com/club/chaska-town-course) but the actual booking engine is CPS. Designed by Arthur Hills, 285 acres. Also listed on GolfNow (facility ID 15272). Reservations up to 10 days in advance online, 7 days by phone.

### 10. Valleywood Golf Course
- **Location:** 4851 McAndrews Rd, Apple Valley, MN 55124
- **Operator:** City of Apple Valley
- **Platform:** Eagle Club Systems
- **Eagle Club dbname:** mnvalleywood20250115
- **Booking URL:** https://player.eagleclubsystems.online/#/tee-slot?dbname=mnvalleywood20250115
- **Website:** https://www.valleywoodgolf.com/
- **Tee times page:** https://www.valleywoodgolf.com/golf/tee-times
- **Notes:** 18-hole, par 71, 6,407 yards. Has a Chronogolf listing (chronogolf.com/club/valleywood-golf-course) but the actual booking link on their website goes to Eagle Club Systems. The dbname parameter may change (contains what appears to be a date stamp). Season: April 1 - November 1.

### 11. Theodore Wirth Golf Course
- **Location:** 1301 Theodore Wirth Pkwy, Minneapolis, MN 55422
- **Operator:** Minneapolis Park & Recreation Board
- **Platform:** CPS Golf (Club Prophet Systems)
- **CPS subdomain:** minneapolistheodorewirth (18-hole course)
- **CPS subdomain (Par 3):** minneapolistwpar3
- **Booking URL (18-hole):** https://minneapolistheodorewirth.cps.golf/onlineresweb/search-teetime
- **Booking URL (Par 3):** https://minneapolistwpar3.cps.golf/onlineresweb/search-teetime
- **Website:** https://www.minneapolisparks.org/golf/courses/theodore_wirth_golf_club/
- **Notes:** Minnesota's most historic public golf course. Has both an 18-hole course and a separate 9-hole Par 3 course, each with its own CPS subdomain.

---

## CPS Golf URL Pattern

All CPS Golf courses follow this pattern:
- **Base URL:** `https://{subdomain}.cps.golf/`
- **Tee time search:** `https://{subdomain}.cps.golf/onlineresweb/search-teetime`
- **Group booking:** `https://{subdomain}.cps.golf/onlineresweb/teetime/group-booking`

CPS subdomains found:
| Course | Subdomain |
|--------|-----------|
| Gross National | minneapolisgrossnational |
| Meadowbrook | minneapolismeadowbrook |
| Columbia | minneapoliscolumbia |
| Theodore Wirth (18) | minneapolistheodorewirth |
| Theodore Wirth (Par 3) | minneapolistwpar3 |
| Phalen | phalen |
| Chaska Town Course | chaska |

## ForeUp URL Pattern

ForeUp courses follow this pattern:
- **Base URL:** `https://foreupsoftware.com/index.php/booking/{facility_id}/{schedule_id}`
- The schedule_id is optional (defaults to first available)

ForeUp identifiers found:
| Course | facility_id | schedule_id |
|--------|-------------|-------------|
| Braemar (Championship 18) | 21445 | 7829 |
| Braemar (Golf Dome) | 21475 | 7885 |
| Bunker Hills | 20252 | (default) |
| Bunker Hills (Store) | 20252 | 4106 |
| Bunker Hills (Simulators) | 20312 | 4237 |

## TeeItUp URL Pattern

- **Base URL:** `https://{tenant}.book.teeitup.com/?course={course_id}`

| Course | Tenant | Course ID |
|--------|--------|-----------|
| Keller | ramsey-county-golf | 17055 |

## Eagle Club Systems URL Pattern

- **Base URL:** `https://player.eagleclubsystems.online/#/tee-slot?dbname={dbname}`

| Course | dbname |
|--------|--------|
| Valleywood | mnvalleywood20250115 |

## Notes on Chronogolf Listings

Many courses have Chronogolf/Lightspeed marketplace listing pages (chronogolf.com/club/{slug}) even though they do NOT use Chronogolf as their booking platform. These listing pages show "Contact the course directly" instead of an active booking widget. Only Baker National appears to use Chronogolf as its actual booking engine (via the embedded widget with club ID 8320 on the Three Rivers Parks website).
