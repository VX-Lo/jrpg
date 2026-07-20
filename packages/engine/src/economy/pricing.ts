// ---------------------------------------------------------------------
// Price formula (CLAUDE.md §6.2). Fixed part:
//   price = base(good) × grade_mult × region_mod(category) × local_variance(±8%)
// This module also pins the two functions the spec left unspecified:
// sellDepression/buyPremium, both monotonic and bounded so a market can
// never collapse to zero or spike unboundedly.
//
// Structured as a flat array of named multiplicative terms specifically
// so a future price-shock multiplier (§6.8, Phase 7 faction raids) can
// be appended as one more bounded term later without restructuring this
// function — the seam the spec asks for, not built here.
// ---------------------------------------------------------------------

import type { Rng } from "../rng/index.js";
import type { EconomicAxis } from "../worldgen/types.js";
import type { Good, Grade } from "./types.js";

/** Fixed per spec: common / fine / masterwork. */
export const GRADE_MULTIPLIERS: Readonly<Record<Grade, number>> = { 1: 1.0, 2: 2.2, 3: 5.0 };

/** Fixed per spec: local variance is seeded, ±8% of the pre-variance price. */
export const LOCAL_VARIANCE_HALF_WIDTH = 0.08;

/**
 * How strongly a region's economicAxis shifts a category's price, per the
 * categorical rule the Phase 6 gate's category-only trader exploits: raw
 * goods are cheap where dug (extractive) and dear where worked (refining);
 * processed goods invert. "mixed" regions stay neutral. UNCALIBRATED
 * magnitude; the direction is load-bearing (Gate).
 */
export const REGION_MOD_STRENGTH = 0.35;

export function regionMod(kind: Good["kind"], axis: EconomicAxis): number {
  if (axis === "mixed") return 1;
  const rawCheapHere = axis === "extractive";
  const isRaw = kind === "raw";
  const cheap = rawCheapHere === isRaw;
  return cheap ? 1 - REGION_MOD_STRENGTH : 1 + REGION_MOD_STRENGTH;
}

/**
 * Deterministic per-(region, good, cycle) variance — recomputed from a
 * named substream rather than stored, same "derive, don't persist"
 * discipline as Voronoi seeds (Invariant #2). `cycleNumber` increments on
 * every stock refresh (§6.4), so a fresh cycle draws a fresh variance
 * without needing separate reset bookkeeping.
 */
export function localVariance(rootRng: Rng, regionId: string, goodId: GoodIdLike, cycleNumber: number): number {
  const rng = rootRng.substream(`economy:region:${regionId}:good:${goodId}:cycle:${cycleNumber}:variance`);
  return 1 + (rng.nextFloat() * 2 - 1) * LOCAL_VARIANCE_HALF_WIDTH;
}

type GoodIdLike = string;

export interface BasePriceInput {
  readonly good: Good;
  readonly grade: Grade;
  readonly economicAxis: EconomicAxis;
  readonly rootRng: Rng;
  readonly regionId: string;
  readonly cycleNumber: number;
}

/** The fixed formula, before sellDepression/buyPremium are applied for an actual transaction quote. */
export function basePrice(input: BasePriceInput): number {
  const terms = [
    GRADE_MULTIPLIERS[input.grade],
    regionMod(input.good.kind, input.economicAxis),
    localVariance(input.rootRng, input.regionId, input.good.id, input.cycleNumber),
    // Future seam: a bounded price-shock multiplier (§6.8) would push one more term here.
  ];
  return input.good.basePrice * terms.reduce((product, term) => product * term, 1);
}

/**
 * Bounded diminishing curve for both depression/premium (CLAUDE.md
 * §6.2): a simple linear-clamped shape, chosen because the spec only
 * asks for "monotonic, bounded" and an unclamped linear curve is the
 * simplest thing that can never invert direction or run away. Floors at
 * SELL_DEPRESSION_FLOOR of base price no matter how many units are sold
 * in one cycle; ceilings at BUY_PREMIUM_CEILING no matter how many are
 * bought. UNCALIBRATED rate/floor/ceiling.
 */
export const SELL_DEPRESSION_RATE = 0.03;
export const SELL_DEPRESSION_FLOOR = 0.4;
export const BUY_PREMIUM_RATE = 0.03;
export const BUY_PREMIUM_CEILING = 2.5;

export function sellDepressionMult(unitsSoldThisCycle: number): number {
  return Math.max(SELL_DEPRESSION_FLOOR, 1 - SELL_DEPRESSION_RATE * unitsSoldThisCycle);
}

export function buyPremiumMult(unitsBoughtThisCycle: number): number {
  return Math.min(BUY_PREMIUM_CEILING, 1 + BUY_PREMIUM_RATE * unitsBoughtThisCycle);
}
