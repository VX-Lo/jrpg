import type { Rng } from "../rng/index.js";
import type { Tier } from "../worldgen/types.js";
import { KERNELS } from "../worldgen/kernels/index.js";
import type { BorderPlan, ChunkLibrary, NodePlacement, RegionBlobs } from "./types.js";
import { coarseKey } from "./types.js";
import { scaleBiomeKey } from "./chunks/loader.js";
import { ownerAt } from "./voronoi.js";
import type { Backbone } from "./backbone.js";
import { buildVariantIndex, stitchGrid, type StitchResult } from "./stitch.js";
import { CHUNK_SIZE, CHUNK_REUSE_WEIGHT_PENALTY, BIOME_MATCH_WEIGHT_BONUS } from "../worldgen/config.js";

/**
 * Deliverable 5, steps 3-5 — far-zoom (wilderness) assembly.
 *
 * A THIN ADAPTER over `stitch.ts`, which is the actual stitching engine and
 * is shared verbatim with the closest-zoom interior builder. Everything
 * specific to the far zoom lives here — region blobs as the space's shape,
 * per-kernel biome pools, wilderness chunk size — and nothing about tiers
 * or regions leaks into the engine.
 */
export function assembleTier(
  root: Rng,
  tier: Tier,
  blobs: RegionBlobs,
  plan: BorderPlan,
  backbone: Backbone,
  placements: readonly NodePlacement[],
  library: ChunkLibrary,
): StitchResult {
  const nodeCellByKey = new Map(placements.map((p) => [coarseKey(p.cell.cx, p.cell.cy), p]));

  // Per-region chunk pools. A kernel's own biome pool is UNIONED with
  // "common" rather than replacing it, so a biome with a thin fixture set
  // is still buildable; `affinityFor` then tilts selection strongly toward
  // the kernel's own chunks so the union doesn't drown the biome.
  const poolByRegion = tier.regions.map((region) => {
    const kernel = KERNELS.find((k) => k.id === region.kernelId);
    const biomeTag = kernel?.biomeTag ?? "common";
    const own = library.byScaleAndBiome.get(scaleBiomeKey("wilderness", biomeTag)) ?? [];
    const common = library.byScaleAndBiome.get(scaleBiomeKey("wilderness", "common")) ?? [];
    const merged = [...own];
    for (const chunk of common) if (!merged.includes(chunk)) merged.push(chunk);
    return { biomeTag, index: buildVariantIndex(merged) };
  });

  void plan; // corridor seams already reached the backbone's requiredOpenSeams

  return stitchGrid({
    root,
    gridSize: blobs.gridSize,
    tileSize: CHUNK_SIZE,
    ownerAt: (cx, cy) => ownerAt(blobs, cx, cy),
    substreamKeyFor: (cx, cy, owner) =>
      `spatial:tier:${tier.tierIndex}:region:${owner}:chunks:${coarseKey(cx, cy)}`,
    poolFor: (owner) => poolByRegion[owner].index,
    affinityFor: (owner, chunk) =>
      chunk.biomeTag === poolByRegion[owner].biomeTag ? BIOME_MATCH_WEIGHT_BONUS : 1,
    logicalNodeAt: (cx, cy) => nodeCellByKey.get(coarseKey(cx, cy))?.logicalNodeId ?? null,
    requiredOpenSeams: backbone.requiredOpenSeams,
    requiredClosedSeams: backbone.requiredClosedSeams,
    backboneCells: backbone.cells,
    reusePenalty: CHUNK_REUSE_WEIGHT_PENALTY,
    describeCell: (_cx, _cy, owner) =>
      `region ${tier.regions[owner].id} (tier ${tier.tierIndex}, far zoom)`,
  });
}
