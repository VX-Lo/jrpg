// ---------------------------------------------------------------------
// Break & Boost (CLAUDE.md §6). Distinct mechanics with distinct sides:
// Break = target-side tempo punishment earned by weakness knowledge;
// Boost = self-side burst-timing economy, pressure-sensitive so it
// doubles as the comeback lever without a separate limit-break system.
// ---------------------------------------------------------------------

import { BOOST_CAP, BOOST_PER_TURN, BOOST_PRESSURE_MULTIPLIER, BOOST_SPEND_MAX } from "../worldgen/config.js";
import { addModifier, resolveVariable } from "./registry.js";
import type { LiveCombatant } from "./types.js";

const BREAK_QUEUE_PUSHBACK_TICKS = 1500;
const BREAK_DAMAGE_TAKEN_MULT = 1.5;
const BREAK_WINDOW_DURATION_TICKS = 3000;

/**
 * Depletes an enemy's Break shield by `weaknessDamage` (the portion of an
 * attack that hit a known weakness). At zero: pushes the target's queue
 * back and raises damageTakenMult for the break window (CLAUDE.md §6).
 * Returns true if this call triggered the break.
 */
export function applyBreakDamage(target: LiveCombatant, weaknessDamage: number, currentTick: number): boolean {
  if (target.breakShieldCurrent <= 0 || weaknessDamage <= 0) return false;
  target.breakShieldCurrent = Math.max(0, target.breakShieldCurrent - weaknessDamage);
  if (target.breakShieldCurrent > 0) return false;

  target.nextActionTick += BREAK_QUEUE_PUSHBACK_TICKS;
  target.breakWindowUntilTick = currentTick + BREAK_WINDOW_DURATION_TICKS;
  addModifier(target, {
    targetVariable: "damageTakenMult",
    operation: "multiply",
    magnitude: BREAK_DAMAGE_TAKEN_MULT,
    durationTicks: BREAK_WINDOW_DURATION_TICKS,
    source: "break:window",
    currentTick,
  });
  return true;
}

export function isBroken(target: LiveCombatant, currentTick: number): boolean {
  return target.breakWindowUntilTick !== null && currentTick < target.breakWindowUntilTick;
}

/** Restores an enemy's shield to max — call when a new break window naturally closes, per encounter-builder policy. Exposed for the resolver/tests, not auto-invoked. */
export function resetBreakShield(target: LiveCombatant): void {
  target.breakShieldCurrent = target.breakShieldMax;
  target.breakWindowUntilTick = null;
}

/**
 * Grants Boost at the start of an actor's turn. boostGenerationRate is a
 * registry variable (§3) that the resolver raises via a pressure modifier
 * while the party member is wounded/downed — same accumulator, no new
 * bar, per CLAUDE.md §6.
 */
export function grantBoostForTurn(actor: LiveCombatant, currentTick: number): void {
  const rate = resolveVariable(actor, "boostGenerationRate", currentTick);
  actor.boost = Math.min(BOOST_CAP, actor.boost + BOOST_PER_TURN * rate);
}

/** Applies (or refreshes) the pressure-sensitive Boost-generation-rate bonus for a party member with an active wound / down state. */
export function setBoostPressure(actor: LiveCombatant, active: boolean, currentTick: number): void {
  if (!active) return;
  addModifier(actor, {
    targetVariable: "boostGenerationRate",
    operation: "multiply",
    magnitude: BOOST_PRESSURE_MULTIPLIER,
    durationTicks: null,
    source: "boost:pressure",
    currentTick,
  });
}

export function clampBoostSpend(requested: number, available: number): number {
  return Math.max(0, Math.min(BOOST_SPEND_MAX, requested, available));
}

export function spendBoost(actor: LiveCombatant, amount: number): number {
  const spent = clampBoostSpend(amount, actor.boost);
  actor.boost -= spent;
  return spent;
}
