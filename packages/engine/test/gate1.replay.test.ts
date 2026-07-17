import { describe, expect, it } from "vitest";
import { constructState } from "../src/harness/state.js";
import { runDemoScenario } from "../src/harness/demoScenario.js";
import { serializeLog } from "../src/log/index.js";

// Gate 1 — byte-identical replay across many seeds. Two independent runs
// constructed from the same seed must produce byte-identical serialized
// logs. Run across many seeds, not one, since a single seed could pass
// by coincidence.

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
  const state = constructState(seed, { tier: 1 }, { memberNames: [] });
  runDemoScenario(state);
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
