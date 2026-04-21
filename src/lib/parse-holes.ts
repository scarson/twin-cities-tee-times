// ABOUTME: Shared hole-count classifier used by all platform adapters.
// ABOUTME: Never silently coerces unknowns — returns null so callers can log and skip.

/**
 * Classify a single hole-count hint into 9, 18, or null.
 *
 * Adapters receive hole hints in many shapes: numbers (9, 18), numeric
 * strings ("9", "18"), qualified SKU codes ("GreenFee18Online"), or word
 * enums ("EIGHTEEN_HOLE"). Historically each adapter hand-rolled its own
 * decoder, and exact-match equality repeatedly missed qualified variants
 * (see the Phalen/Como "GreenFee18Online" incident).
 *
 * Contract:
 *   - Returns 9 or 18 when the hint is unambiguously classifiable.
 *   - Returns null for ambiguous ("9/18"), unknown ("CartFee"), or
 *     unsupported (27, 36) hints. Callers should log and skip null.
 *   - Never silently coerces to 18.
 */
export function classifyHoles(hint: unknown): 9 | 18 | null {
  if (typeof hint === "number") {
    if (!Number.isFinite(hint)) return null;
    return hint === 9 ? 9 : hint === 18 ? 18 : null;
  }

  if (typeof hint !== "string") return null;

  const s = hint.trim();
  if (s === "") return null;

  // Digit-group classification: "GreenFee18Online" → [18], "9/18" → [9, 18]
  const digitGroups = [...s.matchAll(/\d+/g)]
    .map((m) => parseInt(m[0], 10))
    .filter((n) => n === 9 || n === 18);
  const has9 = digitGroups.includes(9);
  const has18 = digitGroups.includes(18);
  if (has9 && has18) return null; // ambiguous — use parseHoleVariants
  if (has18) return 18;
  if (has9) return 9;

  // Word-level fallback for enums like "EIGHTEEN_HOLE" / "NINE_HOLE".
  // Uses explicit non-letter boundaries because \b treats `_` as a word
  // character (so \b would not split "EIGHTEEN_HOLE"). Also avoids false
  // matches on "nineteen" / "ninety".
  const lower = s.toLowerCase();
  if (/(?:^|[^a-z])eighteen(?:[^a-z]|$)/.test(lower)) return 18;
  if (/(?:^|[^a-z])nine(?:[^a-z]|$)/.test(lower)) return 9;

  return null;
}

/**
 * Expand a hole-count hint into one or more supported variants.
 *
 * Unlike `classifyHoles`, this handles compound/list inputs:
 *   - `[9, 18]` → [9, 18] (Chronogolf course.bookable_holes)
 *   - `"9/18"`, `"9,18"` → [9, 18] (ForeUp)
 *   - Single-variant inputs collapse to `[classifyHoles(hint)]`.
 *   - Unknown inputs return `[]` (empty — caller should log and skip).
 */
export function parseHoleVariants(hint: unknown): (9 | 18)[] {
  if (Array.isArray(hint)) {
    const out: (9 | 18)[] = [];
    for (const v of hint) {
      const c = classifyHoles(v);
      if (c !== null && !out.includes(c)) out.push(c);
    }
    return out;
  }

  if (typeof hint === "string") {
    const digitGroups = [...hint.matchAll(/\d+/g)]
      .map((m) => parseInt(m[0], 10))
      .filter((n) => n === 9 || n === 18);
    if (digitGroups.includes(9) && digitGroups.includes(18)) return [9, 18];
  }

  const single = classifyHoles(hint);
  return single === null ? [] : [single];
}
