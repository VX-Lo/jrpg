// ---------------------------------------------------------------------
// Bought gear (CLAUDE.md §6.5.3) — PROPOSED ADDITION, not previously
// specified in the design doc; flagged here and in CLAUDE.md's
// Decisions log per the spec's own instruction. Reuses the same
// finite-stock/refresh-on-boss-death clock as general goods (§6.3-6.4)
// rather than inventing new market machinery.
//
// Module found-only unlock-then-purchase: a themed vendor only offers a
// module the player has already discovered once (combat loot/contract
// reward) — mirrors the existing fast-travel "visit the hub first"
// one-way unlock shape (a discovered-ids set), not new machinery either.
// ---------------------------------------------------------------------

import type { Rng } from "../rng/index.js";
import type { ArmorArchetype, GearInstance, Module, ModuleId, WeaponArchetype } from "../content/types.js";
import { composeGearInstance, rollGrade } from "../content/gearInstance.js";
import type { EconomyPort, Grade } from "../economy/types.js";
import { craftFee } from "./crafting.js";

/** Vendor margin over raw material cost (still entirely EconomyPort-priced underneath — see crafting.ts). UNCALIBRATED. */
export const BOUGHT_GEAR_MARKUP = 1.5;

/** How many premade items a gear vendor stocks at once. UNCALIBRATED. */
export const GEAR_VENDOR_STOCK_SIZE = 4;

export interface GearVendorSlot {
  readonly instance: GearInstance;
  readonly price: number;
}

export interface GearVendorState {
  readonly regionId: string;
  cycleNumber: number;
  stock: GearVendorSlot[];
}

function rollVendorStock(
  weaponArchetypes: readonly WeaponArchetype[],
  armorArchetypes: readonly ArmorArchetype[],
  economy: EconomyPort,
  regionId: string,
  band: number,
  rng: Rng,
  cycleNumber: number,
): GearVendorSlot[] {
  const pool: readonly (WeaponArchetype | ArmorArchetype)[] = [...weaponArchetypes, ...armorArchetypes];
  const slots: GearVendorSlot[] = [];
  for (let i = 0; i < GEAR_VENDOR_STOCK_SIZE; i++) {
    const archetype = pool[rng.nextInt(pool.length)];
    const grade: Grade = rollGrade(band, rng);
    const instance = composeGearInstance(archetype, grade, `vendor:${regionId}:cycle:${cycleNumber}:slot:${i}`);
    const price = craftFee(economy, regionId, grade) * BOUGHT_GEAR_MARKUP;
    slots.push({ instance, price });
  }
  return slots;
}

export function createGearVendor(
  weaponArchetypes: readonly WeaponArchetype[],
  armorArchetypes: readonly ArmorArchetype[],
  economy: EconomyPort,
  regionId: string,
  band: number,
  rootRng: Rng,
): GearVendorState {
  const state: GearVendorState = { regionId, cycleNumber: 0, stock: [] };
  refreshGearVendor(state, weaponArchetypes, armorArchetypes, economy, band, rootRng);
  return state;
}

/** Re-rolls the vendor's stock — call on the same tier-boss-death signal that refreshes general goods (economy/refresh.ts). */
export function refreshGearVendor(
  state: GearVendorState,
  weaponArchetypes: readonly WeaponArchetype[],
  armorArchetypes: readonly ArmorArchetype[],
  economy: EconomyPort,
  band: number,
  rootRng: Rng,
): void {
  state.cycleNumber += 1;
  const rng = rootRng.substream(`equipment:vendor:${state.regionId}:cycle:${state.cycleNumber}`);
  state.stock = rollVendorStock(weaponArchetypes, armorArchetypes, economy, state.regionId, band, rng, state.cycleNumber);
}

/** Buys one item off the vendor's stock. Returns undefined if `instanceId` isn't currently stocked (loud callers should treat this as "not available", not retry silently). */
export function buyGearItem(state: GearVendorState, instanceId: string): GearVendorSlot | undefined {
  const index = state.stock.findIndex((slot) => slot.instance.instanceId === instanceId);
  if (index < 0) return undefined;
  const [slot] = state.stock.splice(index, 1);
  return slot;
}

// ---------------------------------------------------------------------
// Module found-only unlock-then-purchase.
// ---------------------------------------------------------------------

export type DiscoveredModules = ReadonlySet<ModuleId>;

export const EMPTY_DISCOVERED_MODULES: DiscoveredModules = new Set();

/** One-way unlock, same shape as the existing fast-travel hub unlock: once discovered (loot/contract reward), always offerable — never re-locked. */
export function markModuleDiscovered(discovered: DiscoveredModules, moduleId: ModuleId): DiscoveredModules {
  return new Set([...discovered, moduleId]);
}

/** A themed module vendor's sellable list: the intersection of its pool and what the player has already found. Never sight-unseen. */
export function moduleVendorOffers(vendorPool: readonly Module[], discovered: DiscoveredModules): readonly Module[] {
  return vendorPool.filter((module) => discovered.has(module.id));
}
