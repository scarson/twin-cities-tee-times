// ABOUTME: Type declarations for vitest-axe custom matchers.
// ABOUTME: Augments Vitest's Assertion interface with toHaveNoViolations().
import "vitest";

interface AxeMatchers {
  toHaveNoViolations(): void;
}

declare module "vitest" {
  interface Assertion<T = unknown> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
