// ABOUTME: Tests for the platform adapter registry.
// ABOUTME: Verifies known platforms return adapters and unknown returns undefined.

import { describe, it, expect } from "vitest";
import { getAdapter } from "./index";

describe("getAdapter", () => {
  it("returns CPS Golf adapter for 'cps_golf'", () => {
    const adapter = getAdapter("cps_golf");
    expect(adapter).toBeDefined();
    expect(adapter!.platformId).toBe("cps_golf");
  });

  it("returns ForeUp adapter for 'foreup'", () => {
    const adapter = getAdapter("foreup");
    expect(adapter).toBeDefined();
    expect(adapter!.platformId).toBe("foreup");
  });

  it("returns undefined for unknown platform", () => {
    expect(getAdapter("unknown")).toBeUndefined();
  });
});
