// ---------------------------------------------------------------------
// DEBUG-ONLY gear roll. No function anywhere instantiates a concrete
// piece of gear from a WeaponArchetype (real implementation is Phase 13
// crafting — only the schema + composition rules exist today). This is a
// small, explicitly-labeled stand-in so the Battle tab's reward-reroll
// loop has something to show. Do not mistake this for real Phase 13
// work later. See CLAUDE.md "Debug tooling" §5.
// ---------------------------------------------------------------------

import type { WeaponArchetype } from "../../../engine/src/content/types.js";
import type { Rng } from "./access.js";

export interface DebugGearDrop {
  readonly weaponArchetypeId: string;
  readonly name: string;
  readonly tier: number;
}

const FLAVORS = ["Rusted", "Sturdy", "Fine", "Masterwork", "Ancient", "Gilded"];

export function debugRollGear(tier: number, archetypePool: readonly WeaponArchetype[], rng: Rng): DebugGearDrop {
  const archetype = archetypePool[rng.nextInt(archetypePool.length)];
  const flavor = FLAVORS[rng.nextInt(FLAVORS.length)];
  return { weaponArchetypeId: archetype.id, name: `${flavor} ${archetype.name}`, tier };
}
