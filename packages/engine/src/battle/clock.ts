// ---------------------------------------------------------------------
// The CTB clock — one shared timeline with the world clock (CLAUDE.md
// §4). Never iterate tick-by-tick: resolution jumps straight to the
// lowest nextActionTick. No initiative roll; ties break by stable actor
// id (CLAUDE.md §2/§7).
// ---------------------------------------------------------------------

import { BASE_ACTION_TICKS, MIN_ACTION_TICKS } from "../worldgen/config.js";
import { resolveVariable } from "./registry.js";
import type { LiveCombatant } from "./types.js";

/** Picks the next actor to act: lowest nextActionTick, ties broken by stable actor id (no initiative variance). */
export function nextActor(actors: readonly LiveCombatant[]): LiveCombatant {
  const eligible = actors.filter((a) => !a.koed);
  if (eligible.length === 0) {
    throw new Error("clock: nextActor called with no eligible (non-KO'd) actors");
  }
  return [...eligible].sort((a, b) => {
    if (a.nextActionTick !== b.nextActionTick) return a.nextActionTick - b.nextActionTick;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}

/**
 * resolvedActionCost = clampFloor(BASE_ACTION_TICKS × actionCostMult × actionWeight, MIN_ACTION_TICKS)
 * where actionWeight is the acting ability's own tick cost expressed as a
 * ratio of the baseline (CLAUDE.md §4). Floored so Haste can't drive
 * infinite actions (the AGI-floor concern).
 */
export function resolvedActionCost(actor: LiveCombatant, abilityTickCost: number, currentTick: number): number {
  const actionCostMult = resolveVariable(actor, "actionCostMult", currentTick);
  const actionWeight = abilityTickCost / BASE_ACTION_TICKS;
  const raw = BASE_ACTION_TICKS * actionCostMult * actionWeight;
  return Math.max(MIN_ACTION_TICKS, Math.floor(raw));
}

/** Advances the actor's queue position after acting. Mutates in place — the queue is live combat state, not a pure value. */
export function scheduleNextAction(actor: LiveCombatant, cost: number): void {
  actor.nextActionTick += cost;
}
