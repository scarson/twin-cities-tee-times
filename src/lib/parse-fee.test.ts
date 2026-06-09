// ABOUTME: Tests for the shared positive-fee parser used by all platform adapters.
// ABOUTME: Verifies non-positive/unparseable fees collapse to null and positives are preserved.
import { describe, it, expect } from "vitest";
import { parsePositiveFee } from "./parse-fee";

describe("parsePositiveFee", () => {
  it("parses a positive decimal fee", () => {
    expect(parsePositiveFee("45.00")).toBe(45);
    expect(parsePositiveFee("30.52")).toBe(30.52);
  });

  it("preserves small positive fees", () => {
    expect(parsePositiveFee("0.01")).toBe(0.01);
    expect(parsePositiveFee("0.50")).toBe(0.5);
  });

  it("returns null for a zero fee", () => {
    expect(parsePositiveFee("0")).toBeNull();
    expect(parsePositiveFee("0.00")).toBeNull();
  });

  it("returns null for a negative fee", () => {
    expect(parsePositiveFee("-5")).toBeNull();
  });

  it("returns null for null and undefined", () => {
    expect(parsePositiveFee(null)).toBeNull();
    expect(parsePositiveFee(undefined)).toBeNull();
  });

  it("returns null for empty and whitespace-only strings", () => {
    expect(parsePositiveFee("")).toBeNull();
    expect(parsePositiveFee("   ")).toBeNull();
  });

  it("returns null for non-numeric strings", () => {
    expect(parsePositiveFee("free")).toBeNull();
    expect(parsePositiveFee("N/A")).toBeNull();
  });

  it("tolerates surrounding whitespace on a real fee", () => {
    expect(parsePositiveFee(" 25 ")).toBe(25);
  });
});
