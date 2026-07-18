import type { PowerFormula, PowerMultiplier } from "./types.js";
import { JOB_LEVEL_BONUS_PER_LEVEL } from "../worldgen/config.js";

/**
 * Resolves a single BOUNDED multiplier to a numeric factor. Assumes the
 * formula already passed load-time validation (only bounded kinds
 * present) — see content/validate.ts and Gate 4.
 */
function resolveMultiplierValue(multiplier: PowerMultiplier): number {
  switch (multiplier.kind) {
    case "constant":
    case "crit":
    case "elemental":
      if (multiplier.value === undefined) {
        throw new Error(`multiplier of kind "${multiplier.kind}" requires a numeric value`);
      }
      return multiplier.value;
    default:
      // Unreachable for a validated formula — validate.ts rejects unbounded kinds at load.
      throw new Error(`resolveMultiplierValue: unbounded multiplier kind "${multiplier.kind}" reached runtime unvalidated`);
  }
}

export interface ComputeAbilityPowerInput {
  /** The relevant stat's resolved numeric value — a primary stat, or the equipped weapon's scaling stat (D6), resolved by the caller. */
  readonly relevantStatValue: number;
  readonly jobLevel: number;
  /** Whether the ability's primaryDomainTag matches the equipping job's primaryTag — the mastery gate. */
  readonly hasMasteryMatch: boolean;
  readonly formula: PowerFormula;
}

/**
 * ability_power = (relevant_stat + job_level_bonus) × bounded_multipliers
 *
 * Additive between stat and job-level; multiplicative only by bounded
 * multipliers. This is rule 10, executable — never call this with an
 * unvalidated formula (see content/validate.ts).
 */
export function computeAbilityPower(input: ComputeAbilityPowerInput): number {
  const jobLevelBonus = input.hasMasteryMatch ? input.jobLevel * JOB_LEVEL_BONUS_PER_LEVEL : 0;
  const base = input.relevantStatValue + jobLevelBonus;
  const multiplierProduct = input.formula.multipliers.reduce(
    (product, multiplier) => product * resolveMultiplierValue(multiplier),
    1,
  );
  return base * multiplierProduct;
}
