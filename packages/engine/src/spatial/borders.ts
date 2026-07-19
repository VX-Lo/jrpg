import type { Rng } from "../rng/index.js";
import type { Tier } from "../worldgen/types.js";
import type { BorderPlan, RegionBlobs } from "./types.js";
import { DIR_DELTA, DIR_E, DIR_S, UNOWNED_CELL, coarseKey, regionPairKey, seamKey } from "./types.js";
import { ownerAt } from "./voronoi.js";

/**
 * Deliverable 3 — borders, read off Phase 2's region-adjacency graph.
 *
 * A TWO-SIDED CONTRACT, and both sides are load-bearing:
 *
 *   blobs touch AND `Tier.regionEdges` has an edge  → carve a corridor
 *   blobs touch AND no edge                         → the border stays SEALED
 *
 * The second is the anti-shortcut direction and the easy one to forget. A
 * sealed pair is sealed no matter how much perimeter the two blobs share:
 * geometric adjacency is not permission. Getting this wrong would not crash
 * anything — it would silently hand the player a route the quest DAG never
 * accounted for, invalidating what Phase 4's two-solver gate proved. That
 * is why Gate 2 exists and why it asserts a NEGATIVE.
 *
 * This module only decides WHERE seams may be walkable. Assembly enforces
 * it, by forcing every non-corridor cross-region seam closed when it picks
 * chunks (see assemble.ts).
 */

/** Every ordered seam between two differently-owned interior cells. */
function collectTouchingSeams(
  blobs: RegionBlobs,
): Map<string, { cx: number; cy: number; dir: number; a: number; b: number }[]> {
  const byPair = new Map<string, { cx: number; cy: number; dir: number; a: number; b: number }[]>();

  for (let cy = 0; cy < blobs.gridSize; cy++) {
    for (let cx = 0; cx < blobs.gridSize; cx++) {
      const a = ownerAt(blobs, cx, cy);
      if (a === UNOWNED_CELL) continue;
      // Only east and south, so each seam is visited exactly once.
      for (const dir of [DIR_E, DIR_S]) {
        const [dx, dy] = DIR_DELTA[dir];
        const b = ownerAt(blobs, cx + dx, cy + dy);
        if (b === UNOWNED_CELL || b === a) continue;
        const key = regionPairKey(a, b);
        const bucket = byPair.get(key);
        const entry = { cx, cy, dir, a, b };
        if (bucket) bucket.push(entry);
        else byPair.set(key, [entry]);
      }
    }
  }

  return byPair;
}

/**
 * Builds the tier's border plan.
 *
 * Drawn from `spatial:tier:{n}:borders` — tier-scoped, because which pairs
 * are connected is a property of the tier's region graph, not of any one
 * region.
 */
export function buildBorderPlan(root: Rng, tier: Tier, blobs: RegionBlobs): BorderPlan {
  const rng = root.substream(`spatial:tier:${tier.tierIndex}:borders`);

  // Phase 2's graph, indexed by region INDEX rather than id — the spatial
  // layer works in indices, worldgen works in ids, and this is the one
  // place they meet.
  const indexOf = new Map(tier.regions.map((r, i) => [r.id, i]));
  const graphPairs = new Set(
    tier.regionEdges.map((e) =>
      regionPairKey(indexOf.get(e.from) as number, indexOf.get(e.to) as number),
    ),
  );

  const touching = collectTouchingSeams(blobs);
  const connectedPairs = new Set<string>();
  const sealedPairs = new Set<string>();
  const corridorCells = new Set<string>();
  const corridorEdges = new Set<string>();

  // Sorted so the iteration order is a property of the data, not of Map
  // insertion — otherwise a change to scan order would move every corridor.
  for (const pairKey of [...touching.keys()].sort()) {
    const seams = touching.get(pairKey) as { cx: number; cy: number; dir: number }[];

    if (!graphPairs.has(pairKey)) {
      sealedPairs.add(pairKey);
      continue;
    }

    connectedPairs.add(pairKey);

    // Carve exactly one corridor per connected pair. One is enough for
    // reachability (Gate 1) and keeping it to one means the corridor reads
    // as a pass/ford — a specific place — rather than the two regions
    // simply dissolving into each other along their whole shared border.
    const chosen = seams[rng.nextInt(seams.length)];
    const [dx, dy] = DIR_DELTA[chosen.dir];
    corridorEdges.add(seamKey(chosen.cx, chosen.cy, chosen.dir));
    corridorCells.add(coarseKey(chosen.cx, chosen.cy));
    corridorCells.add(coarseKey(chosen.cx + dx, chosen.cy + dy));
  }

  return { connectedPairs, sealedPairs, corridorCells, corridorEdges };
}

/**
 * Region pairs that Phase 2's graph connects but whose blobs never touch,
 * so no corridor could be carved.
 *
 * The region graph is built without knowledge of the eventual geometry, so
 * this can happen. It is mostly designed out upstream: `buildRegionBlobs`
 * chooses which region occupies which Voronoi seed position by scoring
 * candidate layouts against this very graph, which cut the rate from 26%
 * of tiers to ~0.25% (measured over 400 tiers).
 *
 * The residual case is tolerable, and deliberately not "repaired". Routing
 * around it would mean opening a seam between two regions the graph does
 * NOT connect — exactly the shortcut Gate 2 forbids. So one intended route
 * goes uncarved while the tier stays connected through its other edges.
 * What is NOT tolerable is a region left physically unreachable, and that
 * is asserted separately (see the tier-connectivity check in validate.ts).
 */
export function unsatisfiedGraphPairs(tier: Tier, plan: BorderPlan): string[] {
  const indexOf = new Map(tier.regions.map((r, i) => [r.id, i]));
  const out: string[] = [];
  for (const edge of tier.regionEdges) {
    const key = regionPairKey(indexOf.get(edge.from) as number, indexOf.get(edge.to) as number);
    if (!plan.connectedPairs.has(key)) out.push(key);
  }
  return out;
}
