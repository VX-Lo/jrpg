// ---------------------------------------------------------------------
// Cargo capacity (CLAUDE.md §6.7) — additive only against STR. Never
// multiply by grade/tier/anything: STR is an unbounded meta stat, and a
// multiplicative combination here reproduces the exact meta×tier
// compound-interest violation rule 10 exists to prevent.
// ---------------------------------------------------------------------

import { CARGO_BASE, CARGO_PER_STR } from "../worldgen/config.js";

export function cargoCapacity(str: number): number {
  return CARGO_BASE + str * CARGO_PER_STR;
}
