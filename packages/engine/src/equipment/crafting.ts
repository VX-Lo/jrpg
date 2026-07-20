// ---------------------------------------------------------------------
// Crafting fee (CLAUDE.md §6.5.3): computed via EconomyPort, materials
// priced through it — never a hardcoded separate fee formula.
//
// MINIMAL recipe model (deliberately, per the spec's "keep it minimal"
// instruction, and because no owned-materials/inventory system exists
// yet — see CLAUDE.md Decisions log): every Weapon/Armor archetype's
// two universal roles (striking/core, plating/lining) are filled by one
// fixed representative good per role — an "ingot" for the metal role, a
// "lumber" good for the organic role — rather than a per-archetype
// bill of materials. Quantity scales with grade. This is NOT real
// Phase 13 crafting depth (material choice, ownership tracking); it is
// the minimum that routes a real fee through real region prices.
// ---------------------------------------------------------------------

import type { EconomyPort, Grade } from "../economy/types.js";

export const CRAFT_STRIKING_MATERIAL_GOOD_ID = "good:ingot-iron";
export const CRAFT_CORE_MATERIAL_GOOD_ID = "good:lumber-oak";

/** Units of each role-material consumed per grade. UNCALIBRATED. */
export const CRAFT_MATERIAL_QTY_BY_GRADE: Readonly<Record<Grade, number>> = { 1: 1, 2: 2, 3: 4 };

/** The smith's fee to craft one item of `grade` in `regionId`, entirely via EconomyPort.quoteBuyPrice. */
export function craftFee(economy: EconomyPort, regionId: string, grade: Grade): number {
  const quantity = CRAFT_MATERIAL_QTY_BY_GRADE[grade];
  const strikingCost = economy.quoteBuyPrice(regionId, CRAFT_STRIKING_MATERIAL_GOOD_ID, grade) * quantity;
  const coreCost = economy.quoteBuyPrice(regionId, CRAFT_CORE_MATERIAL_GOOD_ID, grade) * quantity;
  return strikingCost + coreCost;
}
