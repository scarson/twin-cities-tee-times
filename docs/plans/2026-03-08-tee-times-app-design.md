# Twin Cities Tee Times — Design Document

**Date:** 2026-03-08
**Status:** Approved

## Purpose

Web app that aggregates public tee times across ~80 Twin Cities metro golf courses, letting users quickly find availability and link out to book on the course's own booking site.

## Users

- **Primary:** Father-in-law (avid golfer, 11 favorite courses)
- **Secondary:** Any Twin Cities public golfer

## Core Views

### Time-First View (Primary)

The default view. User selects a date and optional time window (e.g., "Saturday 7-10am"), and sees all available tee times across their favorited/selected courses sorted chronologically.

Each result shows:
- Course name
- Tee time
- Price (public rate)
- Holes (9 or 18)
- Open slots
- "Book" link → course's booking site (deep-linked to date where supported)

### Dashboard View (Secondary)

At-a-glance view of all favorited courses with their next 3 available times each. Answers "what's the landscape right now?" without needing to set filters. Each course card links to the full course drill-down.

### First-Time Experience

Before the user configures favorites, the dashboard shows a curated list of popular courses (the 11 father-in-law favorites as defaults) with a prompt to customize. The time-first view works with all courses until favorites are set.

### Empty States

When no tee times match the current filters, the UI suggests broadening the time window, trying a different date, or adding more courses to favorites.

### Course Drill-Down

Tap a course from either view to see all its available times for a given date.

## Data Fields Per Tee Time

| Field | Source | Notes |
|---|---|---|
| Time | Booking platform API | ISO 8601, converted to Central Time |
| Price | Booking platform API | Public rate only (not member rates) |
| Holes | Booking platform API | 9 or 18 |
| Open slots | Booking platform API | How many players can still join |

## Data Freshness

### Dynamic Polling Schedule

Polling frequency varies by time of day to balance freshness against the Cloudflare Workers free tier limit (100K requests/day). All times Central.

| Time Window | Interval | Rationale |
|---|---|---|
| 5am – 10am | Every 5 min | Peak booking window — golfers checking morning availability |
| 10am – 2pm | Every 10 min | Moderate activity |
| 2pm – 8pm | Every 15 min | Winding down |
| 8pm – 5am | Every 60 min | Near-zero booking activity |

**Implementation note:** Cloudflare Cron Triggers use cron expressions which can't express variable intervals natively. This is implemented as a single cron trigger firing every 5 minutes, with the handler checking the current Central Time hour and skipping the cycle if it's outside that window's interval (e.g., at 3pm, only execute every 3rd invocation for 15-min effective interval).

### Polling Date Range

Tee times are fetched for a **7-day rolling window** (today + next 6 days), matching the typical online booking horizon. However, not all days need the same polling frequency:

| Date Offset | Polling Frequency | Rationale |
|---|---|---|
| Today + Tomorrow | Same as time-of-day schedule above | High churn — times are being booked actively |
| Days 3–4 | Every 30 min (during 5am–8pm only) | Moderate churn |
| Days 5–7 | Twice daily (8am + 6pm) | Low churn — availability is relatively stable |

### Estimated Daily Usage

Assuming ~80 active courses during peak golf season:

| Date Tier | Courses | Requests/Cycle | Cycles/Day | Daily Requests |
|---|---|---|---|---|
| Today + Tomorrow | 80 × 2 = 160 | 160 | ~117 (weighted avg from time-of-day schedule) | ~18,720 |
| Days 3–4 | 80 × 2 = 160 | 160 | ~30 (every 30 min, 15 hrs) | ~4,800 |
| Days 5–7 | 80 × 3 = 240 | 240 | 2 | ~480 |
| **Total** | | | | **~24,000** |

That's ~24% of the free tier, leaving headroom for manual refreshes, on-demand fetches, CSRF token requests, and growth. During winter with most courses inactive, usage drops to near zero.

### Course Activity Detection

Each course has an `is_active` database flag. A lightweight check determines whether the course has any tee times available for upcoming dates. If a course returns no availability for consecutive checks (closed for season, maintenance, private events, etc.), polling is suspended and the flag is set to inactive. A low-frequency background check (e.g., daily) re-checks inactive courses and reactivates them when availability returns.

This handles seasonality (~April–November in MN), temporary closures, and weather cancellations without hardcoding dates.

### Manual Refresh

Users can trigger a "Refresh now" for a specific course. The result is cached for 30 seconds to prevent duplicate upstream calls if multiple users hit refresh simultaneously. The UI shows a "Last updated X ago" freshness indicator per course.

## Tech Stack

| Component | Choice | Rationale |
|---|---|---|
| Framework | Next.js (App Router) | Full-stack React, SSR/SSG, API routes |
| Hosting | Cloudflare Workers | Free tier: generous cron, fast cold starts, 5GB D1 |
| Database | Cloudflare D1 (SQLite) | Free 5GB, co-located with Workers, no connection pooling needed |
| Scheduling | Cloudflare Cron Triggers | Free, configurable intervals, drives polling schedule |
| Deployment | GitHub Actions → OpenNext → Cloudflare | Builds on Linux, avoids Windows OpenNext issues |
| Local dev | `next dev` on native Windows | Standard Next.js DX, no OpenNext needed locally |
| Adapter | OpenNext for Cloudflare | Transforms Next.js build output for Workers runtime |

### Why Cloudflare over Vercel

- **Cron Triggers:** Unlimited on free tier (Vercel free: 1/day)
- **D1 database:** 5GB free (Vercel Postgres: 256MB free)
- **Cold starts:** Faster on Workers
- **Cost:** Everything needed fits in free tier

### Deployment Model

Development happens with standard `next dev` on Windows. GitHub Actions runs the OpenNext build on Linux and deploys to Cloudflare Workers. The developer never interacts with OpenNext locally.

## Platform Adapters

Each booking platform gets an adapter that fetches tee times via plain HTTP requests. No headless browser needed for any platform.

### Adapter Interface

```typescript
interface CourseConfig {
  id: string;                    // e.g., "theodore-wirth-18"
  name: string;
  platform: string;              // e.g., "cps_golf"
  platformConfig: Record<string, string>; // Platform-specific IDs/keys
  bookingUrl: string;            // Base booking URL for deep-linking
}

interface PlatformAdapter {
  platformId: string;            // e.g., "cps_golf"
  fetchTeeTimes(config: CourseConfig, date: string): Promise<TeeTime[]>;
}

interface TeeTime {
  courseId: string;
  time: string;       // ISO 8601
  price: number | null;
  holes: 9 | 18;
  openSlots: number;
  bookingUrl: string; // Deep link with date pre-filled where possible
}
```

**Example `platformConfig` values:**
- CPS Golf: `{ subdomain: "minneapolistheodorewirth", apiKey: "8ea2914e-...", courseIds: "17", websiteId: "8265e495-..." }`
- ForeUp: `{ facilityId: "21445", scheduleId: "7829" }`
- TeeItUp: `{ alias: "ramsey-county-golf", facilityId: "17055", apiBaseUrl: "https://phx-api-be-east-1b.kenna.io" }`
- Eagle Club: `{ dbname: "mnvalleywood20250115" }`
- Chronogolf: `{ clubId: "8320", courseId: "9602" }`

### Platform Coverage

#### Confirmed APIs (5 platforms — covers all 11 favorites)

| Platform | Courses | Auth Model | API Style |
|---|---|---|---|
| CPS Golf (Club Prophet) | 14 | Static `x-apikey` header per facility | REST GET, JSON |
| ForeUp | 4 | None (`api_key=no_limits`) | REST GET, JSON |
| TeeItUp / Kenna | 8 | `x-be-alias` header per tenant | REST GET, JSON |
| Eagle Club Systems | 1 | None (`dbname` param) | REST POST, JSON |
| Chronogolf / Lightspeed | ~35 | `x-csrf-token` (session) | REST GET, JSON |

#### Future Platforms (for broader coverage)

| Platform | Courses | Status |
|---|---|---|
| GolfNow | 6 | Needs investigation |
| Teesnap | 3 | Needs investigation |
| EZLinks | 1 | Needs investigation |
| City/Custom systems | 3 | Case-by-case |

### Implementation Phases

Each phase is a vertical slice — backend + frontend + deployment for that scope.

1. **Phase 1 — Foundation + CPS Golf + ForeUp**
   - Next.js project scaffolding, Cloudflare Workers + D1 setup, GitHub Actions CI/CD pipeline
   - D1 schema creation and course catalog seed script
   - CPS Golf adapter + ForeUp adapter (covers 8 of 11 favorites)
   - Cron-based polling with dynamic schedule
   - Time-first view (primary UI) + course drill-down
   - Manual refresh + freshness indicators
   - Favorites (localStorage)
   - **Milestone:** Usable app with 8 courses, deployed to Cloudflare

2. **Phase 2 — TeeItUp + Eagle Club**
   - TeeItUp adapter (Keller) + Eagle Club adapter (Valleywood)
   - Dashboard view
   - **Milestone:** All 11 favorite courses working

3. **Phase 3 — Chronogolf + Polish**
   - Chronogolf adapter (Baker National + ~35 other courses — needs spring verification)
   - Course activity detection (is_active flag logic)
   - Remaining filters (holes, open slots)
   - **Milestone:** ~60 courses covered

4. **Phase 4 — Full Coverage**
   - GolfNow, Teesnap, EZLinks, city/custom adapters as needed
   - **Milestone:** All ~80 courses covered

## Data Model (D1/SQLite)

### courses

Static catalog of all supported courses.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | Stable identifier (e.g., "theodore-wirth-18") |
| name | TEXT | Display name |
| city | TEXT | City |
| platform | TEXT | cps_golf, foreup, teeitup, eagle_club, chronogolf |
| platform_config | TEXT (JSON) | Platform-specific IDs, keys, URLs |
| booking_url | TEXT | Base URL for the course's booking page |
| is_active | BOOLEAN | Whether the course currently has availability |
| last_active_check | TEXT | ISO timestamp of last activity check |

### tee_times

Cached tee time results. On each poll for a given course+date, all existing rows for that course+date are DELETEd and fresh results INSERTed in a single transaction. This is simpler than upserting and ensures stale times (already booked) are removed.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| course_id | TEXT FK | References courses.id |
| date | TEXT | YYYY-MM-DD |
| time | TEXT | HH:MM (local time) |
| price | REAL | Nullable — some platforms don't show price until login |
| holes | INTEGER | 9 or 18 |
| open_slots | INTEGER | Available player spots |
| booking_url | TEXT | Deep link with date pre-filled where possible |
| fetched_at | TEXT | ISO timestamp — drives "Last updated X ago" display |

**Index:** Composite index on `(course_id, date)` for efficient queries.

### poll_log

Tracks polling history per course for debugging and freshness display.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| course_id | TEXT FK | References courses.id |
| date | TEXT | YYYY-MM-DD — which date was polled (needed for per-date polling frequency) |
| polled_at | TEXT | ISO timestamp |
| status | TEXT | success, error, no_data |
| tee_time_count | INTEGER | Number of tee times found |
| error_message | TEXT | Nullable — for debugging failures |

**Retention:** Prune entries older than 7 days via a daily cleanup task.

## User Features

- **Favorites:** Stored in localStorage, no auth needed. Drives which courses appear in time-first and dashboard views.
- **Filters:** Date, time window, holes (9/18), min open slots.
- **Booking link:** Each tee time links to the course's booking site with date pre-filled where the platform supports it. UI clearly indicates this is a redirect (e.g., "Book at [Course Name] →") — the user completes the actual reservation on the course's site. Since tee times can be claimed between our last poll and the user clicking, the UI should set this expectation.
- **Freshness indicator:** Per-course "Last updated X ago" display so users can assess data staleness and decide whether to manually refresh.

## Database Seeding

The `courses` table is seeded from a JSON config file checked into the repo (`src/config/courses.json`). This file contains all course metadata including platform-specific config (API keys, subdomain, facility IDs, etc.). A seed script reads this file and populates D1. Adding or updating a course is a config change + re-seed, not a schema migration.

## Testing Strategy

- **Adapter unit tests:** Each platform adapter is tested against recorded API response fixtures (saved JSON files). This avoids hitting live APIs in CI and works year-round (including winter when courses return empty data).
- **Adapter integration tests (manual):** Run against live APIs during spring verification sprint (~April) to confirm fixtures match real responses. Record updated fixtures.
- **API route tests:** Test the Next.js API routes that serve tee time data to the frontend using the D1 test helpers.
- **No E2E browser tests for MVP.** The frontend is simple enough that manual testing suffices initially.

## Future Features (To Investigate)

- **Google OAuth login + cross-device favorites sync** — Let users sign in with Google to persist favorites server-side, accessible from any device
- **Saved filter defaults** — Per-user default time windows, date preferences (e.g., "always show 6-9am on weekends")
- **Price alerts** — Notify users when a favorited course has openings below a price threshold
- **Custom course groupings** — Named groups beyond a flat favorites list (e.g., "Weekday Spots", "Weekend with Dad")
- **Display preferences** — Default view (favorites vs. all), sort order, other UI personalization

## Explicitly Out of Scope

- Booking through the app (link-out only)
- Member rates (public rates only)
- Push notifications / PWA (architecture is PWA-friendly for later)
- Walking vs. riding info

## Known Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Booking platform API changes | Adapter breaks for affected courses | Per-platform adapter isolation; error logging; graceful degradation (show stale data + warning) |
| Chronogolf CSRF token enforcement | Can't fetch without a browser session | Pre-fetch widget page to obtain token; cache token; fall back to on-demand only |
| Rate limiting by platforms | Temporary blocks | Per-platform rate limiting in adapters; cache aggressively; back off on 429s |
| Bundle size exceeds 3MB Workers limit | Can't deploy | Monitor bundle size in CI; code-split aggressively; this app is simple enough that it's unlikely |
| Courses change booking platforms | Stale config | is_active flag + error monitoring surfaces these quickly; manual config update |
| Winter testing gap | Can't verify tee time response formats | Plan a verification sprint when courses open (~April); adapter tests use recorded fixtures |

## Research References

- `dev/research/booking-platform-investigation.md` — CPS Golf and ForeUp API deep-dive
- `dev/research/remaining-platforms-investigation.md` — Chronogolf, TeeItUp, Eagle Club API investigation
- `dev/research/favorite-courses-platforms.md` — Platform details for 11 favorite courses
- `dev/research/tc-courses-platforms.md` — All ~79 TC public courses by platform
