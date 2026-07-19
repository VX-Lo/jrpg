import { createRng } from "../rng/index.js";
import { worldgen } from "../worldgen/worldgen.js";
import type { EmbeddedTier, ChunkLibrary, SpatialTier, TileMask } from "./types.js";
import { TILE_CODE, coarseKey, isWalkableCode } from "./types.js";
import { buildRegionBlobs } from "./voronoi.js";
import { buildBorderPlan } from "./borders.js";
import { buildBackbone, placeLogicalNodes } from "./backbone.js";
import { assembleTier } from "./assemble.js";
import { buildBlendLayer } from "./blend.js";
import { defaultChunkLibrary } from "./chunks/defaultLibrary.js";
import { CHUNK_SIZE, DECOR_VARIANT_COUNT } from "../worldgen/config.js";
import type { Rng } from "../rng/index.js";

/**
 * Deliverable 7 — a tier's terrain, generated on demand.
 *
 * `embedTier(seed, tierIndex)` is a PURE FUNCTION. Before it is called a
 * tier's terrain does not exist anywhere (rule 2: generator, not
 * database), and calling it reads nothing whatsoever from any other tier
 * (rule 3: cold-depth). Tier N+1 is not a continuation of tier N's canvas —
 * it is an independent embedding, joined to it by exactly one logical
 * doorway: the boss node, which carries `isExit` (roadmap §16b — there is
 * no separate transition-node type).
 *
 * That independence is the whole reason the dev harness can jump straight
 * to tier 40, and it is what Gate 5 asserts.
 *
 * THE THIRD PARAMETER carries authored CONTENT, never run state. It exists
 * for the same reason Phase 3's ContentPort does — so tests can inject an
 * isolated chunk library instead of the one on disk — and it defaults to
 * the real library, keeping the documented 2-argument form canonical. It is
 * emphatically NOT a loophole for party/meta/run-state to reach terrain
 * generation: nothing derived from play can be a chunk library.
 */
export function embedTier(
  seed: bigint | number | string,
  tierIndex: number,
  library: ChunkLibrary = defaultChunkLibrary(),
): EmbeddedTier {
  const tier = worldgen(seed, tierIndex);
  const root = createRng(seed);

  const blobs = buildRegionBlobs(root, tier);
  const borders = buildBorderPlan(root, tier, blobs);
  const placements = placeLogicalNodes(root, tier, blobs);
  const backbone = buildBackbone(root, tier, blobs, borders, placements);
  const { chunks, mask } = assembleTier(root, tier, blobs, borders, backbone, placements, library);

  const decor = applyParametricFill(root, tier.tierIndex, chunks, mask);
  const visualRegion = buildBlendLayer(root, tier, blobs, borders, mask);

  const exit = placements.find((p) => p.isExit);

  const spatial: SpatialTier = {
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

  return { tier, spatial };
}

/**
 * Deliverable 1's parametric fill: per-instance cosmetic variation so two
 * placements of the same chunk+orientation don't look identical.
 *
 * Keyed per chunk INSTANCE (`...:fill:{cx},{cy}`), which is what makes two
 * placements differ at all. Writes to a SEPARATE decor layer and never
 * touches `mask` — decoration that could turn a walkable tile impassable
 * would be able to sever the backbone after every walkability guarantee had
 * already been established, silently. Keeping the layers apart makes that
 * unrepresentable rather than merely avoided.
 */
function applyParametricFill(
  root: Rng,
  tierIndex: number,
  chunks: readonly { cell: { cx: number; cy: number }; regionIndex: number }[],
  mask: TileMask,
): Uint8Array {
  const decor = new Uint8Array(mask.tiles.length);

  for (const placed of chunks) {
    const { cx, cy } = placed.cell;
    const rng = root.substream(
      `spatial:tier:${tierIndex}:region:${placed.regionIndex}:fill:${coarseKey(cx, cy)}`,
    );
    for (let ty = 0; ty < CHUNK_SIZE; ty++) {
      for (let tx = 0; tx < CHUNK_SIZE; tx++) {
        const at = (cy * CHUNK_SIZE + ty) * mask.width + (cx * CHUNK_SIZE + tx);
        // Scatter only onto walkable ground; impassable tiles keep decor 0.
        if (!isWalkableCode(mask.tiles[at])) continue;
        decor[at] = rng.nextInt(DECOR_VARIANT_COUNT);
      }
    }
  }

  return decor;
}

/** Convenience for callers that only want the terrain. */
export function embedTierSpatial(
  seed: bigint | number | string,
  tierIndex: number,
  library?: ChunkLibrary,
): SpatialTier {
  return embedTier(seed, tierIndex, library).spatial;
}

export { TILE_CODE };
