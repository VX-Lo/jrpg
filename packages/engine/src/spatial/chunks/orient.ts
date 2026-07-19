import type {
  Chunk,
  ChunkConnectors,
  ConnectorSpec,
  Orientation,
  OrientedChunk,
  TileKind,
} from "../types.js";

/**
 * Derives a chunk's 8 dihedral orientations programmatically. Authoring
 * 8 copies of a chunk would be 8 chances to make them disagree; deriving
 * them means the connector spec can only ever be as honest (or as wrong)
 * as the one authored original, which validation already checked.
 *
 * Convention, fixed so `(chunkId, orientation)` names exactly one tile
 * arrangement (the no-repeat gate counts these): MIRROR FIRST (horizontal
 * flip), THEN rotate clockwise by `rotationQuarters`.
 */

type Grid = readonly (readonly TileKind[])[];

/** Reverses offsets along an edge whose direction flips under a transform. */
function reflectOffsets(offsets: readonly number[], size: number): number[] {
  return offsets.map((o) => size - 1 - o).sort((a, b) => a - b);
}

function reflectConnector(c: ConnectorSpec, size: number): ConnectorSpec {
  return { kind: c.kind, walkableTiles: reflectOffsets(c.walkableTiles, size) };
}

/** Horizontal flip: x → size-1-x. */
function mirrorGrid(tiles: Grid, size: number): TileKind[][] {
  const out: TileKind[][] = [];
  for (let y = 0; y < size; y++) {
    const row: TileKind[] = [];
    for (let x = 0; x < size; x++) row.push(tiles[y][size - 1 - x]);
    out.push(row);
  }
  return out;
}

function mirrorConnectors(c: ChunkConnectors, size: number): ChunkConnectors {
  // A horizontal flip reverses the horizontal edges (north/south) in place
  // and swaps the vertical ones (east/west) without changing their offsets,
  // since a tile's y is untouched.
  return {
    north: reflectConnector(c.north, size),
    south: reflectConnector(c.south, size),
    east: c.west,
    west: c.east,
  };
}

/** One clockwise quarter-turn: new[y][x] = old[size-1-x][y]. */
function rotateGridCw(tiles: Grid, size: number): TileKind[][] {
  const out: TileKind[][] = [];
  for (let y = 0; y < size; y++) {
    const row: TileKind[] = [];
    for (let x = 0; x < size; x++) row.push(tiles[size - 1 - x][y]);
    out.push(row);
  }
  return out;
}

function rotateConnectorsCw(c: ChunkConnectors, size: number): ChunkConnectors {
  // Derived from the tile map above: a north-edge tile (x,0) lands at
  // (size-1, x) — the east edge, at the same offset. An east-edge tile
  // (size-1,y) lands at (size-1-y, size-1) — the south edge, reversed.
  return {
    east: c.north,
    south: reflectConnector(c.east, size),
    west: c.south,
    north: reflectConnector(c.west, size),
  };
}

/** Applies an orientation to a chunk. */
export function orientChunk(chunk: Chunk, orientation: Orientation): OrientedChunk {
  const size = chunk.size;
  let tiles: Grid = chunk.tiles;
  let connectors: ChunkConnectors = chunk.connectors;

  if (orientation.mirrored) {
    tiles = mirrorGrid(tiles, size);
    connectors = mirrorConnectors(connectors, size);
  }
  for (let q = 0; q < orientation.rotationQuarters; q++) {
    tiles = rotateGridCw(tiles, size);
    connectors = rotateConnectorsCw(connectors, size);
  }

  return {
    chunkId: chunk.id,
    orientation,
    size,
    tiles,
    connectors,
    poiSlot: chunk.poiSlot,
    enclosedDecorative: chunk.enclosedDecorative,
  };
}
