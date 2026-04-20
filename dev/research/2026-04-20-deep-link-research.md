# Deep-link Book button research — 2026-04-20 overnight

## Goal

Sam's feedback #1: clicking "Book" should deep-link to the specific tee time (date, time, hole count) rather than the booking site's landing page.

## Research methodology

Probe each platform's booking page without JS execution (curl + HTML grep) to see if URL query params or hash routes accept date parameters. Playwright MCP was unreliable in the prior session (browser-lock issues), so deferred live SPA testing to a future session.

## Findings by platform

### ForeUp — URL query params DO NOT deep-link to date

- **URL tested:** `https://foreupsoftware.com/index.php/booking/19348/1470?date=04-25-2026`
- **Result:** The page's embedded JS config (`DEFAULT_FILTER`) echoes `date: "04-20-2026"` (today) regardless of the `?date=` query param value.
- **Interpretation:** ForeUp's SPA seeds its own state from today's date at page-load time. It does NOT read the `?date=` query param. Any URL-level deep-link attempt is ignored.
- **Possible workarounds (not tested tonight):**
  - Hash-based routing (`#/date=...`) — requires live browser test.
  - A different URL path pattern like `/booking/{club}/{schedule}/{date}` — requires live browser test.
  - The `DEFAULT_FILTER` object accepts `time`, `holes`, `players`, `booking_class` keys at page-load — maybe one of those works as a query param. Not tested.

### CPS Golf — Angular SPA, no evidence of URL-based date deep-linking

- **URL tested:** `https://minneapolisgrossnational.cps.golf/onlineresweb/`
- **Interpretation:** Angular app with routes including `/search-teetime`, `/teetime`, `/my-reservation`. Internal state uses `searchDate: GetCurrentDateMidNight()` — seeded from today. No observed pattern of reading `date=` query params into router state.
- **Possible workarounds:** Route `/search-teetime?date=...` or `/search-teetime/{date}` — require live testing.

### Chronogolf — Fragment-based (`#teetimes`), unverified deep-linking

- **URL format:** `https://www.chronogolf.com/club/baker-national-golf-club#teetimes`
- **Not tested tonight.** Marketplace SPAs sometimes accept query params for date/players. Requires live browser test to confirm.

### TeeItUp — Already uses `?course=` for some tenants

- **URL format (Ramsey County):** `https://ramsey-county-golf.book.teeitup.com/?course=17055`
- Some tenants have course selector via query param. Whether the same SPA accepts `date=` or `time=` is untested.

### Teewire — URL already has per-course `cid=` param

- **URL format:** `https://teewire.app/inverwood/index.php?controller=FrontV2&action=load&cid=3&view=list`
- Structured query params suggest potential for `&date=` extension. Not tested.

### Teesnap, MemberSports, Eagle Club, GolfNow — not probed this session

## Conclusion

**All 7 adapters above are SPAs.** Without running real browser tests to verify what URL params the client-side JS actually reads, implementing URL deep-linking risks shipping broken links that look like they work but silently ignore our params.

**Deferred for a future session** where Playwright MCP is reliable, or where Sam can pair with the agent for rapid live testing. The research above is a starting point — the next session should:

1. Stand up Playwright browser tests targeting each platform.
2. For each platform, try: query params (date, time, holes), hash fragments, path segments.
3. Verify the UI actually selects the target date (not just that the URL loads).
4. Document per-platform capability matrix.
5. Implement `buildBookingUrl(teeTime)` adapter method ONLY for platforms with verified capability.
6. For SPAs that don't support deep-linking, keep the base URL (current behavior).

## Architectural choice (for the future implementation)

Two options surfaced from the handoff:

1. **Optional adapter method `buildBookingUrl(teeTime): string`** — default returns config's base URL; per-adapter overrides append deep-link params.
2. **Adapter writes deep-linked URL into each `TeeTime.bookingUrl`** — simpler integration, but loses the base URL fallback.

**Recommendation:** Option 1. Preserves the base URL option, cleaner separation of concerns, testable in isolation.

## Multi-hole click modal

Sam already agreed to a click-time modal when the user clicks Book on a multi-hole merged row (choose 9 or 18, then deep-link). This modal only adds value IF the deep-link actually varies by hole count. For platforms where the deep-link doesn't work at all, the modal is pointless — we just link to the base URL.

**Conclusion:** Build the modal AFTER per-platform deep-link verification is complete.
