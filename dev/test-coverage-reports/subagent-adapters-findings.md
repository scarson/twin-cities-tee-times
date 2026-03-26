# Adapter Layer Test Coverage Report

**Files reviewed:** PRs 42 & 43 adapter changes
**Date:** 2026-03-25
**Reviewer:** Claude (automated coverage analysis)

---

## 1. `src/adapters/chronogolf.ts` (70 lines)

### `ChronogolfAdapter.fetchTeeTimes()` (lines 23–63)

| # | Code Path | Lines | Test? | Severity |
|---|-----------|-------|-------|----------|
| 1 | Missing `courseId` → throw | 30–32 | Covered ("throws when courseId is missing") | — |
| 2 | URL construction with params | 34–42 | Covered ("builds the correct API URL") | — |
| 3 | `AbortSignal.timeout(10000)` passed to fetch | 45 | GAP — no test verifies timeout option | nice-to-have |
| 4 | HTTP error → throw | 49–51 | Covered ("throws on HTTP error") | — |
| 5 | Network/fetch error → throw (propagation) | 44–47 | Covered ("throws on network error") | — |
| 6 | Successful parse with multiple tee times | 53–62 | Covered ("parses tee times from API response") | — |
| 7 | Empty teetimes array → empty result | 55 | Covered ("returns empty array when no tee times available") | — |
| 8 | `bookable_holes === 9` → holes = 9 | 59 | Covered ("uses bookable_holes from default_price for holes") | — |
| 9 | `bookable_holes !== 9` → holes = 18 | 59 | Covered (first fixture entry has bookable_holes=18) | — |
| 10 | `openSlots` from `max_player_size` | 60 | Covered ("uses max_player_size for openSlots") | — |
| 11 | `bookingUrl` from config | 61 | Covered (asserted in "parses tee times" test) | — |

### `ChronogolfAdapter.toIso()` (lines 66–69)

| # | Code Path | Lines | Test? | Severity |
|---|-----------|-------|-------|----------|
| 12 | Single-digit hour padded to 2 digits (e.g. "9:15" → "09:15") | 68 | Covered ("converts start_time to ISO local time") | — |
| 13 | Two-digit hour unchanged (e.g. "10:05") | 68 | Covered (second fixture entry) | — |

**Chronogolf summary:** 1 GAP (nice-to-have)

---

## 2. `src/adapters/eagle-club.ts` (108 lines)

### `EagleClubAdapter.fetchTeeTimes()` (lines 28–100)

| # | Code Path | Lines | Test? | Severity |
|---|-----------|-------|-------|----------|
| 1 | Missing `dbname` → throw | 35–37 | Covered ("throws when dbname is missing") | — |
| 2 | Date conversion `YYYY-MM-DD` → `YYYYMMDD` | 40 | Covered (POST body asserts `StrDate: "20260415"`) | — |
| 3 | POST body construction (BCC fields, StrTime, etc.) | 42–70 | Covered ("sends correct POST body with BCC and date") | — |
| 4 | `AbortSignal.timeout(10000)` passed to fetch | 76 | GAP — no test verifies timeout option | nice-to-have |
| 5 | HTTP error → throw | 79–81 | Covered ("throws on HTTP error") | — |
| 6 | Network/fetch error → throw (propagation) | 72–77 | Covered ("throws on network error") | — |
| 7 | `BoolSuccess === false` with `StrResult` non-empty → throw with StrResult | 85–88 | Covered ("throws on API-level error (BoolSuccess false)") | — |
| 8 | `BoolSuccess === false` with `StrResult` empty → throw with joined StrExceptions | 86 | GAP — test uses non-empty StrResult; the `StrExceptions.join("; ")` fallback is never exercised | correctness |
| 9 | Successful parse with multiple appointments | 90–99 | Covered ("parses tee times from API response") | — |
| 10 | Empty `LstAppointment` → empty result | 90 | Covered ("returns empty array when no appointments available") | — |
| 11 | `EighteenFee` valid numeric string → parseFloat | 93–95 | Covered ("uses EighteenFee as price") | — |
| 12 | `EighteenFee` empty string → null price | 93–95 | Covered ("returns null price when EighteenFee is empty") | — |
| 13 | `EighteenFee` is NaN string (e.g. "N/A") → null price | 93–94 | GAP — only empty string tested, not a non-numeric non-empty string | correctness |
| 14 | `holes` always 18 | 96 | Covered (asserted in parse test) | — |
| 15 | `openSlots` from `Slots` | 97 | Covered ("parses slots correctly") | — |
| 16 | `bookingUrl` from config | 98 | Covered (asserted in parse test) | — |

### `EagleClubAdapter.toIso()` (lines 103–107)

| # | Code Path | Lines | Test? | Severity |
|---|-----------|-------|-------|----------|
| 17 | "HHMM" → "HH:MM" conversion | 104–106 | Covered ("converts HHMM time to ISO 8601") | — |

**Eagle Club summary:** 3 GAPs (1 nice-to-have, 2 correctness)

---

## 3. `src/adapters/foreup.ts` (77 lines)

### `ForeUpAdapter.fetchTeeTimes()` (lines 18–71)

| # | Code Path | Lines | Test? | Severity |
|---|-----------|-------|-------|----------|
| 1 | Missing `scheduleId` → throw | 25–27 | Covered ("throws for courses with missing scheduleId") | — |
| 2 | Date format conversion `YYYY-MM-DD` → `MM-DD-YYYY` | 30–31 | Covered (URL test asserts `date=04-15-2026`) | — |
| 3 | URL construction with all params | 33–44 | Covered ("builds the correct API URL") | — |
| 4 | `AbortSignal.timeout(10000)` passed to fetch | 46 | GAP — no test verifies timeout option | nice-to-have |
| 5 | HTTP error → throw | 48–50 | Covered ("throws on non-200 response") | — |
| 6 | Network/fetch error → throw (propagation) | 46 | Covered ("throws on fetch error") | — |
| 7 | Malformed JSON → throw | 52 | Covered ("throws on malformed JSON response") | — |
| 8 | 429 rate-limit → throw | 48–50 | Covered ("throws on 429 rate-limited response") | — |
| 9 | `teesheet_side_name` AND `reround_teesheet_side_name` both truthy → nines set | 55–57 | Covered ("parses nines from teesheet_side_name fields") | — |
| 10 | `teesheet_side_name` null → nines omitted | 55–57 | Covered ("omits nines when teesheet_side_name is null") | — |
| 11 | `teesheet_side_name` truthy but `reround_teesheet_side_name` null/missing → nines omitted | 55 | GAP — only tested with both null; never tested with one truthy and one falsy | correctness |
| 12 | `green_fee` is null → price null | 62–64 | Covered ("handles null green_fee") | — |
| 13 | `green_fee` is valid numeric string → parseFloat | 62–64 | Covered (fixture has "45.00") | — |
| 14 | `green_fee` is non-numeric string → price null | 62–64 | Covered ("returns null price for non-numeric green_fee") | — |
| 15 | `holes === 9` → 9 | 65 | Covered (fixture[2] has holes=9) | — |
| 16 | `holes !== 9` → 18 | 65 | Covered (fixture[0] has holes=18) | — |
| 17 | `openSlots` from `available_spots` | 66 | Covered (asserted in parse test) | — |
| 18 | `bookingUrl` from config | 67 | Covered (asserted in parse test) | — |
| 19 | Empty array response → empty result | 52–54 | Covered (URL test uses empty array `[]`) | — |

### `ForeUpAdapter.toIso()` (lines 74–76)

| # | Code Path | Lines | Test? | Severity |
|---|-----------|-------|-------|----------|
| 20 | "YYYY-MM-DD HH:MM" → "YYYY-MM-DDTHH:MM:00" | 75 | Covered ("converts time string to ISO 8601") | — |

**ForeUp summary:** 2 GAPs (1 nice-to-have, 1 correctness)

---

## 4. `src/adapters/index.ts` (22 lines)

### `getAdapter()` (lines 20–22)

| # | Code Path | Lines | Test? | Severity |
|---|-----------|-------|-------|----------|
| 1 | Known platform "cps_golf" → returns CpsGolfAdapter | 21 | Covered | — |
| 2 | Known platform "foreup" → returns ForeUpAdapter | 21 | Covered | — |
| 3 | Known platform "teeitup" → returns TeeItUpAdapter | 21 | Covered | — |
| 4 | Known platform "chronogolf" → returns ChronogolfAdapter | 21 | Covered | — |
| 5 | Known platform "eagle_club" → returns EagleClubAdapter | 21 | GAP — no test for eagle_club lookup | correctness |
| 6 | Unknown platform → returns undefined | 21 | Covered ("returns undefined for unknown platform") | — |

**Index summary:** 1 GAP (correctness)

---

## Summary

| File | Paths Mapped | Covered | GAPs |
|------|-------------|---------|------|
| chronogolf.ts | 13 | 12 | 1 |
| eagle-club.ts | 17 | 14 | 3 |
| foreup.ts | 20 | 18 | 2 |
| index.ts | 6 | 5 | 1 |
| **Total** | **56** | **49** | **7** |

### GAP Severity Breakdown

| Severity | Count |
|----------|-------|
| security-critical | 0 |
| correctness | 4 |
| nice-to-have | 3 |

### All GAPs

| # | File | Gap | Severity |
|---|------|-----|----------|
| 1 | chronogolf.ts | `AbortSignal.timeout` not verified in fetch options | nice-to-have |
| 2 | eagle-club.ts | `AbortSignal.timeout` not verified in fetch options | nice-to-have |
| 3 | eagle-club.ts | `BoolSuccess=false` with empty `StrResult` → `StrExceptions.join()` fallback never exercised | correctness |
| 4 | eagle-club.ts | Non-numeric non-empty `EighteenFee` string (e.g. "N/A") → null price path never tested | correctness |
| 5 | foreup.ts | `AbortSignal.timeout` not verified in fetch options | nice-to-have |
| 6 | foreup.ts | Only one of `teesheet_side_name`/`reround_teesheet_side_name` truthy (asymmetric null) → nines omitted path never tested | correctness |
| 7 | index.ts | `getAdapter("eagle_club")` never tested — only 4 of 5 registered adapters have lookup tests | correctness |

### Depth Check

- chronogolf.ts: 70 lines → 13 paths (1 per 5.4 lines) — PASS
- eagle-club.ts: 108 lines → 17 paths (1 per 6.4 lines) — PASS
- foreup.ts: 77 lines → 20 paths (1 per 3.9 lines) — PASS
- index.ts: 22 lines → 6 paths (1 per 3.7 lines) — PASS
