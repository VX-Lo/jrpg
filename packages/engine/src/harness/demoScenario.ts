import type { GameState } from "./types.js";

/**
 * Phase 1 dev-harness fixture ONLY — not game content. There is no real
 * worldgen/combat yet (Phase 2/5), so this exercises the rng/log pipeline
 * end-to-end with a fixed, deterministic sequence of substream draws, to
 * give the CLI's generate/replay/diff commands something real to operate
 * on. Delete or replace once Phase 2+ systems exist.
 */
export function runDemoScenario(state: GameState): void {
  const regionsRng = state.rng.substream(`worldgen:tier:${state.tier.tier}:regions`);
  const initiativeRng = state.rng.substream("combat:encounter:0:initiative");

  for (let i = 0; i < 5; i++) {
    state.tick += 1;
    state.log.append(state.tick, "demo:region-roll", { value: regionsRng.nextUint64().toString() });
  }

  for (let i = 0; i < 5; i++) {
    state.tick += 1;
    state.log.append(state.tick, "demo:initiative-roll", { value: initiativeRng.nextInt(20) });
  }
}
