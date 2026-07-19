import type { Rng } from "../rng/index.js";
import type { Chunk, Orientation, PlacedChunk, TileMask } from "./types.js";
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

/**
 * THE STITCHING ENGINE — scale-agnostic.
 *
 * Roadmap §16b claims "same stitching engine at every scale except
 * farthest". This module is what makes that literally true rather than
 * aspirational: `assembleTier` (far zoom, wilderness chunks, region blobs)
 * and `embedInterior` (closest zoom, room chunks, a single small space)
 * are both thin adapters over this one function. If they had been written
 * as two similar loops, "one engine" would have been a claim about
 * resemblance instead of a fact about the code, and they would have
 * drifted the first time either was fixed.
 *
 * THE SOLVE IS A SINGLE ROW-MAJOR PASS WITH NO BACKTRACKING, and that is a
 * property of the chunk library rather than a gamble. Row-major order means
 * a cell's NORTH and WEST seams are already fixed by placed neighbours,
 * while its EAST and SOUTH seams are still free for it to choose. Provided
 * the library covers all 16 open-edge patterns, whatever the two fixed
 * seams demand, some pattern satisfies it — so a cell can always be filled
 * and a later cell can always match what an earlier one chose. WFC-style
 * propagation and backtracking would both be machinery for a problem the
 * ordering removes.
 *
 * Seam states, in precedence order:
 *   1. required-open (backbone or corridor)  → MUST be open
 *   2. required-closed (enclave)             → MUST be sealed
 *   3. neighbour already placed              → must equal what it declared
 *   4. different owner, or off-grid          → MUST be sealed
 *   5. otherwise                             → free, chosen with a seeded roll
 *
 * If no chunk fits, that is a FIXTURE COVERAGE GAP and it throws with the
 * details. It is never papered over — silently degrading to a solid chunk
 * would break walkability quietly, which is the one failure mode this
 * phase exists to prevent.
 */

const REQUIRED_OPEN = 1;
const REQUIRED_CLOSED = 2;
const FREE = 0;

/** Every (chunk, orientation) variant, grouped by its open-edge bitmask. */
export interface VariantIndex {
  readonly byPattern: Map<number, { chunk: Chunk; orientation: Orientation }[]>;
}

export function buildVariantIndex(chunks: readonly Chunk[]): VariantIndex {
  const byPattern = new Map<number, { chunk: Chunk; orientation: Orientation }[]>();
  for (const chunk of chunks) {
    for (const orientation of ALL_ORIENTATIONS) {
      const oriented = orientChunk(chunk, orientation);
      const pattern = DIR_EDGE_NAME.reduce(
        (mask, edge, d) => (oriented.connectors[edge].kind === "open" ? mask | (1 << d) : mask),
        0,
      );
      const bucket = byPattern.get(pattern);
      if (bucket) bucket.push({ chunk, orientation });
      else byPattern.set(pattern, [{ chunk, orientation }]);
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

/** Deterministic shuffle. */
function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Everything the stitcher needs, with nothing specific to tiers, regions
 * or zoom levels in it.
 *
 * `ownerAt` doubles as the space's shape: a cell returning UNOWNED_CELL is
 * simply not part of this space and is left impassable. At far zoom owners
 * are region indices; in an interior there is a single owner, 0.
 */
export interface StitchRequest {
  readonly root: Rng;
  readonly gridSize: number;
  readonly tileSize: number;
  ownerAt(cx: number, cy: number): number;
  /** Substream key for one cell's placement draw. Must be unique per cell. */
  substreamKeyFor(cx: number, cy: number, owner: number): string;
  poolFor(owner: number): VariantIndex;
  /** Selection weight for a variant beyond the shared reuse penalty (biome fit, etc). */
  affinityFor(owner: number, chunk: Chunk): number;
  logicalNodeAt(cx: number, cy: number): string | null;
  readonly requiredOpenSeams: ReadonlySet<string>;
  readonly requiredClosedSeams: ReadonlySet<string>;
  readonly backboneCells: ReadonlySet<string>;
  /** Reuse penalty exponent base, applied per prior use across the whole space. */
  readonly reusePenalty: number;
  /** Human-readable context for the fixture-gap error. */
  describeCell(cx: number, cy: number, owner: number): string;
}

export interface StitchResult {
  readonly chunks: readonly PlacedChunk[];
  readonly mask: TileMask;
}

export function stitchGrid(request: StitchRequest): StitchResult {
  const { gridSize, tileSize } = request;

  const chunks: PlacedChunk[] = [];
  /** No-repeat is a HARD rule per owner (a region, or one interior). */
  const usedByOwner = new Map<number, Set<string>>();
  const usedGlobally = new Map<string, number>();
  const seamOpen = new Map<string, boolean>();

  const mask: TileMask = {
    width: gridSize * tileSize,
    height: gridSize * tileSize,
    tiles: new Uint8Array(gridSize * tileSize * gridSize * tileSize).fill(TILE_CODE.impassable),
  };

  for (let cy = 0; cy < gridSize; cy++) {
    for (let cx = 0; cx < gridSize; cx++) {
      const owner = request.ownerAt(cx, cy);
      // Not part of this space — the mask is already impassable here.
      if (owner === UNOWNED_CELL) continue;

      const cellKey = coarseKey(cx, cy);
      const rng = request.root.substream(request.substreamKeyFor(cx, cy, owner));

      // ---- resolve the four seam constraints ----
      const constraint = [FREE, FREE, FREE, FREE];
      for (let dir = 0; dir < 4; dir++) {
        const [dx, dy] = DIR_DELTA[dir];
        const seam = seamKey(cx, cy, dir);
        const neighbourOwner = request.ownerAt(cx + dx, cy + dy);

        if (request.requiredOpenSeams.has(seam)) {
          constraint[dir] = REQUIRED_OPEN;
        } else if (request.requiredClosedSeams.has(seam)) {
          constraint[dir] = REQUIRED_CLOSED;
        } else if (neighbourOwner === UNOWNED_CELL || neighbourOwner !== owner) {
          // Seams onto a different owner that are not sanctioned corridors,
          // and every seam off the edge of the space, are sealed. THIS is
          // the line that makes the anti-shortcut gate hold.
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

      const logicalNodeId = request.logicalNodeAt(cx, cy);
      const pool = request.poolFor(owner);
      let used = usedByOwner.get(owner);
      if (!used) {
        used = new Set<string>();
        usedByOwner.set(owner, used);
      }

      // ---- choose a variant ----
      let placed: { chunk: Chunk; orientation: Orientation } | null = null;
      for (const pattern of shuffled(rng, candidates)) {
        const variants = (pool.byPattern.get(pattern) ?? []).filter((v) => {
          // The poi-slot match is SYMMETRIC. A node cell obviously needs a
          // chunk that can host one — but a cell with no node must equally
          // not receive a poi chunk, or its `poi` tiles would sit in the
          // world as location markers pointing at nothing. `poiTileOf`
          // would still find the right tile (it searches the node's own
          // cell), so this never broke walkability; it read wrong, which is
          // its own kind of wrong for a debug dump and for Phase 10.
          if (v.chunk.poiSlot !== (logicalNodeId !== null)) return false;
          return !(used as Set<string>).has(orientationKey(v.chunk.id, v.orientation));
        });
        if (variants.length === 0) continue;

        placed = weightedPick(rng, variants, (v) => {
          const uses = usedGlobally.get(orientationKey(v.chunk.id, v.orientation)) ?? 0;
          return Math.pow(request.reusePenalty, uses) * request.affinityFor(owner, v.chunk);
        });
        break;
      }

      if (placed === null) {
        throw new Error(
          `spatial: FIXTURE COVERAGE GAP at cell (${cx},${cy}) — ${request.describeCell(cx, cy, owner)}. ` +
            `Needed an unused ${logicalNodeId !== null ? "poi-slot " : ""}chunk matching one of ` +
            `${candidates.length} open-edge pattern(s) [${candidates.join(",")}], and the pool had none left. ` +
            `This is an authoring gap, not a runtime condition — add chunks, or shrink the grid.`,
        );
      }

      const key = orientationKey(placed.chunk.id, placed.orientation);
      used.add(key);
      usedGlobally.set(key, (usedGlobally.get(key) ?? 0) + 1);

      // ---- record what this cell declared for each seam ----
      const oriented = orientChunk(placed.chunk, placed.orientation);
      for (let dir = 0; dir < 4; dir++) {
        seamOpen.set(seamKey(cx, cy, dir), oriented.connectors[DIR_EDGE_NAME[dir]].kind === "open");
      }

      // ---- stamp tiles ----
      for (let ty = 0; ty < tileSize; ty++) {
        for (let tx = 0; tx < tileSize; tx++) {
          const gx = cx * tileSize + tx;
          const gy = cy * tileSize + ty;
          mask.tiles[gy * mask.width + gx] = tileCodeOf(oriented.tiles[ty][tx]);
        }
      }

      chunks.push({
        cell: { cx, cy },
        regionIndex: owner,
        chunkId: placed.chunk.id,
        orientation: placed.orientation,
        onBackbone: request.backboneCells.has(cellKey),
        logicalNodeId,
      });
    }
  }

  return { chunks, mask };
}
