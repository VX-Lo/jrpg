import type { Rng } from "../rng/index.js";
import type { WorldEdge, WorldNode } from "./types.js";
import {
  EDGE_WEIGHT_MIN_TICKS,
  EDGE_WEIGHT_MAX_TICKS,
  EDGE_WEIGHT_REMOTE_MAX_TICKS,
  EXTRA_EDGE_FRACTION,
} from "./config.js";

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function weightFor(rng: Rng, a: WorldNode, b: WorldNode): number {
  // Landmark endpoints get a wider draw range — this is how remote/high
  // peaks get to be slow to reach without any special-casing: it's just
  // node-kind-keyed range selection, same mechanism as every other edge.
  const max = a.kind === "landmark" || b.kind === "landmark" ? EDGE_WEIGHT_REMOTE_MAX_TICKS : EDGE_WEIGHT_MAX_TICKS;
  return EDGE_WEIGHT_MIN_TICKS + rng.nextInt(max - EDGE_WEIGHT_MIN_TICKS + 1);
}

/**
 * Builds a connected, weighted graph over `nodes`: a random spanning
 * tree (guarantees every node is reachable from node 0, the entry) plus
 * extra edges for cycles/texture.
 */
export function buildRegionEdges(rng: Rng, nodes: readonly WorldNode[]): WorldEdge[] {
  const edges: WorldEdge[] = [];
  const seen = new Set<string>();

  // Spanning tree: attach node i to a uniformly random earlier node.
  for (let i = 1; i < nodes.length; i++) {
    const j = rng.nextInt(i);
    const a = nodes[i];
    const b = nodes[j];
    edges.push({ from: a.id, to: b.id, weightTicks: weightFor(rng, a, b) });
    seen.add(edgeKey(a.id, b.id));
  }

  // Extra edges for texture/cycles.
  const extraCount = Math.floor(nodes.length * EXTRA_EDGE_FRACTION);
  const maxAttempts = extraCount * 20;
  let added = 0;
  let attempts = 0;
  while (added < extraCount && attempts < maxAttempts) {
    attempts++;
    const i = rng.nextInt(nodes.length);
    const j = rng.nextInt(nodes.length);
    if (i === j) continue;
    const a = nodes[i];
    const b = nodes[j];
    const key = edgeKey(a.id, b.id);
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from: a.id, to: b.id, weightTicks: weightFor(rng, a, b) });
    added++;
  }

  return edges;
}
