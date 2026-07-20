// ---------------------------------------------------------------------
// Rows & weapon geometry (CLAUDE.md §7). Row is a targetable, mutable
// property — not baked in as immutable — so a later pull/push verb can
// mutate it without an engine change.
// ---------------------------------------------------------------------

import type { Reach, Row } from "../content/types.js";
import type { LiveCombatant } from "./types.js";

export const BACK_ROW_PHYSICAL_DAMAGE_MULT = 0.7;

/**
 * Legal targets for an ability given the attacker's weapon reach
 * (D6/CLAUDE.md §7): melee targets the front row unless it's empty, then
 * reaches back; ranged targets either row. Reuses the row system — no
 * separate "no melee from back" rule.
 */
export function eligibleTargets(reach: Reach, candidates: readonly LiveCombatant[]): readonly LiveCombatant[] {
  const alive = candidates.filter((c) => !c.koed);
  if (reach === "ranged") return alive;
  const front = alive.filter((c) => c.row === "front");
  return front.length > 0 ? front : alive;
}

/** Only enemies whose archetype was flagged rowAttack may target the party's back row (CLAUDE.md §7 — never a random punish). */
export function eligibleEnemyTargets(attacker: LiveCombatant, candidates: readonly LiveCombatant[]): readonly LiveCombatant[] {
  const alive = candidates.filter((c) => !c.koed);
  if (attacker.rowAttack) return alive;
  const front = alive.filter((c) => c.row === "front");
  return front.length > 0 ? front : alive;
}

/** Row reduces PHYSICAL damage specifically (channel is a separate axis from element tags — CLAUDE.md §8). */
export function rowDamageMultiplier(target: LiveCombatant, channel: "physical" | "magical" | "true"): number {
  if (channel !== "physical") return 1;
  return target.row === "back" ? BACK_ROW_PHYSICAL_DAMAGE_MULT : 1;
}

export function moveRow(actor: LiveCombatant, row: Row): void {
  actor.row = row;
}
