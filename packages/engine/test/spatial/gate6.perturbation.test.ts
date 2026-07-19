import { describe, expect, it } from "vitest";
import { createRng } from "../../src/rng/index.js";
import { worldgen } from "../../src/worldgen/worldgen.js";
import { embedTier } from "../../src/spatial/embed.js";
import { defaultChunkLibrary } from "../../src/spatial/chunks/defaultLibrary.js";
import { serializeSpatialTier } from "../../src/spatial/serialize.js";
import { buildRegionBlobs } from "../../src/spatial/voronoi.js";
import { buildBorderPlan } from "../../src/spatial/borders.js";
import { buildBackbone, placeLogicalNodes } from "../../src/spatial/backbone.js";
import { assembleTier } from "../../src/spatial/assemble.js";
import { buildBlendLayer } from "../../src/spatial/blend.js";
import type { SpatialTier } from "../../src/spatial/types.js";
import { CHUNK_SIZE, DECOR_VARIANT_COUNT } from "../../src/worldgen/config.js";
import { coarseKey, isWalkableCode } from "../../src/spatial/types.js";

/**
 * Gate 6 — perturbation, for the spatial layer.
 *
 * Same shape as every prior phase's perturbation gate, and the same point:
 * substream keys are hashed directly into a seed rather than derived
 * sequentially, so adding a brand-new consumer must not shift any
 * pre-existing draw. Proven here against the REAL spatial call sequence
 * rather than in the abstract — new `spatial:*` keys are spliced in
 * between the actual stages, drawing real values, and every pre-existing
 * spatial output must come out byte-identical.
 *
 * This is what lets Phase 5+ add spatial consumers (enemy placement,
 * weather, ambient encounters) without silently reshaping every map that
 * has already been balanced.
 */
function embedWithExtraDraws(seed: bigint, tierIndex: number): SpatialTier {
  const library = defaultChunkLibrary();
  const tier = worldgen(seed, tierIndex);
  const root = createRng(seed);

  // New consumer #1: before any blob work.
  const weather = root.substream(`spatial:tier:${tierIndex}:weather`);
  void weather.nextUint64();
  void weather.nextInt(9);

  const blobs = buildRegionBlobs(root, tier);

  // New consumer #2: between blobs and borders, keyed per region.
  for (let i = 0; i < tier.regions.length; i++) {
    const ambience = root.substream(`spatial:tier:${tierIndex}:region:${i}:ambience`);
    void ambience.nextFloat();
    void ambience.nextInt(5);
  }

  const borders = buildBorderPlan(root, tier, blobs);

  // New consumer #3: between borders and node placement.
  const encounters = root.substream(`spatial:tier:${tierIndex}:encounters`);
  void encounters.nextInt(31);

  const placements = placeLogicalNodes(root, tier, blobs);
  const backbone = buildBackbone(root, tier, blobs, borders, placements);

  // New consumer #4: immediately before assembly, the most invasive spot.
  const props = root.substream(`spatial:tier:${tierIndex}:props`);
  void props.nextUint64();

  const { chunks, mask } = assembleTier(root, tier, blobs, borders, backbone, placements, library);

  const decor = new Uint8Array(mask.tiles.length);
  for (const placed of chunks) {
    const rng = root.substream(
      `spatial:tier:${tierIndex}:region:${placed.regionIndex}:fill:${coarseKey(placed.cell.cx, placed.cell.cy)}`,
    );
    for (let ty = 0; ty < CHUNK_SIZE; ty++) {
      for (let tx = 0; tx < CHUNK_SIZE; tx++) {
        const at = (placed.cell.cy * CHUNK_SIZE + ty) * mask.width + (placed.cell.cx * CHUNK_SIZE + tx);
        if (!isWalkableCode(mask.tiles[at])) continue;
        decor[at] = rng.nextInt(DECOR_VARIANT_COUNT);
      }
    }
  }

  const visualRegion = buildBlendLayer(root, tier, blobs, borders, mask);
  const exit = placements.find((p) => p.isExit);

  return {
    tierIndex,
    seed: tier.seed,
    blobs,
    borders,
    placements,
    backbone: backbone.cells,
    chunks,
    mask,
    decor,
    visualRegion,
    exitNodeId: exit?.logicalNodeId ?? tier.bossNodeId,
  };
}

describe("Gate 6 — perturbation (real spatial consumer)", () => {
  it("adding new spatial substream consumers perturbs no pre-existing spatial draw", () => {
    const library = defaultChunkLibrary();
    const cases: readonly [bigint, number][] = [
      [1n, 1],
      [42n, 5],
      [777n, 40],
      [123456789n, 25],
    ];

    for (const [seed, tierIndex] of cases) {
      const original = serializeSpatialTier(embedTier(seed, tierIndex, library).spatial);
      const perturbed = serializeSpatialTier(embedWithExtraDraws(seed, tierIndex));
      expect(perturbed, `seed ${seed} tier ${tierIndex} was perturbed by unrelated new substreams`).toBe(
        original,
      );
    }
  }, 120_000);
});
