// ---------------------------------------------------------------------
// Threat (CLAUDE.md §7). A per-actor running accumulator. Behavior is a
// per-archetype parameter set, never hardcoded branches — loyal /
// opportunist / assassin are parameterizations of the same read, and a
// fourth behavior is a data entry, not new code.
// ---------------------------------------------------------------------

import { resolveVariable } from "./registry.js";
import type { LiveCombatant } from "./types.js";

/** modify_threat primitive — writes the running accumulator. Scaled by threatGenerationMult (a registry variable, e.g. a tank's threat-boosting buff). */
export function modifyThreat(actor: LiveCombatant, amount: number, currentTick: number): void {
  const mult = resolveVariable(actor, "threatGenerationMult", currentTick);
  actor.threat = Math.max(0, actor.threat + amount * mult);
}

export type TargetSelectionRule = "highest_threat" | "lowest_hp" | "lowest_threat";

export interface ThreatBehaviorParams {
  readonly threshold: number;
  readonly targetSelectionRule: TargetSelectionRule;
}

/** Reads the threat accumulator through the archetype's behavior params to choose a target — never a hardcoded per-behavior branch. */
export function selectByThreatBehavior(
  candidates: readonly LiveCombatant[],
  params: ThreatBehaviorParams,
): LiveCombatant | undefined {
  const alive = candidates.filter((c) => !c.koed);
  if (alive.length === 0) return undefined;
  const overThreshold = alive.filter((c) => c.threat >= params.threshold);
  const pool = overThreshold.length > 0 ? overThreshold : alive;
  switch (params.targetSelectionRule) {
    case "highest_threat":
      return [...pool].sort((a, b) => b.threat - a.threat || a.id.localeCompare(b.id))[0];
    case "lowest_threat":
      return [...pool].sort((a, b) => a.threat - b.threat || a.id.localeCompare(b.id))[0];
    case "lowest_hp":
      return [...pool].sort((a, b) => a.hp - b.hp || a.id.localeCompare(b.id))[0];
    default:
      return pool[0];
  }
}
