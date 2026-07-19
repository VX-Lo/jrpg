import { createRng, type Rng } from "../rng/index.js";
import { worldgen } from "../worldgen/worldgen.js";
import type { ChunkLibrary, CoarseCell, TileMask } from "./types.js";
import { DIR_DELTA, UNOWNED_CELL, coarseKey, seamKey } from "./types.js";
import { scaleBiomeKey } from "./chunks/loader.js";
import { defaultChunkLibrary } from "./chunks/defaultLibrary.js";
import { buildVariantIndex, stitchGrid } from "./stitch.js";
import {
  ROOM_CHUNK_SIZE,
  INTERIOR_GRID_SIZE,
  INTERIOR_SEALED_CELL_CHANCE,
  CHUNK_REUSE_WEIGHT_PENALTY,
} from "../worldgen/config.js";
import type { PlacedChunk } from "./types.js";

/**
 * Deliverable 6 — the CLOSEST zoom, assembling real terrain.
 *
 * THE POINT OF THIS MODULE is to prove that "one stitching engine, four
 * scales" is a fact about the code rather than a claim about resemblance.
 * It shares `stitch.ts` verbatim with the far-zoom assembler while
 * differing in every parameter that could plausibly have been baked in:
 * a smaller tile size (ROOM_CHUNK_SIZE 8 vs CHUNK_SIZE 16), a different
 * chunk library (`room` vs `wilderness`), a different open-connector
 * profile (offsets 3-4 vs 6-9), a single owner instead of region blobs,
 * and one POI instead of many. If the engine had quietly depended on any
 * of those, this would not build.
 *
 * An interior is the inside of ONE logical node — an inn, a dungeon floor.
 * It is generated on demand from (seed, tierIndex, logicalNodeId) and,
 * like everything else here, is never stored.
 */

export interface InteriorSpace {
  readonly tierIndex: number;
  readonly logicalNodeId: string;
  readonly gridSize: number;
  readonly tileSize: number;
  /** The room you arrive in from the far zoom. */
  readonly entryCell: CoarseCell;
  /** The room holding this interior's point of interest. */
  readonly poiCell: CoarseCell;
  readonly backbone: ReadonlySet<string>;
  readonly chunks: readonly PlacedChunk[];
  readonly mask: TileMask;
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
 * Lays out which rooms exist and how they connect, before any chunk is
 * chosen — backbone-first, exactly as the far zoom does it, for exactly the
 * same reason: walkability is guaranteed by construction order rather than
 * validated afterwards.
 */
function planInterior(
  rng: Rng,
  gridSize: number,
): {
  sealed: Set<string>;
  requiredOpenSeams: Set<string>;
  backbone: Set<string>;
  entryCell: CoarseCell;
  poiCell: CoarseCell;
} {
  const allCells: CoarseCell[] = [];
  for (let cy = 0; cy < gridSize; cy++) {
    for (let cx = 0; cx < gridSize; cx++) allCells.push({ cx, cy });
  }

  const entryCell = allCells[rng.nextInt(allCells.length)];
  let poiCell = allCells[rng.nextInt(allCells.length)];
  // The POI must not sit on the entry, or arriving would be the whole room.
  if (poiCell.cx === entryCell.cx && poiCell.cy === entryCell.cy) {
    poiCell = allCells[(allCells.indexOf(poiCell) + 1) % allCells.length];
  }

  // ---- carve the entry -> POI spine FIRST ----
  //
  // Backbone-first, one scale down, and for the same reason the far zoom
  // does it: the guaranteed route is built before anything is allowed to
  // seal, so it cannot be blocked afterwards. Skipping this and merely
  // excluding the POI room from RANDOM sealing was not enough — the POI
  // could still be ringed by sealed rooms, left unreached by the spanning
  // tree, and then sealed by the unreachable-rooms fallback below. Gate 9
  // caught exactly that: a POI room with all four seams closed.
  const requiredOpenSeams = new Set<string>();
  const spine = new Set<string>([coarseKey(entryCell.cx, entryCell.cy)]);
  {
    let at = entryCell;
    // Walk x then y — any monotone path works; it only has to exist.
    while (at.cx !== poiCell.cx || at.cy !== poiCell.cy) {
      const dir =
        at.cx !== poiCell.cx ? (poiCell.cx > at.cx ? 1 : 3) : poiCell.cy > at.cy ? 2 : 0;
      const [dx, dy] = DIR_DELTA[dir];
      requiredOpenSeams.add(seamKey(at.cx, at.cy, dir));
      at = { cx: at.cx + dx, cy: at.cy + dy };
      spine.add(coarseKey(at.cx, at.cy));
    }
  }

  // Sealed rooms give an interior solid mass to have walls made of. Never
  // any room on the spine.
  const sealed = new Set<string>();
  for (const cell of allCells) {
    const key = coarseKey(cell.cx, cell.cy);
    if (spine.has(key)) continue;
    if (rng.nextFloat() < INTERIOR_SEALED_CELL_CHANCE) sealed.add(key);
  }

  // Spanning tree over every non-sealed room, grown from the spine, so all
  // of them are reachable and none is an island.
  const backbone = new Set<string>(spine);
  const frontier: CoarseCell[] = [...spine].map((key) => {
    const [cx, cy] = key.split(",").map(Number);
    return { cx, cy };
  });

  while (frontier.length > 0) {
    const at = frontier.shift() as CoarseCell;
    for (const dir of shuffled(rng, [0, 1, 2, 3])) {
      const [dx, dy] = DIR_DELTA[dir];
      const nx = at.cx + dx;
      const ny = at.cy + dy;
      if (nx < 0 || ny < 0 || nx >= gridSize || ny >= gridSize) continue;
      const key = coarseKey(nx, ny);
      if (sealed.has(key) || backbone.has(key)) continue;
      backbone.add(key);
      requiredOpenSeams.add(seamKey(at.cx, at.cy, dir));
      frontier.push({ cx: nx, cy: ny });
    }
  }

  // Any room the tree could not reach (walled off by sealed rooms) becomes
  // sealed itself — the same "linked or sealed, never an island" rule the
  // far zoom uses.
  for (const cell of allCells) {
    const key = coarseKey(cell.cx, cell.cy);
    if (!backbone.has(key)) sealed.add(key);
  }

  return { sealed, requiredOpenSeams, backbone, entryCell, poiCell };
}

/**
 * Builds the interior of one logical node.
 *
 * Pure in (seed, tierIndex, logicalNodeId): an interior does not depend on
 * whether the far-zoom terrain was built, on any other interior, or on any
 * other tier. Cold-depth applies here exactly as it does one scale up.
 */
export function embedInterior(
  seed: bigint | number | string,
  tierIndex: number,
  logicalNodeId: string,
  library: ChunkLibrary = defaultChunkLibrary(),
): InteriorSpace {
  const tier = worldgen(seed, tierIndex);
  const known = tier.regions.some((r) => r.nodes.some((n) => n.id === logicalNodeId));
  if (!known) {
    throw new Error(
      `spatial: tier ${tierIndex} has no logical node "${logicalNodeId}" — an interior can only be built ` +
        `for a node that exists in the tier.`,
    );
  }

  const root = createRng(seed);
  const gridSize = INTERIOR_GRID_SIZE;

  const layoutRng = root.substream(`spatial:tier:${tierIndex}:interior:${logicalNodeId}:layout`);
  const plan = planInterior(layoutRng, gridSize);

  const roomChunks = library.byScaleAndBiome.get(scaleBiomeKey("room", "common")) ?? [];
  if (roomChunks.length === 0) {
    throw new Error(
      `spatial: no chunks authored for scale "room" — the closest zoom has no library to stitch from.`,
    );
  }
  const pool = buildVariantIndex(roomChunks);

  const poiKey = coarseKey(plan.poiCell.cx, plan.poiCell.cy);
  const { chunks, mask } = stitchGrid({
    root,
    gridSize,
    tileSize: ROOM_CHUNK_SIZE,
    // Sealed rooms are still part of the space (they get a wall/vault
    // chunk); nothing is off-grid inside an interior.
    ownerAt: (cx, cy) => (cx < 0 || cy < 0 || cx >= gridSize || cy >= gridSize ? UNOWNED_CELL : 0),
    substreamKeyFor: (cx, cy) =>
      `spatial:tier:${tierIndex}:interior:${logicalNodeId}:chunks:${coarseKey(cx, cy)}`,
    poolFor: () => pool,
    affinityFor: () => 1,
    logicalNodeAt: (cx, cy) => (coarseKey(cx, cy) === poiKey ? logicalNodeId : null),
    requiredOpenSeams: plan.requiredOpenSeams,
    // Every seam touching a sealed room is closed from both sides.
    requiredClosedSeams: sealedSeams(plan.sealed, gridSize),
    backboneCells: plan.backbone,
    reusePenalty: CHUNK_REUSE_WEIGHT_PENALTY,
    describeCell: (cx, cy) => `interior of ${logicalNodeId} (tier ${tierIndex}, closest zoom) at (${cx},${cy})`,
  });

  return {
    tierIndex,
    logicalNodeId,
    gridSize,
    tileSize: ROOM_CHUNK_SIZE,
    entryCell: plan.entryCell,
    poiCell: plan.poiCell,
    backbone: plan.backbone,
    chunks,
    mask,
  };
}

function sealedSeams(sealed: ReadonlySet<string>, gridSize: number): Set<string> {
  const out = new Set<string>();
  for (const key of sealed) {
    const [cx, cy] = key.split(",").map(Number);
    for (let dir = 0; dir < DIR_DELTA.length; dir++) out.add(seamKey(cx, cy, dir));
  }
  void gridSize;
  return out;
}
