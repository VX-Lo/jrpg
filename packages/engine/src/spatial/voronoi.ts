import type { Rng } from "../rng/index.js";
import type { Tier } from "../worldgen/types.js";
import type { CoarseCell, OwnerGrid, RegionBlobs } from "./types.js";
import { UNOWNED_CELL } from "./types.js";
import {
  COARSE_GRID_SIZE,
  VORONOI_MIN_SEED_DISTANCE,
  VORONOI_NOISE_STRENGTH,
  VORONOI_SEED_CANDIDATES,
  VORONOI_SMOOTHING_PASSES,
  REGION_CELL_SLACK,
} from "../worldgen/config.js";

/**
 * Deliverable 2 — region shape as organic blobs, not squares.
 *
 * One seed cell per region (min-distance constrained so no region gets a
 * sliver), nearest-seed assignment with SEEDED NOISE perturbing the
 * distance metric so borders wobble instead of forming straight Voronoi
 * bisectors, then cellular-automata majority smoothing to round that
 * wobble into something organic.
 *
 * NOT a climate model. Roadmap §16b is explicit: biome IDENTITY is already
 * answered upstream — Phase 2 assigns each region a kernel discretely. The
 * only problem left is organic SHAPE for territories that are already
 * named, which is strictly smaller than deriving biomes from continuous
 * temperature/moisture fields. There are no such fields here and there
 * should never be.
 *
 * The outer ring of the coarse grid is always UNOWNED — the impassable
 * tier boundary. A tier is a bounded canvas, not infinite terrain.
 */

const INTERIOR_MARGIN = 1;

function idx(cx: number, cy: number, size: number): number {
  return cy * size + cx;
}

function isInterior(cx: number, cy: number, size: number): boolean {
  return (
    cx >= INTERIOR_MARGIN && cy >= INTERIOR_MARGIN && cx < size - INTERIOR_MARGIN && cy < size - INTERIOR_MARGIN
  );
}

/** Chebyshev distance — the metric the min-seed-distance constraint uses. */
function chebyshev(a: CoarseCell, b: CoarseCell): number {
  return Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy));
}

/**
 * Places one seed cell per region using Mitchell's best-candidate: draw
 * VORONOI_SEED_CANDIDATES positions and keep whichever is FURTHEST from the
 * seeds already placed, stopping early once the min-distance constraint is
 * comfortably met.
 *
 * DEVIATION FROM THE SUGGESTED SUBSTREAM KEY, and the same one Phase 2 made
 * for kernel assignment, for the same reason. The suggested key was
 * per-region (`spatial:tier:{n}:region:{i}:seed`), but minimum seed
 * separation is a TIER-SCOPED constraint — a region cannot honour it while
 * drawing in ignorance of its neighbours. Independent per-region draws were
 * tried first and demonstrably failed: on an 8x8 interior with 4 regions,
 * the later seeds landed on top of earlier ones often enough to produce
 * regions with ZERO coarse cells, which is not a cosmetic flaw but an
 * unplaceable region. One coordinating draw at `spatial:tier:{n}:seeds`
 * fixes it structurally. Documented in CLAUDE.md.
 */
function placeSeeds(rng: Rng, regionCount: number, size: number): CoarseCell[] {
  const seeds: CoarseCell[] = [];
  const span = size - 2 * INTERIOR_MARGIN;

  for (let i = 0; i < regionCount; i++) {
    let best: CoarseCell | null = null;
    let bestClearance = -1;

    for (let attempt = 0; attempt < VORONOI_SEED_CANDIDATES; attempt++) {
      const candidate: CoarseCell = {
        cx: INTERIOR_MARGIN + rng.nextInt(span),
        cy: INTERIOR_MARGIN + rng.nextInt(span),
      };
      const clearance = seeds.length === 0 ? Infinity : Math.min(...seeds.map((s) => chebyshev(candidate, s)));
      if (clearance > bestClearance) {
        bestClearance = clearance;
        best = candidate;
      }
      if (bestClearance >= VORONOI_MIN_SEED_DISTANCE) break;
    }

    seeds.push(best as CoarseCell);
  }

  return seeds;
}

/**
 * Grows undersized regions until every region owns at least `required[i]`
 * cells, claiming from whichever neighbouring region has the most surplus.
 *
 * A region must have at least one coarse cell per logical node it hosts,
 * plus slack for the backbone to route between them. Noise and smoothing
 * can legitimately squeeze a region below that, so rather than hoping the
 * roll is kind, the floor is repaired deterministically — the same
 * by-construction discipline the rest of the project uses. Claims are made
 * in row-major scan order from the most-surplus donor, so the repair is a
 * pure function of the assignment, not of iteration accidents.
 */
function ensureMinimumTerritory(
  owner: OwnerGrid,
  required: readonly number[],
  size: number,
): OwnerGrid {
  const next: OwnerGrid = Int8Array.from(owner);
  const count = (region: number): number => next.reduce((n, o) => (o === region ? n + 1 : n), 0);

  for (let regionIndex = 0; regionIndex < required.length; regionIndex++) {
    let guard = size * size;
    while (count(regionIndex) < required[regionIndex] && guard-- > 0) {
      // Surplus of each potential donor, so we take from whoever can spare it.
      const surplus = required.map((need, i) => (i === regionIndex ? -Infinity : count(i) - need));

      let claimed = false;
      let bestDonor = -1;
      let bestCell = -1;
      for (let cy = 0; cy < size && !claimed; cy++) {
        for (let cx = 0; cx < size; cx++) {
          if (!isInterior(cx, cy, size)) continue;
          const at = idx(cx, cy, size);
          const donor = next[at];
          if (donor === regionIndex || donor === UNOWNED_CELL) continue;
          // Only claim a cell adjacent to the growing region, so blobs stay contiguous.
          const touching = [
            [cx + 1, cy],
            [cx - 1, cy],
            [cx, cy + 1],
            [cx, cy - 1],
          ].some(([nx, ny]) => isInterior(nx, ny, size) && next[idx(nx, ny, size)] === regionIndex);
          if (!touching) continue;
          if (bestDonor === -1 || surplus[donor] > surplus[bestDonor]) {
            bestDonor = donor;
            bestCell = at;
          }
        }
      }
      if (bestCell === -1) break; // nothing adjacent to take — surfaced by validation downstream
      next[bestCell] = regionIndex;
    }
  }

  return next;
}

/**
 * Per-region noise field over the whole grid, drawn from that region's
 * `:shape` substream.
 *
 * Materialised as a field UP FRONT rather than drawn lazily during cell
 * assignment, deliberately: a lazy draw would make each cell's noise depend
 * on how many cells were visited before it, so any future change to
 * iteration order would silently reshape every region. Indexing a
 * pre-drawn field is order-independent.
 */
function noiseField(rng: Rng, size: number): Float64Array {
  const field = new Float64Array(size * size);
  for (let i = 0; i < field.length; i++) {
    field[i] = (rng.nextFloat() * 2 - 1) * VORONOI_NOISE_STRENGTH;
  }
  return field;
}

/**
 * Cellular-automata majority smoothing: each interior cell adopts the most
 * common owner among its 8 neighbours, ties broken in favour of keeping the
 * current owner (so smoothing rounds edges without drifting whole regions).
 * Computed against a snapshot so the pass is order-independent.
 */
function smooth(owner: OwnerGrid, size: number): OwnerGrid {
  const next: OwnerGrid = Int8Array.from(owner);
  for (let cy = 0; cy < size; cy++) {
    for (let cx = 0; cx < size; cx++) {
      if (!isInterior(cx, cy, size)) continue;
      const tally = new Map<number, number>();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (!isInterior(nx, ny, size)) continue;
          const o = owner[idx(nx, ny, size)];
          if (o === UNOWNED_CELL) continue;
          tally.set(o, (tally.get(o) ?? 0) + 1);
        }
      }
      const current = owner[idx(cx, cy, size)];
      let bestOwner = current;
      let bestCount = tally.get(current) ?? 0;
      // Iterate candidate owners in ascending region index, not Map order,
      // so the tie-break is a property of the data and not of insertion order.
      for (const candidate of [...tally.keys()].sort((a, b) => a - b)) {
        const count = tally.get(candidate) as number;
        if (count > bestCount) {
          bestCount = count;
          bestOwner = candidate;
        }
      }
      next[idx(cx, cy, size)] = bestOwner;
    }
  }
  return next;
}

/**
 * Enforces blob contiguity: a cell owned by region i but not connected to
 * region i's SEED through same-owner cells is disowned (becomes impassable
 * boundary).
 *
 * Noise plus smoothing can strand a few cells across a border, and a
 * disconnected fragment would be a walled-off island of the right biome
 * with no route to the rest of its region — a spatial softlock if a logical
 * node landed there. Disowning is the conservative fix: it only ever adds
 * impassable terrain, never invents a connection that the region-adjacency
 * graph did not authorise.
 */
function enforceContiguity(owner: OwnerGrid, seeds: readonly CoarseCell[], size: number): OwnerGrid {
  const kept: OwnerGrid = new Int8Array(owner.length).fill(UNOWNED_CELL);

  seeds.forEach((seed, regionIndex) => {
    const start = idx(seed.cx, seed.cy, size);
    if (owner[start] !== regionIndex) return; // seed lost its own cell to smoothing
    const queue: number[] = [start];
    kept[start] = regionIndex;
    while (queue.length > 0) {
      const at = queue.pop() as number;
      const cx = at % size;
      const cy = (at - cx) / size;
      const neighbours: [number, number][] = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1],
      ];
      for (const [nx, ny] of neighbours) {
        if (!isInterior(nx, ny, size)) continue;
        const n = idx(nx, ny, size);
        if (owner[n] !== regionIndex || kept[n] === regionIndex) continue;
        kept[n] = regionIndex;
        queue.push(n);
      }
    }
  });

  return kept;
}

/**
 * Builds the tier's region blobs.
 *
 * `weightForRegion` reads `region.nodeBudget` — Phase 2's existing
 * big/medium/small designation reused as the Voronoi weight, per
 * Deliverable 2's "no new sizing logic". NOTE that Phase 2's REGION_SHAPES
 * are uniform within any single tier (`[12,12]`, `[8,8,8]`, `[6,6,6,6]`),
 * so today this weighting is a no-op and every region in a tier competes
 * equally. That is correct, not a bug: the designation varies region COUNT
 * per tier, not relative size within one. Reading the budget anyway means
 * non-uniform shapes would just work if they are ever authored.
 */
export function buildRegionBlobs(root: Rng, tier: Tier): RegionBlobs {
  const size = COARSE_GRID_SIZE;
  const regionCount = tier.regions.length;

  const noise: Float64Array[] = [];
  for (let i = 0; i < regionCount; i++) {
    noise.push(noiseField(root.substream(`spatial:tier:${tier.tierIndex}:region:${i}:shape`), size));
  }

  const seeds = placeSeeds(root.substream(`spatial:tier:${tier.tierIndex}:seeds`), regionCount, size);

  const budgets = tier.regions.map((r) => r.nodeBudget);
  const meanBudget = budgets.reduce((a, b) => a + b, 0) / Math.max(1, budgets.length);
  const weights = budgets.map((b) => (meanBudget > 0 ? b / meanBudget : 1));

  let owner: OwnerGrid = new Int8Array(size * size).fill(UNOWNED_CELL);
  for (let cy = 0; cy < size; cy++) {
    for (let cx = 0; cx < size; cx++) {
      if (!isInterior(cx, cy, size)) continue;
      let bestRegion = 0;
      let bestScore = Infinity;
      for (let i = 0; i < regionCount; i++) {
        const dx = cx - seeds[i].cx;
        const dy = cy - seeds[i].cy;
        const score = Math.sqrt(dx * dx + dy * dy) / weights[i] + noise[i][idx(cx, cy, size)];
        if (score < bestScore) {
          bestScore = score;
          bestRegion = i;
        }
      }
      owner[idx(cx, cy, size)] = bestRegion;
    }
  }

  // The seed cell always belongs to its own region — smoothing may not vote
  // a region out of the cell it was grown from, or contiguity (which walks
  // from the seed) would disown the entire blob.
  const pin = (): void => {
    seeds.forEach((s, i) => {
      owner[idx(s.cx, s.cy, size)] = i;
    });
  };

  pin();
  for (let pass = 0; pass < VORONOI_SMOOTHING_PASSES; pass++) {
    owner = smooth(owner, size);
    pin();
  }
  owner = enforceContiguity(owner, seeds, size);

  // Every region needs a cell per logical node it hosts, plus routing slack.
  const required = tier.regions.map((r) => r.nodes.length + REGION_CELL_SLACK);
  owner = ensureMinimumTerritory(owner, required, size);
  owner = enforceContiguity(owner, seeds, size);

  return { gridSize: size, owner, seeds };
}

/** Cells owned by a region, in row-major order. */
export function cellsOfRegion(blobs: RegionBlobs, regionIndex: number): CoarseCell[] {
  const out: CoarseCell[] = [];
  for (let cy = 0; cy < blobs.gridSize; cy++) {
    for (let cx = 0; cx < blobs.gridSize; cx++) {
      if (blobs.owner[idx(cx, cy, blobs.gridSize)] === regionIndex) out.push({ cx, cy });
    }
  }
  return out;
}

export function ownerAt(blobs: RegionBlobs, cx: number, cy: number): number {
  if (cx < 0 || cy < 0 || cx >= blobs.gridSize || cy >= blobs.gridSize) return UNOWNED_CELL;
  return blobs.owner[idx(cx, cy, blobs.gridSize)];
}
