# Deep-link Book button research — 2026-04-20 overnight

## Goal

Sam's feedback #1: clicking "Book" should deep-link to the specific tee time (date, time, hole count) rather than the booking site's landing page.

## Research methodology

Probe each platform's booking page without JS execution (curl + HTML grep) to see if URL query params or hash routes accept date parameters. Playwright MCP was unreliable in the prior session (browser-lock issues), so deferred live SPA testing to a future session.

## Findings by platform (live Playwright MCP verification)

Test protocol: today is 2026-04-20. Navigate to booking URL with a 5-day-out date (`2026-04-25`) in various param positions. Wait for SPA to settle. Inspect which date is marked `selected` in the rendered UI. If it shows 25 → deep-link works. If it shows 20 (today) → URL param is ignored.

### ForeUp — URL date params IGNORED (Playwright verified)

- **URL tested:** `https://foreupsoftware.com/index.php/booking/19348/1470?date=04-25-2026`
- **Result:** Page loads. JS config `DEFAULT_FILTER` object shows `date: "04-20-2026"` (today) regardless of the `?date=` query param value. Tried MM-DD-YYYY and YYYY-MM-DD. Same result.
- **Additional finding:** the page's initial route after load is `#/account/passes`, redirected to by the SPA — which requires manual navigation to `#/teetimes` to see the booking view. Even then, a Terms acceptance + course+player-type selection blocks the date picker. The app isn't designed to skip those steps.
- **Conclusion:** URL date deep-linking doesn't work for ForeUp.

### CPS Golf — URL date params IGNORED (Playwright verified)

- **URL tested:** `https://jcgsc5.cps.golf/onlineresweb/search-teetime?selectedDate=2026-04-25` and `...?searchDate=2026-04-25T00:00:00`
- **Result:** The SPA preserves the query param in the URL bar and APPENDS additional internal params (`TeeOffTimeMin=0&TeeOffTimeMax=23.999...`) — so the app DOES process the URL — but the selected day in the rendered calendar is still `20` (today), not `25`. Same for `searchDate` param name.
- **Bundle inspection:** Grepped the compiled Angular bundle (`main.dba5dcda6145225d.js`) for `queryParamMap.get(...)` calls. Only matches: `Affiliate`, `Location`, `returnUrl`, `scope`, `state`, `nonce` — all auth/routing concerns, no date-related keys. The `searchDate` state field IS present in the SPA model, but populated by `GetCurrentDateMidNight()` at init, not read from the URL.
- **Conclusion:** URL date deep-linking doesn't work for CPS Golf. The URL is a state sink (app writes to it after user interaction) but not a state source on load.

### Chronogolf — URL date params don't affect initial state (Playwright verified)

- **URL tested:** `https://www.chronogolf.com/club/baker-national-golf-club?date=2026-04-25#teetimes`
- **Result:** `#teetimes` fragment stripped silently. The visible page is a marketing landing with "Book your round" CTA; no date-picker is rendered on the landing page itself. Any deep-link would need to target the booking widget URL (likely `/app.chronogolf.com/...` or similar), not the public marketing page.
- **Conclusion:** The marketing page shape means date params at this URL don't help. Would need to research Chronogolf's actual booking widget URL to make any progress, and even then likely hits the same SPA-state-from-API pattern.

### TeeItUp, Teewire, Teesnap, MemberSports, Eagle Club — not tested (pattern extrapolated)

Three consecutive platform verifications (ForeUp, CPS Golf, Chronogolf) all confirmed the same pattern: the booking page is a SPA that seeds its state from today's date and/or from an API call at load, ignoring any URL date param. Testing the remaining 5 platforms is likely to repeat the pattern.

## Conclusion (updated)

**URL-based deep-link Book buttons are not feasible for these platforms.** Every modern tee time booking SPA works the same way:

1. Landing page loads.
2. JS reads current time + defaults, calls platform API, fetches today's tee times.
3. User clicks date picker to navigate to a different day. Then a second API call fires.
4. The URL bar MAY reflect post-selection state (CPS Golf does this). It's never a state source on load.

**Why this is fundamental, not a quirk:** SPA booking widgets need live data keyed by date, which requires an authenticated API call. The URL as a state source would bypass authentication/validation. Even platforms that serialize date to URL for sharing typically also run a full auth+data-fetch cycle on load that overwrites any URL-provided state.

## Alternative implementations tested

### POST form submission (tested 2026-04-20, does NOT work for ForeUp)

Sam's idea: instead of a GET link, use an HTML `<form method="POST" target="_self">` with hidden inputs for date/time/holes. Browser form submissions are treated as top-level navigations (no CORS gating) and a PHP backend COULD theoretically read `$_POST['date']` and bake it into the inline `DEFAULT_FILTER` JS object.

**Test via Playwright:** Created a form with action=`https://foreupsoftware.com/index.php/booking/19348/1470`, submitted with `date: "04-25-2026"` + `holes: "18"` + `time: "all"` + `schedule_id` + `course_id`. Server returned a normal-looking booking page, but `DEFAULT_FILTER` still echoed `date: "04-20-2026"` (today). **ForeUp's server-side code ignores POST body for date seeding.**

**Also tested:** `https://foreupsoftware.com/index.php/booking/19348/1470/04-25-2026` path-segment variant → 404. ForeUp's URL structure is strict `/booking/{club}/{schedule}`, no date segment accepted.

**Verdict on POST approach:** Doesn't help unless a specific platform demonstrates POST-based prefill. None tested so far. The only remaining POST-based hope would be an officially-documented booking partner API endpoint — which none of these platforms expose publicly.

## Alternative implementations that WOULD work (for future exploration)

- **Platform-partner API (hypothetical):** requires a business relationship with each booking platform.
- **Chrome extension / browser helper:** Out of scope.
- **In-app booking flow:** We'd need contract agreements with each platform. Massively out of scope.
- **Add informational note on our app:** "Click Book → on the booking site, manually select `Apr 25, 8:00 AM, 18 holes`." Helps the user not forget what they clicked, but doesn't actually deep-link. LOW-EFFORT IMPROVEMENT; consider for a future PR.

## Decision

Deep-link Book buttons are **removed from the overnight scope**. Logged as D-10 in the decision log. The informational-note idea above is captured as a possible future enhancement.

## If a future session revisits this

1. Read this file first — the conclusions are durable.
2. If a new platform is added to the catalog, quickly Playwright-probe it before adding to this list.
3. If a platform updates its SPA to be URL-driven, they'll almost certainly announce a booking partner API — go through official channels.

## Architectural choice (for the future implementation)

Two options surfaced from the handoff:

1. **Optional adapter method `buildBookingUrl(teeTime): string`** — default returns config's base URL; per-adapter overrides append deep-link params.
2. **Adapter writes deep-linked URL into each `TeeTime.bookingUrl`** — simpler integration, but loses the base URL fallback.

**Recommendation:** Option 1. Preserves the base URL option, cleaner separation of concerns, testable in isolation.

## Multi-hole click modal

Sam already agreed to a click-time modal when the user clicks Book on a multi-hole merged row (choose 9 or 18, then deep-link). This modal only adds value IF the deep-link actually varies by hole count. For platforms where the deep-link doesn't work at all, the modal is pointless — we just link to the base URL.

**Conclusion:** Build the modal AFTER per-platform deep-link verification is complete.
