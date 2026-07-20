// ---------------------------------------------------------------------
// Pre-commit immunity (CLAUDE.md §9): a pure, non-mutating prediction so
// a later UI can grey out no-effect options. The player still discovers
// immunity — but by targeting, never by wasting a turn.
// ---------------------------------------------------------------------

import type { Ability } from "../content/types.js";
import { resolveVariable } from "./registry.js";
import type { LiveCombatant } from "./types.js";

export interface EffectPrediction {
  readonly hasEffect: boolean;
}

export function predictEffect(ability: Ability, target: LiveCombatant, currentTick: number): EffectPrediction {
  for (const effect of ability.effects) {
    if (effect.primitive === "heal") {
      if (target.hp < target.maxHp) return { hasEffect: true };
      continue;
    }
    if (effect.primitive === "damage") {
      const damageTakenMult = resolveVariable(target, "damageTakenMult", currentTick);
      if (damageTakenMult > 0) return { hasEffect: true };
      continue;
    }
    // Status/buff/debuff/shift_queue/modify_threat: no immunity data modeled yet — always considered to have an effect.
    return { hasEffect: true };
  }
  return { hasEffect: false };
}
