// ---------------------------------------------------------------------
// The slot-composition resolver (CLAUDE.md §6.5.1): the ONE function
// that assembles a concrete GearInstance from an archetype + grade,
// used identically for weapons and armor, and by both crafting and
// looting (content/gearInstance.ts, not duplicated per path).
// ---------------------------------------------------------------------

import type { Rng } from "../rng/index.js";
import type { ArmorArchetype, GearInstance, GearSlot, Grade, WeaponArchetype } from "./types.js";

const GRADE_LABEL: Readonly<Record<Grade, string>> = { 1: "", 2: "Fine ", 3: "Masterwork " };

function slotOf(archetype: WeaponArchetype | ArmorArchetype): GearSlot {
  return "reach" in archetype ? "weapon" : archetype.slot;
}

/**
 * Composes a concrete instance from an archetype + grade. Display name
 * is `{grade label}{archetype name}` — e.g. "Masterwork Plate Cuirass".
 * `instanceId` is caller-supplied (deterministic, e.g. a seeded roll id
 * or a stable craft-order id) rather than generated here, so composing
 * stays a pure function of its inputs.
 */
/**
 * Grade roll weighted by tier band (CLAUDE.md §6.5.3 gate — "correct
 * tier/grade distribution"): deeper bands roll higher grades more
 * often. UNCALIBRATED thresholds, monotonic in band by construction.
 */
export const GRADE_ROLL_BAND_THRESHOLDS = { grade2At: 15, grade3At: 40 };

export function rollGrade(band: number, rng: Rng): Grade {
  const grade2Chance = Math.min(0.6, Math.max(0, (band - GRADE_ROLL_BAND_THRESHOLDS.grade2At) / 60));
  const grade3Chance = Math.min(0.5, Math.max(0, (band - GRADE_ROLL_BAND_THRESHOLDS.grade3At) / 80));
  const roll = rng.nextFloat();
  if (roll < grade3Chance) return 3;
  if (roll < grade3Chance + grade2Chance) return 2;
  return 1;
}

/** Picks uniformly from the combined weapon+armor archetype pool and composes an instance at a band-rolled grade — the "keep it minimal" looted-gear resolver (CLAUDE.md §6.5.3). */
export function rollLootedGear(
  weaponArchetypes: readonly WeaponArchetype[],
  armorArchetypes: readonly ArmorArchetype[],
  band: number,
  rng: Rng,
  instanceId: string,
): GearInstance {
  const pool: readonly (WeaponArchetype | ArmorArchetype)[] = [...weaponArchetypes, ...armorArchetypes];
  const archetype = pool[rng.nextInt(pool.length)];
  return composeGearInstance(archetype, rollGrade(band, rng), instanceId);
}

export function composeGearInstance(
  archetype: WeaponArchetype | ArmorArchetype,
  grade: Grade,
  instanceId: string,
): GearInstance {
  return {
    instanceId,
    archetypeId: archetype.id,
    slot: slotOf(archetype),
    grade,
    displayName: `${GRADE_LABEL[grade]}${archetype.name}`,
  };
}
