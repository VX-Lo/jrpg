import { describe, expect, it } from "vitest";
import { constructState } from "../src/harness/state.js";
import { serializeLog } from "../src/log/index.js";

// Gate 1 — byte-identical replay across many seeds. Two independent runs
// constructed from the same seed must produce byte-identical serialized
// logs. Run across many seeds, not one, since a single seed could pass
// by coincidence.
//
// Appends events drawn from a named substream directly — the
// Phase-1-only demo scenario this used to depend on was superseded by
// real worldgen (see harness/state.ts) and removed.

const SEEDS: (bigint | number | string)[] = [
  0n,
  1n,
  42,
  -7,
  123456789n,
  "hollowmark",
  "worldgen:tier:5:regions",
  9007199254740993n, // beyond Number.MAX_SAFE_INTEGER
  18446744073709551615n, // 2^64 - 1
];

function generateLog(seed: bigint | number | string): string {
  const state = constructState(seed, { tierIndex: 1 }, { memberNames: [] });
  const rng = state.rng.substream("test:gate1:demo-rolls");
  for (let i = 0; i < 10; i++) {
    state.tick += 1;
    state.log.append(state.tick, "test:roll", { value: rng.nextUint64().toString() });
  }
  return serializeLog(state.log.toArray());
}

describe("Gate 1 — byte-identical replay", () => {
  it.each(SEEDS)("seed %s: two independent generations are byte-identical", (seed) => {
    const first = generateLog(seed);
    const second = generateLog(seed);
    expect(second).toBe(first);
  });

  it("different seeds produce different logs (sanity check against a trivially-passing gate)", () => {
    const logs = SEEDS.map((seed) => generateLog(seed));
    const unique = new Set(logs);
    expect(unique.size).toBe(logs.length);
  });
});
