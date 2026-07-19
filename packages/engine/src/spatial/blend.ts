import type { Rng } from "../rng/index.js";
import type { Tier } from "../worldgen/types.js";
import { KERNELS } from "../worldgen/kernels/index.js";
import type { BorderPlan, RegionBlobs, TileMask } from "./types.js";
import { UNOWNED_CELL } from "./types.js";
import { CHUNK_SIZE, BLEND_STRIP_NARROW_TILES, BLEND_STRIP_WIDE_TILES } from "../worldgen/config.js";
import { ownerAt } from "./voronoi.js";

/**
 * Deliverable 4 — blending at region seams.
 *
 * Two adjacent regions' palettes interpolate linearly across a strip at
 * their shared corridor: 100% region A's tileset at one end, 100% B's at
 * the other, probabilistically mixed between. The output is a VISUAL
 * region per tile — which region's palette to draw it with — which differs
 * from ownership only inside the strip.
 *
 * NO AUTHORED PER-KERNEL-PAIR TRANSITIONS. Each kernel declares its own
 * small blend descriptor and any two interpolate between them, so cost is
 * linear in kernel count rather than quadratic. With the eventual 15-25
 * kernels, pairwise authoring would mean 100-300 hand-maintained
 * transitions — the N² trap this project already rejected once for combo
 * techs.
 *
 * STRIP WIDTH REUSES PHASE 2'S BOUNDARY-ROOT DATA rather than introducing
 * a new relationship table. Kernels that already share a lexicon boundary
 * root (the Fen and the Hollow share "silt-") get the WIDE, softer
 * transition; unrelated kernels get the NARROW, sharper one. Narrative
 * closeness buys physical closeness for free, off data that already exists.
 *
 * This layer is DATA, not pixels. Phase 10 decides what a palette looks
 * like; nothing here draws anything.
 */

/** Do two kernels share at least one boundary root? */
export function kernelsShareBoundaryRoot(kernelIdA: string, kernelIdB: string): boolean {
  const a = KERNELS.find((k) => k.id === kernelIdA);
  const b = KERNELS.find((k) => k.id === kernelIdB);
  if (!a || !b) return false;
  return a.boundaryRoots.some((root) => b.boundaryRoots.includes(root));
}

export function blendStripWidth(kernelIdA: string, kernelIdB: string): number {
  return kernelsShareBoundaryRoot(kernelIdA, kernelIdB) ? BLEND_STRIP_WIDE_TILES : BLEND_STRIP_NARROW_TILES;
}

/**
 * Builds the visual-region layer.
 *
 * Only tiles near a CORRIDOR blend. A sealed border is a cliff or a wall,
 * and terrain on the far side of one has no business bleeding across it —
 * blending a sealed seam would imply a continuity the world specifically
 * denies.
 */
export function buildBlendLayer(
  root: Rng,
  tier: Tier,
  blobs: RegionBlobs,
  borders: BorderPlan,
  mask: TileMask,
): Uint8Array {
  const rng = root.substream(`spatial:tier:${tier.tierIndex}:blend`);
  const visual = new Uint8Array(mask.tiles.length);

  // Start from plain ownership: every tile is drawn with its own region's
  // palette unless the strip says otherwise.
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const owner = ownerAt(blobs, Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
      visual[y * mask.width + x] = owner === UNOWNED_CELL ? 0 : owner;
    }
  }

  for (const seam of borders.corridorEdges) {
    const [cellPart, dirPart] = seam.split("|");
    const [cx, cy] = cellPart.split(",").map(Number);
    const horizontal = dirPart === "E";

    const ownerA = ownerAt(blobs, cx, cy);
    const ownerB = horizontal ? ownerAt(blobs, cx + 1, cy) : ownerAt(blobs, cx, cy + 1);
    if (ownerA === UNOWNED_CELL || ownerB === UNOWNED_CELL) continue;

    const width = blendStripWidth(tier.regions[ownerA].kernelId, tier.regions[ownerB].kernelId);

    // The seam's tile coordinate, and the axis to interpolate along.
    const seamTile = horizontal ? (cx + 1) * CHUNK_SIZE : (cy + 1) * CHUNK_SIZE;
    const spanStart = horizontal ? cy * CHUNK_SIZE : cx * CHUNK_SIZE;

    for (let offset = 0; offset < CHUNK_SIZE; offset++) {
      for (let step = -width; step < width; step++) {
        const along = spanStart + offset;
        const across = seamTile + step;
        const x = horizontal ? across : along;
        const y = horizontal ? along : across;
        if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) continue;

        // Linear interpolation: at the far A end the chance of drawing B's
        // palette is 0, at the far B end it is 1.
        const t = (step + width) / (2 * width);
        visual[y * mask.width + x] = rng.nextFloat() < t ? ownerB : ownerA;
      }
    }
  }

  return visual;
}
