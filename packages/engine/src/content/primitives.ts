import type { MultiplierKind, PrimitiveId, StatusId } from "./types.js";

/**
 * The authored primitive vocabulary. Kept SMALL and earned — a
 * primitive enters this list only when a fixture ability actually needs
 * it. This is the entire "candidate list" from the design doc; nothing
 * beyond these six is implemented this phase.
 */
export const KNOWN_PRIMITIVES: readonly PrimitiveId[] = [
  "damage",
  "heal",
  "apply_status",
  "shift_queue",
  "modify_threat",
  "buff",
  "debuff",
];

/** Small fixture status vocabulary for `apply_status`. Not hot-loadable this phase — same scope tier as Phase 2's NPC trait/job fixture lists. */
export const KNOWN_STATUSES: readonly StatusId[] = ["sleep", "slow", "poison", "oiled"];

/**
 * Rule 10, enforced at load (Gate 4). Only these multiplier kinds are
 * legal in a PowerFormula's `multipliers` — each is bounded by
 * definition (a fixed literal, or a documented bounded range). The
 * other three MultiplierKind values (job_level, primary_stat,
 * weapon_scaling) exist in the type only so an ability CAN attempt to
 * use one, giving the loader something real to reject.
 */
export const BOUNDED_MULTIPLIER_KINDS: readonly MultiplierKind[] = ["constant", "crit", "elemental"];

export const UNBOUNDED_MULTIPLIER_KINDS: readonly MultiplierKind[] = ["job_level", "primary_stat", "weapon_scaling"];
