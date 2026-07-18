import type { Rng } from "../rng/index.js";
import type { EventLogWriter } from "../log/index.js";
import type { Tier } from "../worldgen/types.js";

/** Input spec: which tier to generate. `constructState` calls `worldgen(seed, tierIndex)` to build the real Tier. */
export interface TierSpec {
  readonly tierIndex: number;
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
  /** The real generated Tier (Phase 2's worldgen output) — not a stub anymore. */
  readonly tier: Tier;
  readonly partySpec: PartySpec;
}
