// ---------------------------------------------------------------------
// Phase 6.5 — equipment. Slots are final: Weapon (one slot — wield
// style is a WeaponArchetype property, no off-hand slot), Armor (Head +
// Body), Modules (CLAUDE.md §6.5.1).
// ---------------------------------------------------------------------

import type { ArmorArchetypeId, ModuleId, WeaponArchetypeId } from "../content/types.js";

/**
 * 3 module slots (the spec's own instinct, taken): more build
 * expression at negligible cost, since modules are cheap TOML content
 * to add and unlike Weapon/Armor carry no crafting-economy weight.
 */
export const MODULE_SLOT_COUNT = 3;

export interface EquipmentLoadout {
  readonly weaponId?: WeaponArchetypeId;
  readonly headId?: ArmorArchetypeId;
  readonly bodyId?: ArmorArchetypeId;
  /** Length always <= MODULE_SLOT_COUNT; no duplicate ids (structural exclusivity, not stacking logic). */
  readonly moduleIds: readonly ModuleId[];
}

export const EMPTY_LOADOUT: EquipmentLoadout = { moduleIds: [] };

export class SlotExclusivityError extends Error {}
