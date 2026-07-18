import { describe, expect, it } from "vitest";
import { worldgen } from "../../src/worldgen/worldgen.js";
import { validateTier } from "../../src/worldgen/validate.js";

// Gate 1 — volume. 1,000 seeds generate without crash or degenerate
// output. Seeds and tier indices both vary so this exercises shallow and
// deep tiers, and every REGION_SHAPES variant, across the run.

const SEED_COUNT = 1000;

describe("Gate 1 — volume", () => {
  it(`generates ${SEED_COUNT} seeds without crashing or producing degenerate output`, () => {
    const failures: string[] = [];

    for (let i = 0; i < SEED_COUNT; i++) {
      const seed = BigInt(i) * 2654435761n + 1n; // spread seeds out, avoid trivial small-int clustering
      const tierIndex = (i % 80) + 1; // covers shallow (1) through deep (80) tiers

      const tier = worldgen(seed, tierIndex);
      const violations = validateTier(tier);
      if (violations.length > 0) {
        failures.push(`seed=${seed} tier=${tierIndex}: ${violations.join("; ")}`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length}/${SEED_COUNT} generations degenerate:\n${failures.slice(0, 20).join("\n")}`);
    }
    expect(failures).toEqual([]);
  });
});
