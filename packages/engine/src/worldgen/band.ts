import { BAND_BASE, BAND_GROWTH } from "./config.js";

/**
 * Difficulty band for a tier — f(tierIndex) ONLY. Never party level, never
 * run state. This is the fence: band must be computable cold, at any
 * depth, without simulating anything that came before it. See Gate 2
 * (cold-depth) and Gate 3 (monotonicity + superlinear growth).
 */
export function band(tierIndex: number): number {
  if (!Number.isInteger(tierIndex) || tierIndex < 1) {
    throw new Error(`band: tierIndex must be a positive integer, got ${tierIndex}`);
  }
  return Math.round(BAND_BASE * Math.pow(tierIndex, BAND_GROWTH));
}
