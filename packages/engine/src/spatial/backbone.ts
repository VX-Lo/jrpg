import type { Rng } from "../rng/index.js";
import type { Tier } from "../worldgen/types.js";
import type { BorderPlan, CoarseCell, NodePlacement, RegionBlobs } from "./types.js";
import { DIR_DELTA, coarseKey, seamKey } from "./types.js";
import { cellsOfRegion, ownerAt } from "./voronoi.js";
import { ENCLAVE_CHANCE } from "../worldgen/config.js";

/**
 * Deliverable 5, steps 1-2 — logical nodes into coarse cells, then the
 * walkable BACKBONE built before any chunk is chosen.
 *
 * This is the phase's central correctness move, and the third time the
 * project has used it: Phase 2 got reachability from a spanning tree,
 * Phase 4 got deadlock-freedom from staged reservation, and Phase 4.5 gets
 * walkability from construction ORDER. The backbone — every cell that must
 * be walkable-through — is computed first, from the logical structure
 * alone. Chunk selection then treats it as a hard constraint it must
 * satisfy, so there is no stitch-then-hope-it's-walkable step and no
 * validate-and-retry loop. Gate 1 confirms empirically what the order
 * already guarantees.
 */

export interface Backbone {
  /**
   * Coarse cells the backbone proper runs through — the skeleton linking
   * logical nodes and corridors. Deliberately NARROW: it is what Gate 3
   * flood-fills from, so padding it with every cell would make that gate
   * vacuous.
   */
  readonly cells: ReadonlySet<string>;
  /**
   * Seams that MUST be walkable, as canonical seam keys. Assembly may only
   * place a chunk whose connectors are open on every one of these.
   *
   * Covers the backbone itself PLUS a link from every non-enclave cell
   * back into it. Without those links, off-backbone cells could open onto
   * each other and form a walkable island with no route to anywhere —
   * which is exactly what Gate 3 caught before this existed.
   */
  readonly requiredOpenSeams: ReadonlySet<string>;
  /**
   * Seams that MUST be sealed: every seam touching an enclave cell.
   *
   * An enclave is an off-backbone cell chosen to be terrain you look at
   * rather than walk through. It only stays honest if its neighbours also
   * refuse to open onto it, so the constraint has to be recorded on the
   * seam, not just on the cell.
   */
  readonly requiredClosedSeams: ReadonlySet<string>;
  /** Cells deliberately left unreachable (solid or enclosed-decorative terrain). */
  readonly enclaves: ReadonlySet<string>;
}

/**
 * Assigns each of a region's logical nodes its own coarse cell.
 *
 * Spread with the same best-candidate approach used for Voronoi seeds: a
 * plain shuffle clusters nodes by chance, and two cities sharing a corner
 * of the map reads as a generation artefact rather than a world. One cell
 * per node is a hard requirement — cells are the unit a chunk occupies, so
 * two nodes in one cell would mean two cities inside one 16x16 chunk.
 */
export function placeLogicalNodes(root: Rng, tier: Tier, blobs: RegionBlobs): NodePlacement[] {
  const placements: NodePlacement[] = [];

  tier.regions.forEach((region, regionIndex) => {
    const rng = root.substream(`spatial:tier:${tier.tierIndex}:region:${regionIndex}:backbone`);
    const available = cellsOfRegion(blobs, regionIndex);

    if (available.length < region.nodes.length) {
      // The territory floor in voronoi.ts exists precisely to stop this.
      throw new Error(
        `spatial: region ${region.id} owns ${available.length} coarse cells but hosts ` +
          `${region.nodes.length} logical nodes — the territory floor failed to hold. ` +
          `Raise COARSE_GRID_SIZE or REGION_CELL_SLACK.`,
      );
    }

    /** How many orthogonal neighbours of a cell belong to the same region. */
    const interiorDegree = (cell: CoarseCell): number =>
      DIR_DELTA.filter(([dx, dy]) => ownerAt(blobs, cell.cx + dx, cell.cy + dy) === regionIndex).length;

    const taken: CoarseCell[] = [];
    for (const node of region.nodes) {
      let best: CoarseCell | null = null;
      let bestScore = -Infinity;
      // Sample candidates and score by how WELL-CONNECTED the cell is
      // first, then by distance from nodes already placed.
      //
      // Connectivity dominates for two reasons that happen to agree. The
      // design one: a city or dungeon mouth belongs on ground with several
      // approaches, not at the end of a spur — a node on a cell with three
      // sealed sides reads as an accident. The mechanical one: such a cell
      // is FULLY constrained, admitting exactly one legal open-edge
      // pattern, so it can only be filled from the handful of poi chunks
      // with that exact pattern. Several nodes landing on edge cells
      // exhausted the fixture library outright. Preferring interior cells
      // fixes the aesthetics and relieves the constraint pressure at once.
      for (let attempt = 0; attempt < 24; attempt++) {
        const candidate = available[rng.nextInt(available.length)];
        if (taken.some((t) => t.cx === candidate.cx && t.cy === candidate.cy)) continue;
        const clearance =
          taken.length === 0
            ? available.length
            : Math.min(...taken.map((t) => Math.abs(t.cx - candidate.cx) + Math.abs(t.cy - candidate.cy)));
        const score = interiorDegree(candidate) * 10 + Math.min(clearance, 8);
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      if (best === null) {
        // Sampling missed; fall back to the first free cell in scan order.
        best = available.find((c) => !taken.some((t) => t.cx === c.cx && t.cy === c.cy)) as CoarseCell;
      }
      taken.push(best);

      placements.push({
        logicalNodeId: node.id,
        regionIndex,
        cell: best,
        // The boss node doubles as the exit to tier N+1 — roadmap §16b is
        // explicit that there is no separate transition-node type. Phase 5
        // resolves the fight; this only carries the property.
        isExit: node.isBoss,
      });
    }
  });

  return placements;
}

/** Multi-source BFS within one region's cells; returns the path to `target`. */
function pathWithinRegion(
  blobs: RegionBlobs,
  regionIndex: number,
  sources: ReadonlySet<string>,
  target: CoarseCell,
  blocked: ReadonlySet<string> = new Set(),
): CoarseCell[] | null {
  const cameFrom = new Map<string, CoarseCell | null>();
  const queue: CoarseCell[] = [];

  for (let cy = 0; cy < blobs.gridSize; cy++) {
    for (let cx = 0; cx < blobs.gridSize; cx++) {
      if (!sources.has(coarseKey(cx, cy))) continue;
      if (ownerAt(blobs, cx, cy) !== regionIndex) continue;
      cameFrom.set(coarseKey(cx, cy), null);
      queue.push({ cx, cy });
    }
  }

  let head = 0;
  while (head < queue.length) {
    const at = queue[head++];
    if (at.cx === target.cx && at.cy === target.cy) {
      const path: CoarseCell[] = [];
      let cursor: CoarseCell | undefined = at;
      while (cursor) {
        path.unshift(cursor);
        const prev = cameFrom.get(coarseKey(cursor.cx, cursor.cy));
        cursor = prev ?? undefined;
      }
      return path;
    }
    for (const [dx, dy] of DIR_DELTA) {
      const nx = at.cx + dx;
      const ny = at.cy + dy;
      if (ownerAt(blobs, nx, ny) !== regionIndex) continue;
      const key = coarseKey(nx, ny);
      if (cameFrom.has(key) || blocked.has(key)) continue;
      cameFrom.set(key, at);
      queue.push({ cx: nx, cy: ny });
    }
  }

  return null;
}

/** The direction index from `a` to orthogonally-adjacent `b`. */
function directionBetween(a: CoarseCell, b: CoarseCell): number {
  return DIR_DELTA.findIndex(([dx, dy]) => a.cx + dx === b.cx && a.cy + dy === b.cy);
}

/**
 * Builds the backbone: within each region, a connected skeleton touching
 * every logical node cell and every corridor cell.
 *
 * Paths are routed strictly INSIDE the region's own blob. A path that
 * wandered through a neighbour would require opening a cross-region seam,
 * which — unless that seam is a sanctioned corridor — is exactly the
 * shortcut Gate 2 forbids. Confining the search to one region's cells makes
 * that impossible to express rather than merely discouraged.
 */
export function buildBackbone(
  root: Rng,
  tier: Tier,
  blobs: RegionBlobs,
  plan: BorderPlan,
  placements: readonly NodePlacement[],
): Backbone {
  const cells = new Set<string>();
  const requiredOpenSeams = new Set<string>();
  const requiredClosedSeams = new Set<string>();
  const enclaves = new Set<string>();

  // Corridor seams are walkable by definition — that is what a corridor is.
  for (const seam of plan.corridorEdges) requiredOpenSeams.add(seam);

  tier.regions.forEach((region, regionIndex) => {
    const targets: CoarseCell[] = placements
      .filter((p) => p.regionIndex === regionIndex)
      .map((p) => p.cell);

    // Corridor cells belonging to this region must join its skeleton too,
    // or the corridor would open onto terrain with no route inward.
    for (const key of plan.corridorCells) {
      const [cx, cy] = key.split(",").map(Number);
      if (ownerAt(blobs, cx, cy) === regionIndex) targets.push({ cx, cy });
    }

    if (targets.length === 0) return;

    const connected = new Set<string>([coarseKey(targets[0].cx, targets[0].cy)]);
    cells.add(coarseKey(targets[0].cx, targets[0].cy));

    for (const target of targets.slice(1)) {
      const key = coarseKey(target.cx, target.cy);
      if (connected.has(key)) continue;

      const path = pathWithinRegion(blobs, regionIndex, connected, target);
      if (path === null) {
        // Blobs are made contiguous in voronoi.ts, so this is unreachable
        // unless that guarantee regresses. Fail loudly rather than emit
        // terrain with a node nothing can walk to.
        throw new Error(
          `spatial: region ${region.id} cell (${target.cx},${target.cy}) is unreachable within its own ` +
            `blob — blob contiguity was violated upstream (see voronoi.ts enforceContiguity).`,
        );
      }

      for (let i = 0; i < path.length; i++) {
        cells.add(coarseKey(path[i].cx, path[i].cy));
        connected.add(coarseKey(path[i].cx, path[i].cy));
        if (i > 0) {
          const dir = directionBetween(path[i - 1], path[i]);
          requiredOpenSeams.add(seamKey(path[i - 1].cx, path[i - 1].cy, dir));
        }
      }
    }

    // ---- enclaves, then link everything else back to the backbone ----
    //
    // Deliverable 5 lets off-backbone cells fill freely, "including
    // deliberately-enclosed decorative terrain, since off-backbone cells
    // carry no required connectivity". Taken literally that produced
    // walkable islands: several off-backbone cells opening onto each other
    // but onto nothing that leads home. Gate 3 caught it.
    //
    // The resolution is that a cell gets exactly two honest options —
    // reachable, or sealed — with nothing in between. An ENCLAVE is sealed
    // on every side (so it holds solid rock or a walled garden, and its
    // walkable tiles are Gate 3's one exemption); every other cell is
    // linked back into the backbone. "Free fill" survives intact: a linked
    // cell still chooses among many patterns, it just may not become an
    // island.
    const enclaveRng = root.substream(`spatial:tier:${tier.tierIndex}:region:${regionIndex}:enclaves`);
    const regionCells = cellsOfRegion(blobs, regionIndex);

    // Cells orthogonally adjacent to a logical node are never enclaves.
    // Design-wise, walling off a city's approaches is exactly backwards —
    // a settlement should be the best-connected ground in its area.
    // Mechanically, every sealed side of a node's cell removes a degree of
    // freedom from its open-edge pattern, and a fully-constrained node cell
    // can only be filled from the few poi chunks carrying that one exact
    // pattern. Enclaves crowding node cells exhausted the fixture library.
    const nodeAdjacent = new Set<string>();
    for (const p of placements.filter((p) => p.regionIndex === regionIndex)) {
      for (const [dx, dy] of DIR_DELTA) {
        nodeAdjacent.add(coarseKey(p.cell.cx + dx, p.cell.cy + dy));
      }
    }

    for (const cell of regionCells) {
      const key = coarseKey(cell.cx, cell.cy);
      if (connected.has(key)) continue;
      if (plan.corridorCells.has(key)) continue;
      if (nodeAdjacent.has(key)) continue;
      if (enclaveRng.nextFloat() >= ENCLAVE_CHANCE) continue;
      enclaves.add(key);
      for (let dir = 0; dir < DIR_DELTA.length; dir++) {
        requiredClosedSeams.add(seamKey(cell.cx, cell.cy, dir));
      }
    }

    for (const cell of regionCells) {
      const key = coarseKey(cell.cx, cell.cy);
      if (connected.has(key) || enclaves.has(key)) continue;

      const path = pathWithinRegion(blobs, regionIndex, connected, cell, enclaves);
      if (path === null) {
        // Only reachable if enclaves cut the blob in two; treat this cell
        // as an enclave too rather than emitting an unreachable pocket.
        enclaves.add(key);
        for (let dir = 0; dir < DIR_DELTA.length; dir++) {
          requiredClosedSeams.add(seamKey(cell.cx, cell.cy, dir));
        }
        continue;
      }

      for (let i = 0; i < path.length; i++) {
        connected.add(coarseKey(path[i].cx, path[i].cy));
        if (i > 0) {
          const dir = directionBetween(path[i - 1], path[i]);
          requiredOpenSeams.add(seamKey(path[i - 1].cx, path[i - 1].cy, dir));
        }
      }
    }
  });

  // A seam can never be both. Enclaves are chosen only from cells that are
  // not yet connected, so this should be empty; assert rather than assume,
  // because a contradiction here would surface far away as an unfillable cell.
  for (const seam of requiredClosedSeams) {
    if (requiredOpenSeams.has(seam)) {
      throw new Error(`spatial: seam ${seam} is required both open and closed — enclave selection is inconsistent`);
    }
  }

  return { cells, requiredOpenSeams, requiredClosedSeams, enclaves };
}
