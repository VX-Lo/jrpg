import { describe, expect, it } from "vitest";
import { createRng } from "../../src/rng/index.js";
import { worldgen } from "../../src/worldgen/worldgen.js";
import { serializeTier } from "../../src/worldgen/serialize.js";
import { rollShape } from "../../src/worldgen/shape.js";
import { assignKernels } from "../../src/worldgen/kernelAssignment.js";
import { generateRegion } from "../../src/worldgen/region.js";
import { placeBoss, applyBoss } from "../../src/worldgen/boss.js";
import { band } from "../../src/worldgen/band.js";
import { buildRegionAdjacency } from "../../src/worldgen/regionAdjacency.js";
import type { Tier } from "../../src/worldgen/types.js";

// Gate 5 — perturbation, for real, against a real consumer of Phase 1's
// substream mechanism. Phase 1's Gate 2 proved the mechanism in
// isolation; this proves it survived contact with worldgen. Genuinely
// adds brand-new substream keys, draws real values from them, interleaved
// with the exact call sequence worldgen() uses internally — and asserts
// every pre-existing generated field is byte-identical to a normal
// worldgen() call.

function worldgenWithExtraDraws(seed: bigint | number | string, tierIndex: number): Tier {
  const root = createRng(seed);

  const shape = rollShape(root, tierIndex);
  const kernels = assignKernels(root, tierIndex, shape.length);

  const regions = shape.map((size, i) => {
    // A brand-new consumer with a brand-new key, not present in
    // worldgen.ts, drawing real values, inserted before region generation.
    const weatherRng = root.substream(`worldgen:tier:${tierIndex}:region:${i}:weather`);
    void weatherRng.nextUint64();
    void weatherRng.nextInt(7);
    return generateRegion(root, tierIndex, i, size, kernels[i]);
  });

  // A second new key, inserted just before boss placement.
  const omenRng = root.substream(`worldgen:tier:${tierIndex}:omen`);
  void omenRng.nextFloat();

  const placement = placeBoss(root, tierIndex, regions);
  const finalRegions = applyBoss(regions, placement);

  // A third new key, inserted between boss placement and the region-adjacency
  // build — so the adjacency draw is not merely last-in-sequence but genuinely
  // preceded by an unrelated new consumer.
  const tremorRng = root.substream(`worldgen:tier:${tierIndex}:tremor`);
  void tremorRng.nextInt(11);

  const regionEdges = buildRegionAdjacency(root, tierIndex, finalRegions);

  return {
    tierIndex,
    seed: root.seed,
    shape,
    band: band(tierIndex),
    regions: finalRegions,
    regionEdges,
    bossNodeId: placement.bossNodeId,
    bossRegionId: finalRegions[placement.bossRegionIndex].id,
    bossThreatArchetype: placement.bossThreatArchetype,
  };
}

describe("Gate 5 — perturbation (real worldgen consumer)", () => {
  it("adding new substream keys does not perturb any pre-existing generated field", () => {
    const cases: readonly [bigint, number][] = [
      [1n, 1],
      [42n, 5],
      [777n, 40],
    ];
    for (const [seed, tierIndex] of cases) {
      const original = worldgen(seed, tierIndex);
      const perturbed = worldgenWithExtraDraws(seed, tierIndex);
      expect(serializeTier(perturbed)).toBe(serializeTier(original));
    }
  });

  // Explicit sub-case for the region-adjacency graph, added in Phase 4.5.
  // `regionEdges` is the authoritative inter-region passability source the
  // spatial layer reads, so its stability under new consumers is load-bearing
  // for Phase 4.5's anti-shortcut gate specifically, not just for tier bytes
  // in aggregate. Asserted on its own so a regression names itself.
  it("the region-adjacency graph is unperturbed by a new consumer drawn immediately before it", () => {
    const cases: readonly [bigint, number][] = [
      [1n, 1],
      [42n, 5],
      [777n, 40],
      [123456789n, 25],
    ];
    for (const [seed, tierIndex] of cases) {
      const original = worldgen(seed, tierIndex);

      // Rebuild adjacency from a root that has had a brand-new substream
      // consumer drawn from it first.
      const root = createRng(seed);
      const intruder = root.substream(`worldgen:tier:${tierIndex}:regions:adjacency:decoy`);
      void intruder.nextUint64();
      void intruder.nextInt(5);
      const rebuilt = buildRegionAdjacency(root, tierIndex, original.regions);

      expect(rebuilt).toEqual(original.regionEdges);
      // And the graph is non-empty whenever the tier has more than one region.
      if (original.regions.length > 1) expect(rebuilt.length).toBeGreaterThan(0);
    }
  });
});
