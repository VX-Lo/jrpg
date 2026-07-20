// ---------------------------------------------------------------------
// Pure loadout value operations — slot exclusivity only (structural),
// no stacking logic needed (CLAUDE.md §6.5.2: "structural slot
// exclusivity is enough; don't build special-case stacking logic").
// ---------------------------------------------------------------------

import type { ArmorArchetypeId, ModuleId, WeaponArchetypeId } from "../content/types.js";
import { MODULE_SLOT_COUNT, SlotExclusivityError, type EquipmentLoadout } from "./types.js";

export function equipWeapon(loadout: EquipmentLoadout, weaponId: WeaponArchetypeId): EquipmentLoadout {
  return { ...loadout, weaponId };
}

export function unequipWeapon(loadout: EquipmentLoadout): EquipmentLoadout {
  const { weaponId: _weaponId, ...rest } = loadout;
  return rest;
}

export function equipHead(loadout: EquipmentLoadout, headId: ArmorArchetypeId): EquipmentLoadout {
  return { ...loadout, headId };
}

export function equipBody(loadout: EquipmentLoadout, bodyId: ArmorArchetypeId): EquipmentLoadout {
  return { ...loadout, bodyId };
}

/** Throws if the module is already equipped (no double-equip) or all module slots are full. */
export function equipModule(loadout: EquipmentLoadout, moduleId: ModuleId): EquipmentLoadout {
  if (loadout.moduleIds.includes(moduleId)) {
    throw new SlotExclusivityError(`equipModule: "${moduleId}" is already equipped — equipping it again would double-stack its effect`);
  }
  if (loadout.moduleIds.length >= MODULE_SLOT_COUNT) {
    throw new SlotExclusivityError(`equipModule: all ${MODULE_SLOT_COUNT} module slots are full — unequip one first`);
  }
  return { ...loadout, moduleIds: [...loadout.moduleIds, moduleId] };
}

export function unequipModule(loadout: EquipmentLoadout, moduleId: ModuleId): EquipmentLoadout {
  return { ...loadout, moduleIds: loadout.moduleIds.filter((id) => id !== moduleId) };
}
