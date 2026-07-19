import type { Rng } from "../rng/index.js";

/** Deterministic Fisher-Yates shuffle of [0, count). */
export function shuffledIndices(rng: Rng, count: number): number[] {
  const indices = Array.from({ length: count }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

/** Deterministically picks `count` distinct indices from [0, poolSize) without replacement. */
export function pickWithoutReplacement(rng: Rng, poolSize: number, count: number): number[] {
  if (count > poolSize) {
    throw new Error(`pickWithoutReplacement: cannot pick ${count} from a pool of ${poolSize}`);
  }
  return shuffledIndices(rng, poolSize).slice(0, count);
}

/**
 * BFS reachable ids from `entryId`, treating edges as undirected (travel is
 * bidirectional).
 *
 * Structurally typed on `{id}` / `{from,to}` rather than on `WorldNode` /
 * `WorldEdge` so the identical traversal serves both the node graph and the
 * tier's region-adjacency graph. Behaviour is unchanged — this only widens
 * what it will accept.
 */
export function reachableFrom(
  entryId: string,
  nodes: readonly { readonly id: string }[],
  edges: readonly { readonly from: string; readonly to: string }[],
): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }

  const visited = new Set<string>();
  const queue = [entryId];
  visited.add(entryId);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited;
}
