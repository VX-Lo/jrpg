import type { Rng } from "../rng/index.js";
import type { DungeonCluster, WorldEdge, WorldNode } from "./types.js";
import { DUNGEON_CLUSTER_MIN_NODES, DUNGEON_CLUSTER_MAX_NODES, EDGE_WEIGHT_MIN_TICKS, EDGE_WEIGHT_MAX_TICKS } from "./config.js";

/**
 * Builds the multi-level node cluster hanging off a dungeon-entrance
 * node. These extra nodes are NOT counted toward the region's node
 * budget (Gate 1's node-count check is about the top-level region graph)
 * — they're an appendage, not part of the region's own traversal graph.
 *
 * Depth node names derive from the (already tier-unique) parent node's
 * name, so they never collide with anything else in the tier without
 * needing their own curated pool.
 */
export function buildDungeonCluster(rng: Rng, parentNode: WorldNode): DungeonCluster {
  const count =
    DUNGEON_CLUSTER_MIN_NODES + rng.nextInt(DUNGEON_CLUSTER_MAX_NODES - DUNGEON_CLUSTER_MIN_NODES + 1);

  const nodes: WorldNode[] = Array.from({ length: count }, (_, i) => {
    const depth = i + 1;
    return {
      id: `${parentNode.id}-d${depth}`,
      kind: "landmark" as const,
      name: `${parentNode.name} — Depth ${depth}`,
      canHostQuestNode: true,
      isBoss: false,
    };
  });

  const edges: WorldEdge[] = [];
  for (let i = 1; i < nodes.length; i++) {
    const weightTicks = EDGE_WEIGHT_MIN_TICKS + rng.nextInt(EDGE_WEIGHT_MAX_TICKS - EDGE_WEIGHT_MIN_TICKS + 1);
    edges.push({ from: nodes[i - 1].id, to: nodes[i].id, weightTicks });
  }

  return {
    id: `${parentNode.id}-cluster`,
    parentNodeId: parentNode.id,
    nodes,
    edges,
    entryNodeId: nodes[0].id,
  };
}
