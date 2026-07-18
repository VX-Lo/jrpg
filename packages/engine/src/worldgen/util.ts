import type { Rng } from "../rng/index.js";
import type { WorldEdge, WorldNode } from "./types.js";

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

/** BFS reachable node ids from `entryId`, treating edges as undirected (travel is bidirectional). */
export function reachableFrom(
  entryId: string,
  nodes: readonly WorldNode[],
  edges: readonly WorldEdge[],
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
