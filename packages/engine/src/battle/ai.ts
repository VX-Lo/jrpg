// ---------------------------------------------------------------------
// Enemy AI — deterministic ordered priority lists (CLAUDE.md §10). The
// default path is fully deterministic; "unlearnable means unskillable."
// Bounded randomness (drawn from the battle substream, never
// Math.random) is acceptable only in specific documented places — none
// are used in this MVP priority list, so every decision below is a pure
// function of live state.
// ---------------------------------------------------------------------

import type { Ability } from "../content/types.js";
import { eligibleEnemyTargets } from "./rows.js";
import { selectByThreatBehavior, type ThreatBehaviorParams } from "./threat.js";
import type { LiveCombatant } from "./types.js";

export interface AiDecision {
  readonly ability: Ability;
  readonly target: LiveCombatant;
}

/**
 * Ordered priority: (1) an ability the actor can afford, first in its
 * list that isn't oversized on MP; (2) target an unshielded caster-tagged
 * party member if one is eligible; (3) otherwise fall back to the
 * archetype's threat-behavior read (CLAUDE.md §7/§10). Never initiative,
 * never a coin flip on target selection.
 */
export function decideEnemyAction(
  actor: LiveCombatant,
  partyCandidates: readonly LiveCombatant[],
  behaviorParams: ThreatBehaviorParams,
): AiDecision | undefined {
  const ability = actor.abilities.find((a) => a.resourceCost <= actor.mp) ?? actor.abilities[0];
  if (!ability) return undefined;

  const eligible = eligibleEnemyTargets(actor, partyCandidates);
  if (eligible.length === 0) return undefined;

  const unshieldedCaster = eligible.find((c) => c.tags.includes("caster") && !c.defending);
  const target = unshieldedCaster ?? selectByThreatBehavior(eligible, behaviorParams) ?? eligible[0];

  return { ability, target };
}
