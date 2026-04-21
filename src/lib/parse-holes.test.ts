// ABOUTME: Tests for the shared hole-classification helper used by all adapters.
// ABOUTME: Covers numeric, string, enum, and qualified-SKU hints.
import { describe, it, expect } from "vitest";
import { classifyHoles, parseHoleVariants } from "./parse-holes";

describe("classifyHoles", () => {
  describe("number inputs", () => {
    it("classifies 9 as 9", () => {
      expect(classifyHoles(9)).toBe(9);
    });
    it("classifies 18 as 18", () => {
      expect(classifyHoles(18)).toBe(18);
    });
    it("returns null for 27, 36, and other non-9/18 hole counts", () => {
      expect(classifyHoles(27)).toBeNull();
      expect(classifyHoles(36)).toBeNull();
      expect(classifyHoles(0)).toBeNull();
    });
    it("returns null for NaN and Infinity", () => {
      expect(classifyHoles(NaN)).toBeNull();
      expect(classifyHoles(Infinity)).toBeNull();
    });
  });

  describe("numeric string inputs", () => {
    it("classifies '9' and '18'", () => {
      expect(classifyHoles("9")).toBe(9);
      expect(classifyHoles("18")).toBe(18);
    });
    it("handles whitespace and mixed-case", () => {
      expect(classifyHoles(" 18 ")).toBe(18);
    });
  });

  describe("qualified SKU strings (CPS Golf)", () => {
    it("classifies 'GreenFee18' as 18", () => {
      expect(classifyHoles("GreenFee18")).toBe(18);
    });
    it("classifies 'GreenFee18Online' (Phalen/Como) as 18", () => {
      expect(classifyHoles("GreenFee18Online")).toBe(18);
    });
    it("classifies 'GreenFee9' as 9", () => {
      expect(classifyHoles("GreenFee9")).toBe(9);
    });
    it("classifies 'GreenFee9Online' as 9", () => {
      expect(classifyHoles("GreenFee9Online")).toBe(9);
    });
  });

  describe("word-level enum strings (Teesnap)", () => {
    it("classifies 'EIGHTEEN_HOLE' as 18", () => {
      expect(classifyHoles("EIGHTEEN_HOLE")).toBe(18);
    });
    it("classifies 'NINE_HOLE' as 9", () => {
      expect(classifyHoles("NINE_HOLE")).toBe(9);
    });
    it("classifies qualified variants like 'EIGHTEEN_HOLE_ONLINE' as 18", () => {
      expect(classifyHoles("EIGHTEEN_HOLE_ONLINE")).toBe(18);
    });
    it("is case-insensitive", () => {
      expect(classifyHoles("eighteen_hole")).toBe(18);
      expect(classifyHoles("Eighteen Holes")).toBe(18);
    });
  });

  describe("ambiguous and unknown inputs", () => {
    it("returns null for compound strings like '9/18' (caller should use parseHoleVariants)", () => {
      expect(classifyHoles("9/18")).toBeNull();
    });
    it("returns null for empty, null, undefined", () => {
      expect(classifyHoles("")).toBeNull();
      expect(classifyHoles(null)).toBeNull();
      expect(classifyHoles(undefined)).toBeNull();
    });
    it("returns null for strings with no 9/18 signal", () => {
      expect(classifyHoles("CartFee")).toBeNull();
      expect(classifyHoles("TWENTY_SEVEN_HOLE")).toBeNull();
    });
    it("returns null for objects, arrays, booleans", () => {
      expect(classifyHoles({})).toBeNull();
      expect(classifyHoles([9])).toBeNull();
      expect(classifyHoles(true)).toBeNull();
    });
  });

  describe("digit boundary safety", () => {
    it("does not match '180' as 18", () => {
      expect(classifyHoles("GreenFee180")).toBeNull();
    });
    it("does not match '91' as 9", () => {
      expect(classifyHoles("GreenFee91")).toBeNull();
    });
    it("does not match '189' as 18 (ambiguous — contains both 9 and 18 substrings)", () => {
      // 189 is not 9 nor 18; classifier should return null, not silently pick one.
      expect(classifyHoles("GreenFee189")).toBeNull();
    });
  });
});

describe("parseHoleVariants", () => {
  it("returns [9] for hint 9", () => {
    expect(parseHoleVariants(9)).toEqual([9]);
  });
  it("returns [18] for hint 18", () => {
    expect(parseHoleVariants(18)).toEqual([18]);
  });
  it("returns [9, 18] for compound string '9/18' (ForeUp)", () => {
    expect(parseHoleVariants("9/18")).toEqual([9, 18]);
  });
  it("returns [9, 18] for compound string '9,18'", () => {
    expect(parseHoleVariants("9,18")).toEqual([9, 18]);
  });
  it("returns [9, 18] for array input [9, 18] (Chronogolf)", () => {
    expect(parseHoleVariants([9, 18])).toEqual([9, 18]);
  });
  it("returns [18] for array [18]", () => {
    expect(parseHoleVariants([18])).toEqual([18]);
  });
  it("filters unknown values out of arrays", () => {
    expect(parseHoleVariants([9, 27])).toEqual([9]);
    expect(parseHoleVariants([27, 36])).toEqual([]);
  });
  it("returns [] for null, undefined, unknown strings", () => {
    expect(parseHoleVariants(null)).toEqual([]);
    expect(parseHoleVariants(undefined)).toEqual([]);
    expect(parseHoleVariants("")).toEqual([]);
    expect(parseHoleVariants("TWENTY_SEVEN")).toEqual([]);
  });
  it("returns [classifyHoles] result for a single-variant string", () => {
    expect(parseHoleVariants("GreenFee18Online")).toEqual([18]);
    expect(parseHoleVariants("NINE_HOLE")).toEqual([9]);
  });
});
