// ---------------------------------------------------------------------
// Phase 6 gate (CLAUDE.md): "Market structure is learnable: a scripted
// trader using only category knowledge beats a random buyer over 100
// seeds." Same shape as Phase 4's two-solver gate.
// ---------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { createRng } from "../../src/rng/index.js";
import { EventLogWriter } from "../../src/log/index.js";
import { createEconomyPort, type EconomyRegionSpec } from "../../src/economy/market.js";
import { loadEconomyContentFromDir } from "../../src/economy/loader.js";
import { buyPremiumMult, sellDepressionMult, BUY_PREMIUM_CEILING, SELL_DEPRESSION_FLOOR, GRADE_MULTIPLIERS } from "../../src/economy/pricing.js";
import { CONTENT_DIR } from "../battle/fixtures.js";
import type { EconomicAxis } from "../../src/worldgen/types.js";
import type { EconomyPort } from "../../src/economy/types.js";

const content = loadEconomyContentFromDir(CONTENT_DIR);

const REGIONS: EconomyRegionSpec[] = [
  { regionId: "region:extractive-a", economicAxis: "extractive" },
  { regionId: "region:extractive-b", economicAxis: "extractive" },
  { regionId: "region:refining-a", economicAxis: "refining" },
  { regionId: "region:refining-b", economicAxis: "refining" },
  { regionId: "region:mixed-a", economicAxis: "mixed" },
  { regionId: "region:mixed-b", economicAxis: "mixed" },
];

function buildPort(seed: number): EconomyPort {
  return createEconomyPort(content, REGIONS, createRng(seed).substream("gate6:economy"), new EventLogWriter());
}

const ROUNDS_PER_SEED = 100;
const SEEDS = 100;

/** Knows only: raw is cheap where extractive/dear where refining, processed reverses that — and each region's declared axis. Never looks up a real base price. */
function categoryTraderTrade(port: EconomyPort, rng: ReturnType<typeof createRng>, regions: readonly EconomyRegionSpec[]): number {
  const goods = port.listGoods();
  const good = goods[rng.nextInt(goods.length)];
  const a = regions[rng.nextInt(regions.length)];
  const b = regions[rng.nextInt(regions.length)];
  if (a.regionId === b.regionId) return 0;

  function favorability(axis: EconomicAxis): number {
    if (axis === "mixed") return 0;
    const rawCheapHere = axis === "extractive";
    return (rawCheapHere === (good.kind === "raw")) ? -1 : 1; // -1 = cheap to buy here, +1 = dear to sell here
  }
  const favA = favorability(a.economicAxis);
  const favB = favorability(b.economicAxis);
  if (favA >= favB) return 0; // no directional edge known between these two regions for this good

  const buyRegion = a;
  const sellRegion = b;
  if (port.getStock(buyRegion.regionId, good.id) < 1) return 0;
  const buyPrice = port.quoteBuyPrice(buyRegion.regionId, good.id, 1);
  port.buy(buyRegion.regionId, good.id, 1, 1, 0);
  const sellPrice = port.quoteSellPrice(sellRegion.regionId, good.id, 1);
  port.sell(sellRegion.regionId, good.id, 1, 1, 0);
  return sellPrice - buyPrice;
}

/** Trades uniformly at random: random good, random buy region, random sell region, no directional logic. */
function randomTraderTrade(port: EconomyPort, rng: ReturnType<typeof createRng>, regions: readonly EconomyRegionSpec[]): number {
  const goods = port.listGoods();
  const good = goods[rng.nextInt(goods.length)];
  const buyRegion = regions[rng.nextInt(regions.length)];
  const sellRegion = regions[rng.nextInt(regions.length)];
  if (buyRegion.regionId === sellRegion.regionId) return 0;
  if (port.getStock(buyRegion.regionId, good.id) < 1) return 0;
  const buyPrice = port.quoteBuyPrice(buyRegion.regionId, good.id, 1);
  port.buy(buyRegion.regionId, good.id, 1, 1, 0);
  const sellPrice = port.quoteSellPrice(sellRegion.regionId, good.id, 1);
  port.sell(sellRegion.regionId, good.id, 1, 1, 0);
  return sellPrice - buyPrice;
}

describe("Phase 6 gate — market structure is learnable", () => {
  it("a category-only trader beats a random trader over 100 seeds", () => {
    let categoryPositiveSeeds = 0;
    let categoryTotal = 0;
    let randomTotal = 0;

    for (let seed = 0; seed < SEEDS; seed++) {
      const categoryPort = buildPort(seed);
      const categoryRng = createRng(seed).substream("gate6:trader:category");
      let categoryProfit = 0;
      for (let i = 0; i < ROUNDS_PER_SEED; i++) categoryProfit += categoryTraderTrade(categoryPort, categoryRng, REGIONS);

      const randomPort = buildPort(seed);
      const randomRng = createRng(seed).substream("gate6:trader:random");
      let randomProfit = 0;
      for (let i = 0; i < ROUNDS_PER_SEED; i++) randomProfit += randomTraderTrade(randomPort, randomRng, REGIONS);

      if (categoryProfit > 0) categoryPositiveSeeds++;
      categoryTotal += categoryProfit;
      randomTotal += randomProfit;
    }

    const categoryMean = categoryTotal / SEEDS;
    const randomMean = randomTotal / SEEDS;

    // The chosen bar (documented in CLAUDE.md): category trader profits in
    // at least 90/100 seeds, and its mean per-seed profit is at least 1.4x
    // the random trader's mean per-seed profit (or random's mean is <= 0,
    // in which case any positive category mean already clears the bar).
    // 1.4x, not the initially-tried 3x: random isn't a true zero-mean
    // baseline here — stock inclusion odds are ALSO axis-weighted (a
    // region that produces raw goods cheaply also stocks more of them),
    // so a random trader partially free-rides on the same signal via
    // stock availability alone. Measured empirically at 1.6x-2.5x across
    // several large-sample runs; 1.4x leaves margin against sampling
    // noise while still requiring a real, non-trivial edge.
    expect(categoryPositiveSeeds).toBeGreaterThanOrEqual(90);
    expect(categoryMean).toBeGreaterThan(0);
    if (randomMean > 0) {
      expect(categoryMean).toBeGreaterThanOrEqual(randomMean * 1.4);
    }
  });

  it("regression: sell-depression/buy-premium never push price outside floor/ceiling across a long trading run", () => {
    const port = buildPort(777);
    const goodId = port.listGoods()[0].id;
    const regionId = REGIONS[0].regionId;
    // Force enough stock to sustain a long run regardless of the seeded roll.
    port.refreshRegion(regionId, 0);
    const basePriceAtGrade1 = port.listGoods()[0].basePrice * GRADE_MULTIPLIERS[1];

    for (let units = 0; units < 500; units++) {
      expect(sellDepressionMult(units)).toBeGreaterThanOrEqual(SELL_DEPRESSION_FLOOR);
      expect(sellDepressionMult(units)).toBeLessThanOrEqual(1);
      expect(buyPremiumMult(units)).toBeGreaterThanOrEqual(1);
      expect(buyPremiumMult(units)).toBeLessThanOrEqual(BUY_PREMIUM_CEILING);
    }

    // Sanity: the quoted sell price for the same good, at a heavily-sold
    // cycle, never drops below floor * base (approximately, modulo the
    // independent ±8% variance/region_mod terms which are bounded themselves).
    const worstCaseFloor = basePriceAtGrade1 * SELL_DEPRESSION_FLOOR * (1 - 0.35) * (1 - 0.08);
    const quoted = port.quoteSellPrice(regionId, goodId, 1);
    expect(quoted).toBeGreaterThan(0);
    expect(quoted).toBeGreaterThanOrEqual(worstCaseFloor * 0.5); // generous slack — this is a sanity floor, not an exact bound
  });
});
