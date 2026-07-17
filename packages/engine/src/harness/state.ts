import { createRng } from "../rng/index.js";
import { EventLogWriter } from "../log/index.js";
import type { GameState, TierSpec, PartySpec } from "./types.js";

/**
 * Thin wrapper — no new architecture. Because the engine is pure and
 * headless, a run's state is just a constructed object: a root RNG
 * derived from the seed, and an empty log ready to be appended to.
 */
export function constructState(
  seed: bigint | number | string,
  tier: TierSpec,
  partySpec: PartySpec,
): GameState {
  const rng = createRng(seed);
  return {
    seed: rng.seed,
    rng,
    log: new EventLogWriter(),
    tick: 0,
    tier,
    partySpec,
  };
}
