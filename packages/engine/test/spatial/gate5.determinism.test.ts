import { describe, expect, it } from "vitest";
import { embedTier } from "../../src/spatial/embed.js";
import { defaultChunkLibrary } from "../../src/spatial/chunks/defaultLibrary.js";
import { serializeSpatialTier } from "../../src/spatial/serialize.js";

/**
 * Gate 5 — determinism and COLD-DEPTH, for terrain.
 *
 * This is Phase 2's cold-depth guarantee extended one layer down, and it
 * is the reason the whole phase can be balanced at all: `embedTier(seed,
 * 40)` must produce byte-identical terrain generated directly, with no
 * simulated play and regardless of which other tiers were embedded before
 * it. Tiers are INDEPENDENT embeddings — one tier's terrain never reads
 * another's anything.
 *
 * If this regresses, the dev harness can no longer jump to depth, and
 * every balance number gathered at tier 40 becomes a function of the path
 * taken to get there.
 */
describe("Gate 5 — determinism + cold-depth", () => {
  const library = defaultChunkLibrary();

  it("repeated calls are byte-identical, including edge-case seeds and deep tiers", () => {
    const cases: readonly [bigint, number][] = [
      [1n, 1],
      [42n, 5],
      [999n, 10],
      [7n, 40],
      [123456789n, 25],
      [0n, 3],
      [(1n << 64n) - 1n, 12],
      [(1n << 53n) + 7n, 40],
    ];

    for (const [seed, tierIndex] of cases) {
      const a = serializeSpatialTier(embedTier(seed, tierIndex, library).spatial);
      const b = serializeSpatialTier(embedTier(seed, tierIndex, library).spatial);
      expect(b, `seed ${seed} tier ${tierIndex} is not reproducible`).toBe(a);
    }
  }, 120_000);

  it("tier 40 is byte-identical regardless of which tiers were embedded in between", () => {
    const cold = serializeSpatialTier(embedTier(7n, 40, library).spatial);

    // Embed a pile of unrelated tiers, on other seeds and other depths, in
    // an order chosen to be nothing like the first call's context.
    for (const [seed, tierIndex] of [
      [1n, 1],
      [2n, 39],
      [7n, 1],
      [7n, 39],
      [7n, 41],
      [999n, 12],
      [3n, 40],
    ] as [bigint, number][]) {
      embedTier(seed, tierIndex, library);
    }

    const warm = serializeSpatialTier(embedTier(7n, 40, library).spatial);
    expect(warm, "embedding other tiers perturbed tier 40 — cold-depth is broken").toBe(cold);
  }, 120_000);

  it("a tier's terrain does not depend on its neighbours existing", () => {
    // Tier N+1 must be generatable without tier N ever having been built,
    // which is what "joined by exactly one logical doorway" has to mean.
    const alone = serializeSpatialTier(embedTier(55n, 21, library).spatial);
    embedTier(55n, 20, library);
    embedTier(55n, 22, library);
    expect(serializeSpatialTier(embedTier(55n, 21, library).spatial)).toBe(alone);
  }, 120_000);

  it("the boss node is the tier's exit gateway", () => {
    for (const [seed, tierIndex] of [
      [1n, 1],
      [42n, 5],
      [7n, 40],
    ] as [bigint, number][]) {
      const { tier, spatial } = embedTier(seed, tierIndex, library);
      expect(spatial.exitNodeId).toBe(tier.bossNodeId);
      const exits = spatial.placements.filter((p) => p.isExit);
      expect(exits).toHaveLength(1);
      expect(exits[0].logicalNodeId).toBe(tier.bossNodeId);
    }
  });
});
