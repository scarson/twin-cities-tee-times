// @vitest-environment jsdom
// ABOUTME: Tests for the mergeHoleVariants display helper.
// ABOUTME: Verifies sibling rows at same (course, date, time) collapse into one display card.
import { describe, it, expect } from "vitest";
import { mergeHoleVariants } from "./merge-hole-variants";
import type { TeeTimeItem } from "./tee-time-list";

function makeItem(overrides: Partial<TeeTimeItem> = {}): TeeTimeItem {
  return {
    course_id: "test-course",
    course_name: "Test Course",
    course_city: "Minneapolis",
    date: "2026-04-15",
    time: "08:00",
    price: 45.0,
    holes: 18,
    open_slots: 4,
    booking_url: "https://example.com",
    fetched_at: new Date().toISOString(),
    nines: null,
    ...overrides,
  };
}

describe("mergeHoleVariants", () => {
  it("returns empty array for empty input", () => {
    expect(mergeHoleVariants([])).toEqual([]);
  });

  it("passes a single solo row through with labels populated", () => {
    const out = mergeHoleVariants([makeItem({ holes: 18, price: 45 })]);
    expect(out).toHaveLength(1);
    expect(out[0].holesLabel).toBe("18 holes");
    expect(out[0].priceLabel).toBe("$45.00");
  });

  it("populates priceLabel as null when solo row has null price", () => {
    const out = mergeHoleVariants([makeItem({ price: null })]);
    expect(out[0].priceLabel).toBeNull();
  });

  it("merges two rows with same (course, date, time) and different holes", () => {
    const out = mergeHoleVariants([
      makeItem({ holes: 9, price: 30 }),
      makeItem({ holes: 18, price: 55 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].holesLabel).toBe("9 / 18 holes");
    expect(out[0].priceLabel).toBe("$30.00 / $55.00");
  });

  it("shows only the non-null price when one side is null", () => {
    const out = mergeHoleVariants([
      makeItem({ holes: 9, price: null }),
      makeItem({ holes: 18, price: 55 }),
    ]);
    expect(out[0].holesLabel).toBe("9 / 18 holes");
    expect(out[0].priceLabel).toBe("$55.00");
  });

  it("returns null priceLabel when all variants have null price", () => {
    const out = mergeHoleVariants([
      makeItem({ holes: 9, price: null }),
      makeItem({ holes: 18, price: null }),
    ]);
    expect(out[0].priceLabel).toBeNull();
  });

  it("uses the minimum open_slots across merged variants", () => {
    const out = mergeHoleVariants([
      makeItem({ holes: 9, open_slots: 4 }),
      makeItem({ holes: 18, open_slots: 2 }),
    ]);
    expect(out[0].open_slots).toBe(2);
  });

  it("preserves a single non-null nines across the pair", () => {
    const out = mergeHoleVariants([
      makeItem({ holes: 9, nines: null }),
      makeItem({ holes: 18, nines: "East/West" }),
    ]);
    expect(out[0].nines).toBe("East/West");
  });

  it("comma-joins distinct nines values", () => {
    const out = mergeHoleVariants([
      makeItem({ holes: 9, nines: "East/West" }),
      makeItem({ holes: 18, nines: "South/North" }),
    ]);
    expect(out[0].nines).toBe("East/West, South/North");
  });

  it("merges three rows at same key into a three-way label", () => {
    // TeeTimeItem.holes is typed as `number` so 27 is legal at compile time.
    const out = mergeHoleVariants([
      makeItem({ holes: 9, price: 10 }),
      makeItem({ holes: 18, price: 20 }),
      makeItem({ holes: 27, price: 30 }),
    ]);
    expect(out[0].holesLabel).toBe("9 / 18 / 27 holes");
    expect(out[0].priceLabel).toBe("$10.00 / $20.00 / $30.00");
  });

  it("does NOT merge rows with same (course, time) but different date", () => {
    const out = mergeHoleVariants([
      makeItem({ date: "2026-04-15", holes: 9 }),
      makeItem({ date: "2026-04-16", holes: 18 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("does NOT merge rows with same (date, time) but different course_id", () => {
    const out = mergeHoleVariants([
      makeItem({ course_id: "a", holes: 9 }),
      makeItem({ course_id: "b", holes: 18 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("preserves input order for groups (first-seen wins)", () => {
    const out = mergeHoleVariants([
      makeItem({ course_id: "b", holes: 18 }),
      makeItem({ course_id: "a", holes: 9 }),
      makeItem({ course_id: "a", holes: 18 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].course_id).toBe("b");
    expect(out[1].course_id).toBe("a");
  });
});
