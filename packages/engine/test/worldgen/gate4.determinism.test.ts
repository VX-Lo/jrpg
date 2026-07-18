import { describe, expect, it } from "vitest";
import { worldgen } from "../../src/worldgen/worldgen.js";
import { serializeTier } from "../../src/worldgen/serialize.js";

// Gate 4 — determinism. Generate the same tier twice from one seed,
// byte-diff, identical. Across many seeds and many tier indices,
// including deep ones.

const CASES: readonly [bigint, number][] = [
  [0n, 1],
  [1n, 2],
  [42n, 5],
  [123456789n, 17],
  [999n, 40],
  [7n, 100],
  [3n, 250],
  [1n << 40n, 500],
  [18446744073709551615n, 1000], // 2^64 - 1
];

describe("Gate 4 — determinism", () => {
  it.each(CASES)("seed=%s tier=%i: two independent generations are byte-identical", (seed, tierIndex) => {
    const a = worldgen(seed, tierIndex);
    const b = worldgen(seed, tierIndex);
    expect(serializeTier(b)).toBe(serializeTier(a));
  });
});
