import type { Rng } from "../rng/index.js";
import type { Region, RegionEdge } from "./types.js";
import {
  REGION_EDGE_WEIGHT_MIN_TICKS,
  REGION_EDGE_WEIGHT_MAX_TICKS,
  EXTRA_REGION_EDGE_FRACTION,
} from "./config.js";

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Builds the tier's region-adjacency graph: a random spanning tree over the
 * regions (guaranteeing every region is reachable from region 0) plus a
 * small number of extra edges for cycles.
 *
 * This is `edges.ts`'s construction applied one level up, deliberately —
 * same spanning-tree-first move, same guarantee, same shape of code. The
 * reason it exists at all: Phase 4.5 embeds regions into physical tile
 * terrain, and needs an authoritative answer to "may the player walk
 * directly from region A to region B?" Geometric blob adjacency alone
 * cannot answer that, because two blobs can touch without the world
 * intending a route between them. This graph is that answer, and it lives
 * in worldgen (with the rest of the tier's topology) rather than in the
 * terrain layer, so terrain conforms to the world rather than defining it.
 *
 * Drawn from `worldgen:tier:{n}:regions:adjacency`. A NEW substream key —
 * by the substream design (keys hash directly into a seed, never sequential
 * derivation) adding it perturbs no pre-existing draw. Gate 5 asserts this
 * rather than trusting it.
 */
export function buildRegionAdjacency(
  root: Rng,
  tierIndex: number,
  regions: readonly Region[],
): RegionEdge[] {
  const rng = root.substream(`worldgen:tier:${tierIndex}:regions:adjacency`);
  const edges: RegionEdge[] = [];
  const seen = new Set<string>();

  const weight = (): number =>
    REGION_EDGE_WEIGHT_MIN_TICKS +
    rng.nextInt(REGION_EDGE_WEIGHT_MAX_TICKS - REGION_EDGE_WEIGHT_MIN_TICKS + 1);

  // Spanning tree: attach region i to a uniformly random earlier region.
  for (let i = 1; i < regions.length; i++) {
    const a = regions[i];
    const b = regions[rng.nextInt(i)];
    edges.push({ from: a.id, to: b.id, weightTicks: weight() });
    seen.add(edgeKey(a.id, b.id));
  }

  // Extra edges for cycles. Sparse by design — see EXTRA_REGION_EDGE_FRACTION.
  const extraCount = Math.floor(regions.length * EXTRA_REGION_EDGE_FRACTION);
  const maxAttempts = extraCount * 20;
  let added = 0;
  let attempts = 0;
  while (added < extraCount && attempts < maxAttempts) {
    attempts++;
    const i = rng.nextInt(regions.length);
    const j = rng.nextInt(regions.length);
    if (i === j) continue;
    const key = edgeKey(regions[i].id, regions[j].id);
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from: regions[i].id, to: regions[j].id, weightTicks: weight() });
    added++;
  }

  return edges;
}
