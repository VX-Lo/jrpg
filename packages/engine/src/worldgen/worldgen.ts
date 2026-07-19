import { createRng } from "../rng/index.js";
import type { Tier } from "./types.js";
import { rollShape } from "./shape.js";
import { assignKernels } from "./kernelAssignment.js";
import { generateRegion } from "./region.js";
import { band } from "./band.js";
import { placeBoss, applyBoss } from "./boss.js";
import { buildRegionAdjacency } from "./regionAdjacency.js";

/**
 * `worldgen(seed, tierIndex) → Tier`. Pure, deterministic, cold-
 * generatable at any depth.
 *
 * THE FENCE: this signature takes ONLY (seed, tierIndex). No party
 * parameter, no meta-profile parameter, no run-state parameter — they
 * don't exist in the signature, so they cannot be passed. This is
 * structural, not a convention: nothing this function calls receives
 * anything derived from play. See Gate 2 (cold-depth) and CLAUDE.md.
 *
 * A fresh root Rng is constructed from `seed` on every call — nothing
 * here is cached or shared across calls, which is what makes generating
 * unrelated tiers in between two calls to worldgen(seed, 40) a no-op on
 * the result.
 */
export function worldgen(seed: bigint | number | string, tierIndex: number): Tier {
  const root = createRng(seed);

  const shape = rollShape(root, tierIndex);
  const kernels = assignKernels(root, tierIndex, shape.length);

  const regions = shape.map((size, i) => generateRegion(root, tierIndex, i, size, kernels[i]));

  const placement = placeBoss(root, tierIndex, regions);
  const finalRegions = applyBoss(regions, placement);
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
