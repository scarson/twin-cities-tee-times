// ABOUTME: Shared fee parser used by all platform adapters to normalize raw price strings.
// ABOUTME: Returns the positive price, or null when the fee is absent, unparseable, or non-positive.

/**
 * Parse a raw fee string into a positive price, or null.
 *
 * Adapters receive fees as strings (e.g. "45.00", "30.52") that may be empty,
 * absent, non-numeric ("N/A"), or a "0" placeholder a platform uses for
 * "price not published" (e.g. Eagle Club returns "0" when no rate class is
 * assigned to a slot). A non-positive fee is never a real green fee — golf is
 * not free — so it collapses to null (price unknown) rather than a misleading
 * $0.00. The tee-time record is still emitted by the caller; only the price is
 * unknown.
 *
 * Contract:
 *   - Returns the parsed number when it is finite and greater than 0.
 *   - Returns null for null/undefined, empty/whitespace, non-numeric, 0, or
 *     negative input.
 */
export function parsePositiveFee(fee: string | null | undefined): number | null {
  if (fee == null) return null;
  const n = parseFloat(fee);
  return Number.isNaN(n) || n <= 0 ? null : n;
}
