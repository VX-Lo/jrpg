// ---------------------------------------------------------------------
// Damage resolution: tags/channel, the no-miss variance model, and the
// soft gate (CLAUDE.md §8). NO MISSES anywhere — accuracy is a damage
// scalar (glancing blows), clamped >0, applied BEFORE the weakness/Break
// check so ordering is stable regardless of whether a Break triggers in
// the same resolution (the four-checks Gate, CLAUDE.md §13.4).
// ---------------------------------------------------------------------

import { computeAbilityPower } from "../content/formula.js";
import type { DamageChannel, PowerFormula, TagId } from "../content/types.js";
import type { Rng } from "../rng/index.js";
import { LEVEL_DIFF_SCALAR_AT_MINUS3, DAMAGE_VARIANCE_NORMAL, DAMAGE_VARIANCE_UNCOUNTERED, UNCOUNTERED_STAT_EDGE } from "../worldgen/config.js";
import { resolveVariable } from "./registry.js";
import { rowDamageMultiplier } from "./rows.js";
import type { LiveCombatant } from "./types.js";

/**
 * Level-difference damage scalar (CLAUDE.md §8): smooth, monotonic in
 * (attackerLevel - defenderLevel), anchored so a -3 level disadvantage
 * lands at LEVEL_DIFF_SCALAR_AT_MINUS3 and parity is 1.0. Never zero, so
 * it blends rather than gates.
 */
export function levelDiffScalar(attackerLevel: number, defenderLevel: number): number {
  const diff = attackerLevel - defenderLevel;
  const slopePerLevel = (1 - LEVEL_DIFF_SCALAR_AT_MINUS3) / 3;
  return Math.max(0.1, 1 + slopePerLevel * diff);
}

export interface DamageRollInput {
  readonly attacker: LiveCombatant;
  readonly target: LiveCombatant;
  readonly powerFormula: PowerFormula;
  readonly channel: DamageChannel;
  readonly abilityTags: readonly TagId[];
  readonly targetWeaknessTags: readonly TagId[];
  readonly relevantStatValue: number;
  readonly jobLevel: number;
  readonly hasMasteryMatch: boolean;
  /** Soft gate (CLAUDE.md §8): true when the attacker's party lacks the target archetype's counter-material tag. Resolved by the caller (BattleRequest.counteredArchetypeIds), never computed here. */
  readonly uncountered: boolean;
  readonly currentTick: number;
  readonly rng: Rng;
}

export interface DamageRollResult {
  readonly amount: number;
  readonly isCrit: boolean;
  readonly isWeaknessHit: boolean;
  /** Portion of `amount` attributable to a weakness hit — what Break shield depletion reads. */
  readonly weaknessPortion: number;
  readonly accuracyScalar: number;
}

export function rollDamage(input: DamageRollInput): DamageRollResult {
  const power = computeAbilityPower({
    relevantStatValue: input.relevantStatValue,
    jobLevel: input.jobLevel,
    hasMasteryMatch: input.hasMasteryMatch,
    formula: input.powerFormula,
  });

  const isWeaknessHit = input.abilityTags.some((t) => input.targetWeaknessTags.includes(t));

  const critChance = resolveVariable(input.attacker, "critChance", input.currentTick);
  const isCrit = input.rng.nextFloat() < critChance;
  const critMultiplier = isCrit ? resolveVariable(input.attacker, "critMultiplier", input.currentTick) : 1;

  const damageDealtMult = resolveVariable(input.attacker, "damageDealtMult", input.currentTick);
  const damageTakenMult = resolveVariable(input.target, "damageTakenMult", input.currentTick);
  const rowMult = rowDamageMultiplier(input.target, input.channel);
  const weaknessMult = isWeaknessHit ? 1.5 : 1;
  const levelMult = levelDiffScalar(input.attacker.level, input.target.level);
  const counterEdge = input.uncountered ? 1 + UNCOUNTERED_STAT_EDGE : 1;

  // Accuracy scalar resolves BEFORE the weakness/Break check below — a
  // stable, documented order so a simultaneous glancing-blow scalar and
  // Break-trigger never race (CLAUDE.md §13.4). Never a whiff: clamp floor > 0.
  const accuracyScalar = resolveVariable(input.attacker, "accuracyScalar", input.currentTick);

  // Uncountered fights widen the variance band on BOTH sides (CLAUDE.md
  // §8) — the player's chosen risk, never an outcome flip.
  const varianceHalfWidth = input.uncountered ? DAMAGE_VARIANCE_UNCOUNTERED : DAMAGE_VARIANCE_NORMAL;
  const varianceRoll = 1 + (input.rng.nextFloat() * 2 - 1) * varianceHalfWidth;

  const total =
    power * critMultiplier * damageDealtMult * damageTakenMult * rowMult * weaknessMult * levelMult * counterEdge * accuracyScalar * varianceRoll;
  const amount = Math.max(0, Math.round(total));
  const weaknessPortion = isWeaknessHit ? amount : 0;

  return { amount, isCrit, isWeaknessHit, weaknessPortion, accuracyScalar };
}
