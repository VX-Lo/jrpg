import type { Chunk, EdgeName, TileKind } from "../types.js";
import { EDGE_NAMES, isWalkable } from "../types.js";
import { CHUNK_SIZE, ROOM_CHUNK_SIZE } from "../../worldgen/config.js";

/**
 * Authoring-time validation for chunks. Every violation throws with the
 * chunk id, the field, and what was wrong — Phase 3's content-loader
 * discipline (fail loud at load, never at first use) applied to terrain.
 *
 * Two checks here carry the whole phase:
 *
 * 1. CONNECTOR HONESTY. A connector's `walkableTiles` must equal exactly
 *    the walkable offsets actually present on that edge. Over-declaring
 *    promises a passage that isn't there (softlock, Gate 1); under-
 *    declaring hides a passage that is (shortcut past a sealed border,
 *    Gate 2). Both directions are checked.
 *
 * 2. NO INTERIOR SEALED POCKET. Every walkable tile must reach one of the
 *    chunk's own open connectors. Given honesty, seams are provably
 *    connected, so the chunk interior is the ONLY place a pocket can
 *    form — checking it once here, at authoring time, is what makes the
 *    per-seed region-wide enclosure guarantee (Gate 3) cheap.
 */

export function expectedSizeForScale(scale: Chunk["scale"]): number {
  return scale === "room" ? ROOM_CHUNK_SIZE : CHUNK_SIZE;
}

/** The tile coordinates along one edge, in ascending offset order. */
function edgeCoords(edge: EdgeName, size: number): readonly (readonly [number, number])[] {
  const out: [number, number][] = [];
  for (let i = 0; i < size; i++) {
    if (edge === "north") out.push([i, 0]);
    else if (edge === "south") out.push([i, size - 1]);
    else if (edge === "west") out.push([0, i]);
    else out.push([size - 1, i]);
  }
  return out;
}

/** The offsets along `edge` that are actually walkable in `tiles`. */
export function actualWalkableOffsets(
  tiles: readonly (readonly TileKind[])[],
  edge: EdgeName,
  size: number,
): number[] {
  const out: number[] = [];
  edgeCoords(edge, size).forEach(([x, y], offset) => {
    if (isWalkable(tiles[y][x])) out.push(offset);
  });
  return out;
}

function sameOffsets(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Flood-fills a chunk's walkable tiles from every tile sitting on an open
 * connector. Returns the walkable tiles NOT reached.
 */
export function unreachableInteriorTiles(chunk: Chunk): [number, number][] {
  const { size, tiles } = chunk;
  const seen = new Set<string>();
  const queue: [number, number][] = [];

  for (const edge of EDGE_NAMES) {
    if (chunk.connectors[edge].kind !== "open") continue;
    const coords = edgeCoords(edge, size);
    for (const offset of chunk.connectors[edge].walkableTiles) {
      const [x, y] = coords[offset];
      const key = `${x},${y}`;
      if (!seen.has(key)) {
        seen.add(key);
        queue.push([x, y]);
      }
    }
  }

  while (queue.length > 0) {
    const [x, y] = queue.pop() as [number, number];
    const neighbours: [number, number][] = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of neighbours) {
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      if (!isWalkable(tiles[ny][nx])) continue;
      const key = `${nx},${ny}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }

  const unreached: [number, number][] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isWalkable(tiles[y][x]) && !seen.has(`${x},${y}`)) unreached.push([x, y]);
    }
  }
  return unreached;
}

/** Throws a descriptive Error on the first violation found. */
export function validateChunk(chunk: Chunk): void {
  const where = `chunk "${chunk.id}"`;

  const expected = expectedSizeForScale(chunk.scale);
  if (chunk.size !== expected) {
    throw new Error(`${where}: size ${chunk.size} !== ${expected} required for scale "${chunk.scale}"`);
  }
  if (chunk.tiles.length !== chunk.size) {
    throw new Error(`${where}: has ${chunk.tiles.length} rows, expected ${chunk.size}`);
  }
  chunk.tiles.forEach((row, y) => {
    if (row.length !== chunk.size) {
      throw new Error(`${where}: row ${y} has ${row.length} tiles, expected ${chunk.size}`);
    }
  });

  for (const edge of EDGE_NAMES) {
    const spec = chunk.connectors[edge];
    const actual = actualWalkableOffsets(chunk.tiles, edge, chunk.size);
    const declared = [...spec.walkableTiles].sort((a, b) => a - b);

    if (!sameOffsets(declared, [...spec.walkableTiles])) {
      throw new Error(`${where}: connector "${edge}" walkableTiles must be ascending, got [${spec.walkableTiles}]`);
    }
    for (const o of declared) {
      if (!Number.isInteger(o) || o < 0 || o >= chunk.size) {
        throw new Error(`${where}: connector "${edge}" offset ${o} out of range [0, ${chunk.size})`);
      }
    }
    if (spec.kind !== "open" && declared.length > 0) {
      throw new Error(
        `${where}: connector "${edge}" is kind "${spec.kind}" but declares walkable offsets [${declared}] — ` +
          `only "open" edges may be walkable`,
      );
    }
    if (spec.kind === "open" && declared.length === 0) {
      throw new Error(`${where}: connector "${edge}" is "open" but declares no walkable offsets — an open edge nothing can pass through is a lie`);
    }
    if (!sameOffsets(declared, actual)) {
      throw new Error(
        `${where}: connector "${edge}" DISHONEST — declares walkable offsets [${declared}] but the tile grid ` +
          `is actually walkable at [${actual}]. Connector specs must match their tiles exactly (see Deliverable 1).`,
      );
    }
  }

  const poiCount = chunk.tiles.flat().filter((t) => t === "poi").length;
  if (chunk.poiSlot && poiCount === 0) {
    throw new Error(`${where}: poiSlot is true but the chunk has no "poi" tile to host a logical node`);
  }
  if (!chunk.poiSlot && poiCount > 0) {
    throw new Error(`${where}: has ${poiCount} "poi" tile(s) but poiSlot is false`);
  }

  if (!chunk.enclosedDecorative) {
    const unreached = unreachableInteriorTiles(chunk);
    if (unreached.length > 0) {
      const sample = unreached.slice(0, 5).map(([x, y]) => `(${x},${y})`).join(", ");
      throw new Error(
        `${where}: SEALED INTERIOR POCKET — ${unreached.length} walkable tile(s) cannot reach any open ` +
          `connector, e.g. ${sample}. Either connect them, or set enclosed_decorative = true if the pocket ` +
          `is intentional decoration (NOT how hidden content works — see Chunk.enclosedDecorative).`,
      );
    }
  }
}
