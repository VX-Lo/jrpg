import type { CoarseCell, SpatialTier, TileMask } from "./types.js";
import { TILE_CODE, UNOWNED_CELL, coarseKey, isWalkableCode } from "./types.js";
import { CHUNK_SIZE } from "../worldgen/config.js";

/**
 * Tile-level reachability queries. This is the module the walkability
 * gates reason with, so it stays deliberately dumb: plain 4-connected
 * flood fill over the mask, no knowledge of chunks, backbones or regions.
 * A gate that shared assumptions with the generator would not be a check.
 */

/** 4-connected flood fill over walkable tiles. Returns a visited bitmap. */
export function floodFill(mask: TileMask, starts: readonly number[]): Uint8Array {
  const visited = new Uint8Array(mask.tiles.length);
  const stack: number[] = [];

  for (const start of starts) {
    if (start < 0 || start >= mask.tiles.length) continue;
    if (!isWalkableCode(mask.tiles[start]) || visited[start]) continue;
    visited[start] = 1;
    stack.push(start);
  }

  while (stack.length > 0) {
    const at = stack.pop() as number;
    const x = at % mask.width;
    const y = (at - x) / mask.width;

    if (x + 1 < mask.width) tryVisit(at + 1);
    if (x - 1 >= 0) tryVisit(at - 1);
    if (y + 1 < mask.height) tryVisit(at + mask.width);
    if (y - 1 >= 0) tryVisit(at - mask.width);

    function tryVisit(next: number): void {
      if (visited[next] || !isWalkableCode(mask.tiles[next])) return;
      visited[next] = 1;
      stack.push(next);
    }
  }

  return visited;
}

/** Tile indices inside one coarse cell. */
export function tilesOfCell(mask: TileMask, cell: CoarseCell): number[] {
  const out: number[] = [];
  for (let ty = 0; ty < CHUNK_SIZE; ty++) {
    for (let tx = 0; tx < CHUNK_SIZE; tx++) {
      out.push((cell.cy * CHUNK_SIZE + ty) * mask.width + (cell.cx * CHUNK_SIZE + tx));
    }
  }
  return out;
}

/**
 * The tile a logical node physically occupies: the `poi` tile inside its
 * coarse cell. Assembly guarantees a node cell always holds a poi-slot
 * chunk, so a missing poi tile is a generator bug rather than a normal
 * outcome — hence the throw.
 */
export function poiTileOf(spatial: SpatialTier, logicalNodeId: string): number {
  const placement = spatial.placements.find((p) => p.logicalNodeId === logicalNodeId);
  if (!placement) throw new Error(`spatial: no placement for logical node ${logicalNodeId}`);

  for (const at of tilesOfCell(spatial.mask, placement.cell)) {
    if (spatial.mask.tiles[at] === TILE_CODE.poi) return at;
  }
  throw new Error(
    `spatial: node ${logicalNodeId} sits in cell (${placement.cell.cx},${placement.cell.cy}) but that ` +
      `cell's chunk has no poi tile — assembly placed a non-poi chunk on a node cell.`,
  );
}

/** Is there a walkable tile-path between two tiles? */
export function tilePathExists(mask: TileMask, from: number, to: number): boolean {
  if (!isWalkableCode(mask.tiles[from]) || !isWalkableCode(mask.tiles[to])) return false;
  return floodFill(mask, [from])[to] === 1;
}

/** Which region owns the coarse cell a tile falls in, or UNOWNED_CELL. */
export function regionOfTile(spatial: SpatialTier, at: number): number {
  const x = at % spatial.mask.width;
  const y = (at - x) / spatial.mask.width;
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  const { blobs } = spatial;
  if (cx < 0 || cy < 0 || cx >= blobs.gridSize || cy >= blobs.gridSize) return UNOWNED_CELL;
  return blobs.owner[cy * blobs.gridSize + cx];
}

/**
 * Every ordered pair of region indices that are joined by at least one
 * walkable tile adjacency — i.e. regions the player can physically step
 * between WITHOUT passing through a third region.
 *
 * This is the measurement Gate 2 asserts against. It works purely from the
 * tile mask, so it cannot inherit the assembler's belief about which seams
 * it sealed; if assembly leaked a walkable seam, this finds it.
 */
export function physicallyTouchingRegionPairs(spatial: SpatialTier): Set<string> {
  const pairs = new Set<string>();
  const { mask } = spatial;

  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const at = y * mask.width + x;
      if (!isWalkableCode(mask.tiles[at])) continue;
      const here = regionOfTile(spatial, at);
      if (here === UNOWNED_CELL) continue;

      for (const next of [x + 1 < mask.width ? at + 1 : -1, y + 1 < mask.height ? at + mask.width : -1]) {
        if (next < 0 || !isWalkableCode(mask.tiles[next])) continue;
        const other = regionOfTile(spatial, next);
        if (other === UNOWNED_CELL || other === here) continue;
        pairs.add(here < other ? `${here}|${other}` : `${other}|${here}`);
      }
    }
  }

  return pairs;
}

/** Walkable tiles NOT reachable from the backbone, excluding intentionally-enclosed chunks. */
export function unreachableWalkableTiles(spatial: SpatialTier, enclosedChunkIds: ReadonlySet<string>): number[] {
  const { mask } = spatial;

  const starts: number[] = [];
  for (const placed of spatial.chunks) {
    if (!spatial.backbone.has(coarseKey(placed.cell.cx, placed.cell.cy))) continue;
    for (const at of tilesOfCell(mask, placed.cell)) {
      if (isWalkableCode(mask.tiles[at])) starts.push(at);
    }
  }

  const visited = floodFill(mask, starts);

  // Tiles inside a chunk flagged intentionally-enclosed are exempt — that
  // flag is the one carve-out Gate 3 honours.
  const exempt = new Uint8Array(mask.tiles.length);
  for (const placed of spatial.chunks) {
    if (!enclosedChunkIds.has(placed.chunkId)) continue;
    for (const at of tilesOfCell(mask, placed.cell)) exempt[at] = 1;
  }

  const out: number[] = [];
  for (let at = 0; at < mask.tiles.length; at++) {
    if (isWalkableCode(mask.tiles[at]) && !visited[at] && !exempt[at]) out.push(at);
  }
  return out;
}
