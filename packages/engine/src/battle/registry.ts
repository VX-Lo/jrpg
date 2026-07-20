// ---------------------------------------------------------------------
// The modifier registry — the central architectural commitment of Phase
// 5 (CLAUDE.md §3). Every combat variable resolves THROUGH this module;
// nothing computes damage/accuracy/action-cost/etc inline.
//
// RULE 10 AT THE REGISTRY: a multiplicative modifier may target only a
// bounded variable. Enforced at both definition (addModifier) and
// resolution (resolveVariable re-clamps every time) so no amount of
// stacking can drive a bounded variable past its declared range.
// ---------------------------------------------------------------------

import { PRIMARY_STATS, type PrimaryStat, type TagId } from "../content/types.js";
import type { ActiveModifier, LiveCombatant, ModifierOperation, ModifierVariable } from "./types.js";

export const BOUNDED_VARIABLES: ReadonlySet<ModifierVariable> = new Set([
  "damageDealtMult",
  "damageTakenMult",
  "critChance",
  "critMultiplier",
  "accuracyScalar",
  "actionCostMult",
  "threatGenerationMult",
  "mpCostMult",
  "boostGenerationRate",
  "statusResistance",
  "resistPerTag",
]);

function isPrimaryStat(v: ModifierVariable): v is PrimaryStat {
  return (PRIMARY_STATS as readonly string[]).includes(v);
}

/** [min, max] clamp for every bounded variable. Every bounded variable MUST appear here (Gate 3). */
export const VARIABLE_CLAMPS: Readonly<Record<string, readonly [number, number]>> = {
  damageDealtMult: [0, 5],
  damageTakenMult: [0, 5],
  critChance: [0, 1],
  critMultiplier: [1, 5],
  /** Floor > 0: accuracy is a glancing-blow scalar, never a whiff (CLAUDE.md §8/§9). */
  accuracyScalar: [0.05, 1],
  actionCostMult: [0.1, 5],
  threatGenerationMult: [0, 5],
  mpCostMult: [0, 5],
  boostGenerationRate: [0, 10],
  statusResistance: [0, 1],
  resistPerTag: [-1, 1],
};

/** Default (no-modifier) value for a bounded variable — the "no active modifiers" resolution of resolveVariable. */
export const VARIABLE_DEFAULTS: Readonly<Record<string, number>> = {
  damageDealtMult: 1,
  damageTakenMult: 1,
  critChance: 0.05,
  critMultiplier: 1.5,
  accuracyScalar: 1,
  actionCostMult: 1,
  threatGenerationMult: 1,
  mpCostMult: 1,
  boostGenerationRate: 1,
  statusResistance: 0,
  resistPerTag: 0,
};

export class Rule10Violation extends Error {}

/**
 * Validates a modifier BEFORE it is applied to any actor. Throws
 * Rule10Violation if a multiplicative modifier targets an unbounded
 * variable (primary stats — a buff may add, never multiply, CLAUDE.md §3).
 */
export function assertModifierLegal(targetVariable: ModifierVariable, operation: ModifierOperation): void {
  if (operation === "multiply" && !BOUNDED_VARIABLES.has(targetVariable)) {
    throw new Rule10Violation(
      `rule 10: multiplicative modifier on unbounded variable "${targetVariable}" is forbidden — ` +
        `a buff may add to a primary stat but never multiply it. Only bounded variables ` +
        `(${[...BOUNDED_VARIABLES].join(", ")}) accept "multiply".`,
    );
  }
}

function clampIfBounded(variable: ModifierVariable, value: number): number {
  const clamp = VARIABLE_CLAMPS[variable];
  if (!clamp) return value;
  const [min, max] = clamp;
  return Math.min(max, Math.max(min, value));
}

function isExpired(modifier: ActiveModifier, currentTick: number): boolean {
  return modifier.expiresAtTick !== null && currentTick >= modifier.expiresAtTick;
}

export interface AddModifierInput {
  readonly targetVariable: ModifierVariable;
  readonly operation: ModifierOperation;
  readonly magnitude: number;
  readonly durationTicks: number | null;
  readonly source: string;
  readonly currentTick: number;
  readonly tag?: TagId;
  readonly idSuffix?: string;
}

/**
 * Adds a modifier to an actor's active stack, enforcing rule 10 at
 * definition time and the stack rule from CLAUDE.md §3: same source +
 * same targetVariable (+ tag) refreshes duration rather than re-adding
 * magnitude, so nothing self-stacks infinitely.
 */
export function addModifier(actor: LiveCombatant, input: AddModifierInput): void {
  assertModifierLegal(input.targetVariable, input.operation);
  const expiresAtTick = input.durationTicks === null ? null : input.currentTick + input.durationTicks;
  const existingIndex = actor.modifiers.findIndex(
    (m) => m.source === input.source && m.targetVariable === input.targetVariable && m.tag === input.tag,
  );
  const modifier: ActiveModifier = {
    id: `${input.source}:${input.targetVariable}${input.tag ? `:${input.tag}` : ""}${input.idSuffix ? `:${input.idSuffix}` : ""}`,
    targetVariable: input.targetVariable,
    operation: input.operation,
    magnitude: input.magnitude,
    expiresAtTick,
    source: input.source,
    tag: input.tag,
  };
  if (existingIndex >= 0) {
    actor.modifiers[existingIndex] = modifier;
  } else {
    actor.modifiers.push(modifier);
  }
}

export function pruneExpiredModifiers(actor: LiveCombatant, currentTick: number): void {
  actor.modifiers = actor.modifiers.filter((m) => !isExpired(m, currentTick));
}

/**
 * Resolves a variable's value: base, then every active modifier on that
 * actor for that variable — additives sum into the base, then
 * multiplicatives multiply the additive result — then clamp if bounded
 * (CLAUDE.md §3). `resistPerTag` additionally filters by `tag`.
 */
export function resolveVariable(
  actor: LiveCombatant,
  variable: ModifierVariable,
  currentTick: number,
  opts?: { readonly tag?: TagId; readonly base?: number },
): number {
  const base = opts?.base ?? (isPrimaryStat(variable) ? actor.stats[variable] : (VARIABLE_DEFAULTS[variable] ?? 0));
  const active = actor.modifiers.filter((m) => {
    if (m.targetVariable !== variable) return false;
    if (isExpired(m, currentTick)) return false;
    if (variable === "resistPerTag" && m.tag !== opts?.tag) return false;
    return true;
  });
  const additive = active.filter((m) => m.operation === "add").reduce((sum, m) => sum + m.magnitude, base);
  const multiplied = active.filter((m) => m.operation === "multiply").reduce((product, m) => product * m.magnitude, additive);
  return clampIfBounded(variable, multiplied);
}
