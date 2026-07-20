// ---------------------------------------------------------------------
// Phase 6 — economy. Pure data shapes. Base good identity is authored
// content (fixed), never generated — only the regional-adjective flavor
// layer uses the grammar engine (CLAUDE.md §6.1).
// ---------------------------------------------------------------------

export type GoodId = string;
export type GoodKind = "raw" | "processed";

/** 16 categories total (8 raw-kind, 8 processed-kind), each a fixed authored identity — see content/goods.toml. */
export type GoodCategory = string;

export interface Good {
  readonly id: GoodId;
  readonly name: string;
  readonly category: GoodCategory;
  readonly kind: GoodKind;
  /** Base price at grade 1 (common), before grade/region/variance multipliers. */
  readonly basePrice: number;
}

/** Grade multipliers are fixed (1.0 / 2.2 / 5.0) — see pricing.ts GRADE_MULTIPLIERS. */
export type Grade = 1 | 2 | 3;

// ---------------------------------------------------------------------
// EconomyPort (CLAUDE.md §6.5) — the one seam all price/stock/buy/sell
// operations route through. No code outside economy/ computes a price
// independently.
// ---------------------------------------------------------------------

export interface EconomyPort {
  listGoods(): readonly Good[];
  getGood(id: GoodId): Good;

  getStock(regionId: string, goodId: GoodId): number;
  /** Price the market would PAY the player per unit, selling `goodId` at `grade` in `regionId` right now. */
  quoteSellPrice(regionId: string, goodId: GoodId, grade: Grade): number;
  /** Price the market CHARGES the player per unit, buying `goodId` at `grade` in `regionId` right now. */
  quoteBuyPrice(regionId: string, goodId: GoodId, grade: Grade): number;

  /** Player sells `quantity` units to the region's market. Returns total gold earned. Logs `economy:sell`. */
  sell(regionId: string, goodId: GoodId, grade: Grade, quantity: number, tick: number): number;
  /** Player buys `quantity` units from the region's market. Throws if stock is insufficient (loud, no silent partial fill). Returns total gold spent. Logs `economy:buy`. */
  buy(regionId: string, goodId: GoodId, grade: Grade, quantity: number, tick: number): number;

  /** Re-rolls a region's stocked subset/quantities and resets its sold/bought-this-cycle counters (CLAUDE.md §6.4 — tier-boss-death). */
  refreshRegion(regionId: string, tick: number): void;
}
