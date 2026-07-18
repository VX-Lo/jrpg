import { describe, expect, it } from "vitest";
import { band } from "../../src/worldgen/band.js";

// Gate 3 — band monotonicity and growth. This directly tests the one
// requirement the entire meta system rests on: difficulty must grow
// superlinearly across tiers, or death depth stops being self-limiting
// and the game silently becomes an unwinnable treadmill at high run
// counts. Nothing else would catch a regression here.

const TIER_COUNT = 50;

describe("Gate 3 — band monotonicity and growth", () => {
  it("band(n+1) > band(n) for all n up to 200", () => {
    let prev = band(1);
    for (let n = 2; n <= 200; n++) {
      const current = band(n);
      expect(current).toBeGreaterThan(prev);
      prev = current;
    }
  });

  it("growth is superlinear: fitted exponent across 50 tiers is > 1", () => {
    // Log-log linear regression: band(n) ~= C * n^k => ln(band(n)) = ln(C) + k*ln(n).
    // Fit k via least squares over n = 1..TIER_COUNT.
    const xs: number[] = [];
    const ys: number[] = [];
    for (let n = 1; n <= TIER_COUNT; n++) {
      xs.push(Math.log(n));
      ys.push(Math.log(band(n)));
    }
    const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < xs.length; i++) {
      numerator += (xs[i] - meanX) * (ys[i] - meanY);
      denominator += (xs[i] - meanX) ** 2;
    }
    const fittedExponent = numerator / denominator;

    expect(fittedExponent).toBeGreaterThan(1);
  });

  it("band is a pure function of tierIndex: same input always gives same output", () => {
    for (const n of [1, 2, 5, 17, 40, 100]) {
      expect(band(n)).toBe(band(n));
    }
  });

  it("rejects non-positive or non-integer tierIndex", () => {
    expect(() => band(0)).toThrow();
    expect(() => band(-1)).toThrow();
    expect(() => band(1.5)).toThrow();
  });
});
