import type { Rng } from "../rng/index.js";
import type { Tier } from "../worldgen/types.js";
import { KERNELS } from "../worldgen/kernels/index.js";
import type {
  BorderPlan,
  Chunk,
  ChunkLibrary,
  NodePlacement,
  Orientation,
  PlacedChunk,
  RegionBlobs,
  TileMask,
} from "./types.js";
import {
  ALL_ORIENTATIONS,
  DIR_DELTA,
  DIR_EDGE_NAME,
  TILE_CODE,
  UNOWNED_CELL,
  coarseKey,
  orientationKey,
  seamKey,
  tileCodeOf,
} from "./types.js";
import { orientChunk } from "./chunks/orient.js";
import { scaleBiomeKey } from "./chunks/loader.js";
import { ownerAt } from "./voronoi.js";
import type { Backbone } from "./backbone.js";
import { CHUNK_SIZE, CHUNK_REUSE_WEIGHT_PENALTY, BIOME_MATCH_WEIGHT_BONUS } from "../worldgen/config.js";

/**
 * Deliverable 5, steps 3-5 — anchor chunks on the backbone, free fill off
 * it, constraint-matched at every seam.
 *
 * THE SOLVE IS A SINGLE ROW-MAJOR PASS WITH NO BACKTRACKING, and that is a
 * property of the chunk library rather than a gamble. Placing cells in
 * row-major order means a cell's NORTH and WEST seams are already fixed by
 * neighbours that are placed, while its EAST and SOUTH seams are still
 * free for it to choose. Because the library covers all 16 open-edge
 * patterns (every subset of {N,E,S,W} — asserted by a test), whatever the
 * two fixed seams demand, some pattern satisfies it. So a cell can always
 * be filled and a later cell can always match what an earlier one chose.
 * WFC-style propagation and backtracking would both be machinery for a
 * problem this ordering removes.
 *
 * Seam states, in precedence order:
 *   1. backbone-required          → MUST be open
 *   2. corridor seam              → MUST be open
 *   3. neighbour already placed   → must equal what the neighbour declared
 *   4. cross-region or off-blob   → MUST be closed  (the anti-shortcut rule)
 *   5. otherwise                  → free, chosen with a seeded roll
 *
 * If no chunk fits, that is a FIXTURE COVERAGE GAP and it throws with the
 * details. It is never papered over — silently degrading to a solid chunk
 * would break walkability quietly, which is the one failure mode this
 * phase exists to prevent.
 */

const REQUIRED_OPEN = 1;
const REQUIRED_CLOSED = 2;
const FREE = 0;

interface AssemblyResult {
  readonly chunks: readonly PlacedChunk[];
  readonly mask: TileMask;
}

/** Every (chunk, orientation) variant, grouped by its open-edge bitmask. */
interface VariantIndex {
  /** bitmask (bit d set = direction d open) → variants */
  readonly byPattern: Map<number, { chunk: Chunk; orientation: Orientation }[]>;
}

function patternOf(connectorsOpen: readonly boolean[]): number {
  return connectorsOpen.reduce((mask, open, d) => (open ? mask | (1 << d) : mask), 0);
}

function buildVariantIndex(chunks: readonly Chunk[]): VariantIndex {
  const byPattern = new Map<number, { chunk: Chunk; orientation: Orientation }[]>();
  for (const chunk of chunks) {
    for (const orientation of ALL_ORIENTATIONS) {
      const oriented = orientChunk(chunk, orientation);
      const open = DIR_EDGE_NAME.map((edge) => oriented.connectors[edge].kind === "open");
      const key = patternOf(open);
      const bucket = byPattern.get(key);
      if (bucket) bucket.push({ chunk, orientation });
      else byPattern.set(key, [{ chunk, orientation }]);
    }
  }
  return { byPattern };
}

/** Seeded weighted pick. Weights must be positive. */
function weightedPick<T>(rng: Rng, items: readonly T[], weightOf: (item: T) => number): T {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  let roll = rng.nextFloat() * total;
  for (const item of items) {
    roll -= weightOf(item);
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

/** Deterministic shuffle of the candidate patterns. */
function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function assembleTier(
  root: Rng,
  tier: Tier,
  blobs: RegionBlobs,
  plan: BorderPlan,
  backbone: Backbone,
  placements: readonly NodePlacement[],
  library: ChunkLibrary,
): AssemblyResult {
  const size = blobs.gridSize;
  const nodeCellByKey = new Map(placements.map((p) => [coarseKey(p.cell.cx, p.cell.cy), p]));

  // Per-region chunk pools. A kernel's own biome pool is unioned with
  // "common" — the fixture library only authors the common set in depth, and
  // a region whose kernel biome has no chunks must still be buildable.
  const poolByRegion = tier.regions.map((region) => {
    const kernel = KERNELS.find((k) => k.id === region.kernelId);
    const biomeTag = kernel?.biomeTag ?? "common";
    const own = library.byScaleAndBiome.get(scaleBiomeKey("wilderness", biomeTag)) ?? [];
    const common = library.byScaleAndBiome.get(scaleBiomeKey("wilderness", "common")) ?? [];
    const merged = [...own];
    for (const chunk of common) if (!merged.includes(chunk)) merged.push(chunk);
    return { biomeTag, index: buildVariantIndex(merged) };
  });

  const chunks: PlacedChunk[] = [];
  const usedInRegion: Set<string>[] = tier.regions.map(() => new Set<string>());
  const usedInTier = new Map<string, number>();
  // Declared openness per seam, so a later cell can match an earlier one.
  const seamOpen = new Map<string, boolean>();

  const mask: TileMask = {
    width: size * CHUNK_SIZE,
    height: size * CHUNK_SIZE,
    tiles: new Uint8Array(size * CHUNK_SIZE * size * CHUNK_SIZE).fill(TILE_CODE.impassable),
  };

  for (let cy = 0; cy < size; cy++) {
    for (let cx = 0; cx < size; cx++) {
      const regionIndex = ownerAt(blobs, cx, cy);
      // Unowned cells are the impassable tier boundary — the mask is already
      // filled with impassable, so there is nothing to place.
      if (regionIndex === UNOWNED_CELL) continue;

      const cellKey = coarseKey(cx, cy);
      const rng = root.substream(`spatial:tier:${tier.tierIndex}:region:${regionIndex}:chunks:${cellKey}`);

      // ---- resolve the four seam constraints ----
      const constraint = [FREE, FREE, FREE, FREE];
      for (let dir = 0; dir < 4; dir++) {
        const [dx, dy] = DIR_DELTA[dir];
        const seam = seamKey(cx, cy, dir);
        const neighbourOwner = ownerAt(blobs, cx + dx, cy + dy);

        if (backbone.requiredOpenSeams.has(seam)) {
          constraint[dir] = REQUIRED_OPEN;
        } else if (backbone.requiredClosedSeams.has(seam)) {
          // Touches an enclave: sealed from both sides, so the enclave is
          // genuinely terrain-you-look-at rather than a walkable island.
          constraint[dir] = REQUIRED_CLOSED;
        } else if (neighbourOwner === UNOWNED_CELL || neighbourOwner !== regionIndex) {
          // Cross-region seams that are not sanctioned corridors, and every
          // seam onto the tier boundary, are sealed. THIS is the line that
          // makes Gate 2 hold; corridors already matched above.
          constraint[dir] = REQUIRED_CLOSED;
        } else if (seamOpen.has(seam)) {
          constraint[dir] = seamOpen.get(seam) ? REQUIRED_OPEN : REQUIRED_CLOSED;
        }
      }

      // ---- candidate open-edge patterns consistent with those constraints ----
      const candidates: number[] = [];
      for (let pattern = 0; pattern < 16; pattern++) {
        let ok = true;
        for (let dir = 0; dir < 4 && ok; dir++) {
          const open = (pattern & (1 << dir)) !== 0;
          if (constraint[dir] === REQUIRED_OPEN && !open) ok = false;
          if (constraint[dir] === REQUIRED_CLOSED && open) ok = false;
        }
        if (ok) candidates.push(pattern);
      }

      const nodeHere = nodeCellByKey.get(cellKey);
      const { biomeTag, index: pool } = poolByRegion[regionIndex];

      // ---- choose a variant ----
      let placed: { chunk: Chunk; orientation: Orientation } | null = null;
      for (const pattern of shuffled(rng, candidates)) {
        const variants = (pool.byPattern.get(pattern) ?? []).filter((v) => {
          if (nodeHere && !v.chunk.poiSlot) return false;
          // No-repeat is a HARD rule within a region (Gate 7).
          return !usedInRegion[regionIndex].has(orientationKey(v.chunk.id, v.orientation));
        });
        if (variants.length === 0) continue;

        placed = weightedPick(rng, variants, (v) => {
          // Soft without-replacement across the tier: a variant already used
          // in another region is discouraged, never forbidden.
          const uses = usedInTier.get(orientationKey(v.chunk.id, v.orientation)) ?? 0;
          const reuse = Math.pow(CHUNK_REUSE_WEIGHT_PENALTY, uses);
          // ...and strongly prefer the kernel's own biome over the common
          // fallback, so a region looks like the place it is named after.
          const biomeFit = v.chunk.biomeTag === biomeTag ? BIOME_MATCH_WEIGHT_BONUS : 1;
          return reuse * biomeFit;
        });
        break;
      }

      if (placed === null) {
        throw new Error(
          `spatial: FIXTURE COVERAGE GAP at cell (${cx},${cy}) in region ${tier.regions[regionIndex].id} ` +
            `(tier ${tier.tierIndex}). Needed an unused ${nodeHere ? "poi-slot " : ""}chunk matching one of ` +
            `${candidates.length} open-edge pattern(s) [${candidates.join(",")}], and the library had none ` +
            `left. This is an authoring gap, not a runtime condition — add chunks, or lower COARSE_GRID_SIZE.`,
        );
      }

      const key = orientationKey(placed.chunk.id, placed.orientation);
      usedInRegion[regionIndex].add(key);
      usedInTier.set(key, (usedInTier.get(key) ?? 0) + 1);

      // ---- record what this cell declared for each seam ----
      const oriented = orientChunk(placed.chunk, placed.orientation);
      for (let dir = 0; dir < 4; dir++) {
        seamOpen.set(seamKey(cx, cy, dir), oriented.connectors[DIR_EDGE_NAME[dir]].kind === "open");
      }

      // ---- stamp tiles ----
      for (let ty = 0; ty < CHUNK_SIZE; ty++) {
        for (let tx = 0; tx < CHUNK_SIZE; tx++) {
          const gx = cx * CHUNK_SIZE + tx;
          const gy = cy * CHUNK_SIZE + ty;
          mask.tiles[gy * mask.width + gx] = tileCodeOf(oriented.tiles[ty][tx]);
        }
      }

      chunks.push({
        cell: { cx, cy },
        regionIndex,
        chunkId: placed.chunk.id,
        orientation: placed.orientation,
        onBackbone: backbone.cells.has(cellKey),
        logicalNodeId: nodeHere?.logicalNodeId ?? null,
      });
    }
  }

  return { chunks, mask };
}
