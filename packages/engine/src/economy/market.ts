// ---------------------------------------------------------------------
// Region stocking, refresh, and the EconomyPort implementation
// (CLAUDE.md §6.3-6.5). Each region stocks a seeded SUBSET of goods
// (never the full catalog), weighted by its kernel's economicAxis.
// Refreshes on tier-boss-death, reusing Phase 5's existing
// `battle:referenceable` event stream — no new hook, no parallel signal.
// ---------------------------------------------------------------------

import type { EventLogWriter } from "../log/index.js";
import type { Rng } from "../rng/index.js";
import {
  STOCK_INCLUSION_AXIS_BONUS,
  STOCK_INCLUSION_BASE_CHANCE,
  STOCK_QUANTITY_BASE,
  STOCK_QUANTITY_VARIANCE_SPAN,
} from "../worldgen/config.js";
import type { EconomicAxis } from "../worldgen/types.js";
import type { EconomyContentPort } from "./loader.js";
import { basePrice, buyPremiumMult, sellDepressionMult } from "./pricing.js";
import type { EconomyPort, Good, GoodId, Grade } from "./types.js";

export interface RegionMarketState {
  readonly regionId: string;
  readonly economicAxis: EconomicAxis;
  cycleNumber: number;
  stock: Map<GoodId, number>;
  unitsSoldThisCycle: Map<GoodId, number>;
  unitsBoughtThisCycle: Map<GoodId, number>;
}

/**
 * Whether `good` is stocked this cycle, and if so how much — one
 * substream-keyed roll per (region, good, cycle), so re-rolling is
 * always reproducible from the same inputs (Invariant #1/#2 discipline).
 */
function rollGoodStock(
  rootRng: Rng,
  regionId: string,
  economicAxis: EconomicAxis,
  good: Good,
  cycleNumber: number,
): number | undefined {
  const rng = rootRng.substream(`economy:region:${regionId}:good:${good.id}:cycle:${cycleNumber}:stock`);
  const favored = economicAxis === "mixed" ? 0 : (economicAxis === "extractive") === (good.kind === "raw") ? 1 : -1;
  const chance = Math.min(1, Math.max(0, STOCK_INCLUSION_BASE_CHANCE + favored * STOCK_INCLUSION_AXIS_BONUS));
  if (rng.nextFloat() >= chance) return undefined;
  return STOCK_QUANTITY_BASE + rng.nextInt(STOCK_QUANTITY_VARIANCE_SPAN + 1);
}

function rollRegionStock(
  content: EconomyContentPort,
  rootRng: Rng,
  regionId: string,
  economicAxis: EconomicAxis,
  cycleNumber: number,
): Map<GoodId, number> {
  const stock = new Map<GoodId, number>();
  for (const good of content.listGoods()) {
    const quantity = rollGoodStock(rootRng, regionId, economicAxis, good, cycleNumber);
    if (quantity !== undefined) stock.set(good.id, quantity);
  }
  return stock;
}

function refreshState(content: EconomyContentPort, rootRng: Rng, state: RegionMarketState): void {
  state.cycleNumber += 1;
  state.stock = rollRegionStock(content, rootRng, state.regionId, state.economicAxis, state.cycleNumber);
  state.unitsSoldThisCycle = new Map();
  state.unitsBoughtThisCycle = new Map();
}

export interface EconomyRegionSpec {
  readonly regionId: string;
  readonly economicAxis: EconomicAxis;
}

/**
 * Builds the EconomyPort for one tier's regions. Every price/stock/
 * buy/sell operation routes through this — nothing outside `economy/`
 * computes a price independently (CLAUDE.md §6.5).
 */
export function createEconomyPort(
  content: EconomyContentPort,
  regions: readonly EconomyRegionSpec[],
  rootRng: Rng,
  log: EventLogWriter,
): EconomyPort {
  const states = new Map<string, RegionMarketState>();
  for (const region of regions) {
    const state: RegionMarketState = {
      regionId: region.regionId,
      economicAxis: region.economicAxis,
      cycleNumber: 0,
      stock: new Map(),
      unitsSoldThisCycle: new Map(),
      unitsBoughtThisCycle: new Map(),
    };
    refreshState(content, rootRng, state);
    states.set(region.regionId, state);
  }

  function mustGetState(regionId: string): RegionMarketState {
    const state = states.get(regionId);
    if (!state) throw new Error(`EconomyPort: unknown region "${regionId}"`);
    return state;
  }

  function computeBasePrice(state: RegionMarketState, good: Good, grade: Grade): number {
    return basePrice({
      good,
      grade,
      economicAxis: state.economicAxis,
      rootRng,
      regionId: state.regionId,
      cycleNumber: state.cycleNumber,
    });
  }

  return {
    listGoods: () => content.listGoods(),
    getGood: (id) => content.getGood(id),

    getStock: (regionId, goodId) => mustGetState(regionId).stock.get(goodId) ?? 0,

    quoteSellPrice: (regionId, goodId, grade) => {
      const state = mustGetState(regionId);
      const good = content.getGood(goodId);
      const units = state.unitsSoldThisCycle.get(goodId) ?? 0;
      return computeBasePrice(state, good, grade) * sellDepressionMult(units);
    },

    quoteBuyPrice: (regionId, goodId, grade) => {
      const state = mustGetState(regionId);
      const good = content.getGood(goodId);
      const units = state.unitsBoughtThisCycle.get(goodId) ?? 0;
      return computeBasePrice(state, good, grade) * buyPremiumMult(units);
    },

    sell: (regionId, goodId, grade, quantity, tick) => {
      if (quantity <= 0) throw new Error(`EconomyPort.sell: quantity must be positive, got ${quantity}`);
      const state = mustGetState(regionId);
      const good = content.getGood(goodId);
      const unitsBefore = state.unitsSoldThisCycle.get(goodId) ?? 0;
      let total = 0;
      for (let i = 0; i < quantity; i++) {
        total += computeBasePrice(state, good, grade) * sellDepressionMult(unitsBefore + i);
      }
      state.unitsSoldThisCycle.set(goodId, unitsBefore + quantity);
      state.stock.set(goodId, (state.stock.get(goodId) ?? 0) + quantity);
      log.append(tick, "economy:sell", { regionId, goodId, grade, quantity, total });
      return total;
    },

    buy: (regionId, goodId, grade, quantity, tick) => {
      if (quantity <= 0) throw new Error(`EconomyPort.buy: quantity must be positive, got ${quantity}`);
      const state = mustGetState(regionId);
      const available = state.stock.get(goodId) ?? 0;
      if (available < quantity) {
        throw new Error(`EconomyPort.buy: region "${regionId}" has only ${available} of "${goodId}" in stock, requested ${quantity}`);
      }
      const good = content.getGood(goodId);
      const unitsBefore = state.unitsBoughtThisCycle.get(goodId) ?? 0;
      let total = 0;
      for (let i = 0; i < quantity; i++) {
        total += computeBasePrice(state, good, grade) * buyPremiumMult(unitsBefore + i);
      }
      state.unitsBoughtThisCycle.set(goodId, unitsBefore + quantity);
      state.stock.set(goodId, available - quantity);
      log.append(tick, "economy:buy", { regionId, goodId, grade, quantity, total });
      return total;
    },

    refreshRegion: (regionId, tick) => {
      const state = mustGetState(regionId);
      refreshState(content, rootRng, state);
      log.append(tick, "economy:refresh", { regionId, cycleNumber: state.cycleNumber });
    },
  };
}
