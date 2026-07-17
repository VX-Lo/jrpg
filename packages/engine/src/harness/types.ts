import type { Rng } from "../rng/index.js";
import type { EventLogWriter } from "../log/index.js";

/**
 * Near-empty stub — Phase 2 (worldgen) fills in what a "tier" actually
 * means (regions, settlements, etc). Only the shape matters right now.
 */
export interface TierSpec {
  readonly tier: number;
}

/**
 * Near-empty stub — Phase 5 (combat/stats) fills in real party members.
 * Only the shape matters right now.
 */
export interface PartySpec {
  readonly memberNames: readonly string[];
}

export interface GameState {
  readonly seed: bigint;
  readonly rng: Rng;
  readonly log: EventLogWriter;
  tick: number;
  readonly tier: TierSpec;
  readonly partySpec: PartySpec;
}
