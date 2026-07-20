// ---------------------------------------------------------------------
// Equip/unequip against a live combatant: the only thing that actually
// touches the modifier registry (Weapon/Armor are identity/slot
// bookkeeping only this pass — see CLAUDE.md Decisions log for why
// armor mitigation is deliberately out of scope). A module's grants
// apply as `durationTicks: null` modifiers (the same "while-active,
// removed explicitly" shape Defend already uses — CLAUDE.md §3/§6.5.2),
// keyed by a source string unique per (actor, module) so equipping the
// same module on two different actors never collides.
// ---------------------------------------------------------------------

import { addModifier, removeModifiersBySource } from "../battle/registry.js";
import type { LiveCombatant, ModifierOperation, ModifierVariable } from "../battle/types.js";
import type { Module } from "../content/types.js";

export function moduleSource(actorId: string, moduleId: string): string {
  return `module:${actorId}:${moduleId}`;
}

/** Grants a module's modifiers to `actor`. Assumes `assertModulesLegal` already validated `module` at content-load time. */
export function equipModuleModifiers(actor: LiveCombatant, module: Module, currentTick: number): void {
  const source = moduleSource(actor.id, module.id);
  for (const grant of module.grants) {
    addModifier(actor, {
      targetVariable: grant.targetVariable as ModifierVariable,
      operation: grant.operation as ModifierOperation,
      magnitude: grant.magnitude,
      durationTicks: null,
      source,
      currentTick,
    });
  }
}

/** Removes exactly the modifiers `equipModuleModifiers` granted for this (actor, module) pair — nothing else. */
export function unequipModuleModifiers(actor: LiveCombatant, module: Module): void {
  removeModifiersBySource(actor, moduleSource(actor.id, module.id));
}
