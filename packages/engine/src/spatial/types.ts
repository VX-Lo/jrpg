/**
 * Phase 4.5 — spatial embedding types.
 *
 * THE CENTRAL FENCE: nothing in this module may be imported by
 * `questgraph/`. Terrain conforms to the quest graph; the graph never
 * bends to the terrain. Everything here READS Phase 2's `Tier` and
 * Phase 4's `TierQuestGraph` and writes neither.
 */

import type { Tier } from "../worldgen/types.js";

// ---------------------------------------------------------------------
// Tiles and chunks (Deliverable 1)
// ---------------------------------------------------------------------

/**
 * What a single tile is, for movement purposes.
 *
 * Deliberately only three kinds. Flavour (is this wall a cliff or a
 * hedge?) lives on the CONNECTOR spec and the biome tag, not here —
 * walkability is the only property the gates reason about, and keeping
 * the movement vocabulary this small is what makes the flood-fill
 * arguments in Gates 1-3 simple enough to trust.
 */
export type TileKind =
  /** Traversable on foot. */
  | "walkable"
  /** Not traversable. Rendered per biome (rock, water, void) — Phase 10's problem. */
  | "impassable"
  /** Walkable AND able to host a logical node's physical location. */
  | "poi";

export const WALKABLE_TILE_KINDS: readonly TileKind[] = ["walkable", "poi"];

export function isWalkable(kind: TileKind): boolean {
  return kind === "walkable" || kind === "poi";
}

/** Which side of a chunk a connector describes. */
export type EdgeName = "north" | "east" | "south" | "west";

export const EDGE_NAMES: readonly EdgeName[] = ["north", "east", "south", "west"];

/**
 * What an edge of a chunk IS. `open` is the only kind that may carry
 * walkable tiles; `wall`/`water`/`cliff` are all impassable-on-foot and
 * differ only in how they will eventually be drawn.
 */
export type ConnectorKind = "open" | "wall" | "water" | "cliff";

/**
 * The honest description of one chunk edge.
 *
 * HONESTY IS THE INVARIANT EVERYTHING ELSE RESTS ON. `walkableTiles` must
 * list EXACTLY the offsets along this edge that are walkable in `tiles` —
 * no more (which would promise a passage that doesn't exist, producing a
 * softlock) and no fewer (which would hide a passage that does exist,
 * producing a shortcut past a sealed border). Both failure directions map
 * onto a Phase 4.5 gate, which is why this is validated loudly at load
 * rather than trusted.
 *
 * Two chunks match at a seam IFF their shared edge's walkable offsets are
 * identical. Given honesty, any walkable tile at a matched seam is
 * provably connected to its neighbour — so the only place a sealed pocket
 * can form is inside a single chunk's interior, checked once at authoring
 * time (see validateChunk) rather than per seed.
 */
export interface ConnectorSpec {
  readonly kind: ConnectorKind;
  /** Tile offsets along this edge that are walkable, ascending. Empty for every non-`open` kind. */
  readonly walkableTiles: readonly number[];
}

export type ChunkConnectors = { readonly [E in EdgeName]: ConnectorSpec };

/**
 * Which zoom scale's library a chunk belongs to. One stitching engine
 * serves all of them (roadmap §16b); only the library and the tile size
 * differ.
 */
export type ChunkScale = "wilderness" | "settlement" | "room";

/** An authored tile block. Immutable content, loaded from TOML. */
export interface Chunk {
  readonly id: string;
  /** Matches a kernel's biome. Chunks are only placed in a region whose kernel declares this biome. */
  readonly biomeTag: string;
  readonly scale: ChunkScale;
  /** Edge length in tiles. CHUNK_SIZE for wilderness/settlement, ROOM_CHUNK_SIZE for room. */
  readonly size: number;
  /** `tiles[y][x]`, y ascending southward. */
  readonly tiles: readonly (readonly TileKind[])[];
  readonly connectors: ChunkConnectors;
  /** May this chunk host a logical node? Requires at least one `poi` tile. */
  readonly poiSlot: boolean;
  /**
   * Opt-in exemption from the no-sealed-pocket rule: this chunk contains
   * decorative terrain that is walkable but deliberately unreachable from
   * its own connectors (a walled garden seen from outside, an island in a
   * lake). Gate 3 exempts tiles in these chunks.
   *
   * NOTE this is NOT how hidden/secret content works. Per roadmap §16b, a
   * hidden vault is a normally-connected patch with a LOCK on entry
   * (Phase 4's "locks gate usability, not traversal", reused exactly) —
   * secrecy lives one layer up, so the walkable graph stays
   * unconditionally connected. This flag is for pure decoration only.
   */
  readonly enclosedDecorative: boolean;
}

/**
 * One of the 8 dihedral orientations, derived programmatically — never
 * authored 8 times over.
 *
 * `rotationQuarters` is clockwise quarter-turns. `mirrored` flips
 * horizontally BEFORE rotating; that order is fixed so an
 * (id, orientation) pair names exactly one tile arrangement, which the
 * no-repeat gate depends on.
 */
export interface Orientation {
  readonly rotationQuarters: 0 | 1 | 2 | 3;
  readonly mirrored: boolean;
}

/** All 8 dihedral orientations, in a fixed canonical order. */
export const ALL_ORIENTATIONS: readonly Orientation[] = [
  { rotationQuarters: 0, mirrored: false },
  { rotationQuarters: 1, mirrored: false },
  { rotationQuarters: 2, mirrored: false },
  { rotationQuarters: 3, mirrored: false },
  { rotationQuarters: 0, mirrored: true },
  { rotationQuarters: 1, mirrored: true },
  { rotationQuarters: 2, mirrored: true },
  { rotationQuarters: 3, mirrored: true },
];

/** A chunk transformed into a concrete orientation. Tiles and connectors move together. */
export interface OrientedChunk {
  readonly chunkId: string;
  readonly orientation: Orientation;
  readonly size: number;
  readonly tiles: readonly (readonly TileKind[])[];
  readonly connectors: ChunkConnectors;
  readonly poiSlot: boolean;
  readonly enclosedDecorative: boolean;
}

/** Stable key for "this chunk in this orientation" — the unit the no-repeat rule counts. */
export function orientationKey(chunkId: string, o: Orientation): string {
  return `${chunkId}@r${o.rotationQuarters}${o.mirrored ? "m" : ""}`;
}

/** A loaded chunk library, indexed for the queries assembly makes. */
export interface ChunkLibrary {
  readonly all: readonly Chunk[];
  readonly byId: ReadonlyMap<string, Chunk>;
  /** `${scale}|${biomeTag}` → chunks. The lookup assembly actually performs. */
  readonly byScaleAndBiome: ReadonlyMap<string, readonly Chunk[]>;
}

// ---------------------------------------------------------------------
// Coarse grid, regions, and the embedded tier (Deliverables 2-5)
// ---------------------------------------------------------------------

/** A cell on the tier's coarse chunk-grid. One cell holds exactly one chunk. */
export interface CoarseCell {
  readonly cx: number;
  readonly cy: number;
}

export function coarseKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/**
 * Ownership of one coarse cell after Voronoi assignment + CA smoothing.
 * `regionIndex` is an index into `Tier.regions`, or -1 for the impassable
 * outer boundary of the tier canvas.
 */
export const UNOWNED_CELL = -1;

/**
 * Coarse-cell ownership grid. The buffer type is pinned to `ArrayBuffer`
 * (rather than the default `ArrayBufferLike`) so grids can be passed
 * between the transform passes in voronoi.ts without variance errors.
 */
export type OwnerGrid = Int8Array<ArrayBuffer>;

/** Deliverable 2's output: which region owns each coarse cell. */
export interface RegionBlobs {
  readonly gridSize: number;
  /** Row-major `owner[cy * gridSize + cx]`, an index into Tier.regions or UNOWNED_CELL. */
  readonly owner: OwnerGrid;
  /** The Voronoi seed cell each region was grown from. Parallel to Tier.regions. */
  readonly seeds: readonly CoarseCell[];
}

/**
 * Deliverable 3's output: how each geometrically-adjacent pair of blobs
 * behaves physically.
 *
 * `corridors` holds the cell pairs where a walkable seam is carved,
 * because Phase 2's region-adjacency graph has an edge there. Every other
 * touching pair is SEALED — that is the anti-shortcut direction, and it is
 * the half of the contract that is easy to forget.
 */
export interface BorderPlan {
  /** Region-index pairs (lo,hi) that touch geometrically AND have a Tier.regionEdges edge. */
  readonly connectedPairs: ReadonlySet<string>;
  /** Region-index pairs (lo,hi) that touch geometrically but have NO edge — physically sealed. */
  readonly sealedPairs: ReadonlySet<string>;
  /** Coarse cells carrying a carved corridor, keyed `cx,cy`. */
  readonly corridorCells: ReadonlySet<string>;
  /**
   * The specific coarse-grid seams a corridor cuts through, as canonical
   * edge keys. THE ONLY inter-region seams permitted to be walkable —
   * assembly forces every other cross-region seam closed, which is what
   * makes the anti-shortcut gate hold by construction rather than by luck.
   */
  readonly corridorEdges: ReadonlySet<string>;
}

/** Direction indices used for coarse-grid edges. */
export const DIR_N = 0;
export const DIR_E = 1;
export const DIR_S = 2;
export const DIR_W = 3;
export const DIR_DELTA: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** The EdgeName a direction index corresponds to, for connector lookup. */
export const DIR_EDGE_NAME: readonly EdgeName[] = ["north", "east", "south", "west"];

/**
 * Canonical key for the seam between a cell and its neighbour in `dir`.
 *
 * Normalised so both sides of a seam produce the SAME key — a seam is one
 * shared thing, and letting each side key it independently is how a border
 * ends up open from one side and sealed from the other.
 */
export function seamKey(cx: number, cy: number, dir: number): string {
  if (dir === DIR_N) return `${cx},${cy - 1}|S`;
  if (dir === DIR_W) return `${cx - 1},${cy}|E`;
  return `${cx},${cy}|${dir === DIR_E ? "E" : "S"}`;
}

export function regionPairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Where a Phase 4 logical node physically lives. */
export interface NodePlacement {
  readonly logicalNodeId: string;
  readonly regionIndex: number;
  readonly cell: CoarseCell;
  /**
   * The boss node doubles as the exit to tier N+1 (roadmap §16b) — no
   * separate transition-node type exists. Phase 5 resolves the fight;
   * this only models the property.
   */
  readonly isExit: boolean;
}

/** What got placed in one coarse cell. */
export interface PlacedChunk {
  readonly cell: CoarseCell;
  readonly regionIndex: number;
  readonly chunkId: string;
  readonly orientation: Orientation;
  /** True if this cell is on the guaranteed-walkable backbone. */
  readonly onBackbone: boolean;
  /** The logical node hosted here, if any. */
  readonly logicalNodeId: string | null;
}

/**
 * The assembled tile mask for a whole tier at one zoom scale, flattened.
 * A typed array rather than nested arrays because the gates flood-fill
 * this across 1000+ seeds.
 */
export interface TileMask {
  readonly width: number;
  readonly height: number;
  /** Row-major, one TileKind code per tile. See TILE_CODE. */
  readonly tiles: Uint8Array;
}

export const TILE_CODE = { impassable: 0, walkable: 1, poi: 2 } as const;

export function tileCodeOf(kind: TileKind): number {
  return TILE_CODE[kind];
}

export function isWalkableCode(code: number): boolean {
  return code !== TILE_CODE.impassable;
}

/** The four zoom scales (roadmap §16b, Deliverable 6). */
export type ZoomScale = "farthest" | "far" | "medium" | "closest";

/**
 * A tier embedded into physical space. The output of `embedTier`.
 *
 * Pure derived data — never stored (rule 2). A tier's terrain does not
 * exist until `embedTier(seed, tierIndex)` is called, and calling it for
 * tier N reads nothing whatsoever from tier N±1 (rule 3, cold-depth).
 */
export interface SpatialTier {
  readonly tierIndex: number;
  readonly seed: bigint;
  readonly blobs: RegionBlobs;
  readonly borders: BorderPlan;
  readonly placements: readonly NodePlacement[];
  /** Coarse cells that must stay walkable-through, keyed `cx,cy`. */
  readonly backbone: ReadonlySet<string>;
  readonly chunks: readonly PlacedChunk[];
  readonly mask: TileMask;
  /**
   * Cosmetic decoration variant per tile, parallel to `mask.tiles`. A
   * SEPARATE layer on purpose: decoration must never be able to alter
   * walkability after the backbone guarantees have been established.
   */
  readonly decor: Uint8Array;
  /**
   * Which region's PALETTE each tile is drawn with (Deliverable 4). Equals
   * blob ownership everywhere except inside a corridor's blend strip,
   * where the two regions' palettes interpolate. Data for Phase 10, not
   * pixels.
   */
  readonly visualRegion: Uint8Array;
  /** The logical node that is this tier's exit to tier N+1. */
  readonly exitNodeId: string;
}

/** Convenience bundle so callers don't re-run worldgen to interpret a SpatialTier. */
export interface EmbeddedTier {
  readonly tier: Tier;
  readonly spatial: SpatialTier;
}
