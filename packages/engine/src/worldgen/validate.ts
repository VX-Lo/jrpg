import type { Tier } from "./types.js";
import { reachableFrom } from "./util.js";
import { NODES_PER_TIER } from "./config.js";

/**
 * Structural validity check for a generated Tier. Returns a list of
 * violation descriptions — empty means valid. Used by Gate 1 (volume)
 * and available to the CLI for ad-hoc sanity checks.
 */
export function validateTier(tier: Tier): string[] {
  const violations: string[] = [];

  for (const region of tier.regions) {
    if (region.nodes.length !== region.nodeBudget) {
      violations.push(`region ${region.id}: node count ${region.nodes.length} !== budget ${region.nodeBudget}`);
    }
  }

  const totalNodes = tier.regions.reduce((sum, r) => sum + r.nodes.length, 0);
  if (totalNodes !== NODES_PER_TIER) {
    violations.push(`tier ${tier.tierIndex}: total node count ${totalNodes} !== NODES_PER_TIER ${NODES_PER_TIER}`);
  }

  for (const region of tier.regions) {
    const reached = reachableFrom(region.entryNodeId, region.nodes, region.edges);
    for (const node of region.nodes) {
      if (!reached.has(node.id)) {
        violations.push(`region ${region.id}: node ${node.id} unreachable from entry ${region.entryNodeId}`);
      }
    }

    const settlementCount = region.nodes.filter((n) => n.kind === "settlement").length;
    if (settlementCount === 0) violations.push(`region ${region.id}: zero settlements`);

    if (region.factions.length === 0) violations.push(`region ${region.id}: zero factions`);
    if (!region.economicAxis) violations.push(`region ${region.id}: no economic axis assigned`);

    const entranceIds = new Set(region.nodes.filter((n) => n.kind === "dungeonEntrance").map((n) => n.id));
    for (const cluster of region.dungeonClusters) {
      if (!entranceIds.has(cluster.parentNodeId)) {
        violations.push(
          `region ${region.id}: dungeon cluster ${cluster.id} parent ${cluster.parentNodeId} is not a dungeonEntrance node in this region`,
        );
      }
      const clusterReached = reachableFrom(cluster.entryNodeId, cluster.nodes, cluster.edges);
      for (const node of cluster.nodes) {
        if (!clusterReached.has(node.id)) {
          violations.push(`dungeon cluster ${cluster.id}: node ${node.id} unreachable from cluster entry ${cluster.entryNodeId}`);
        }
      }
    }
  }

  const bossNodes = tier.regions.flatMap((r) => r.nodes.filter((n) => n.isBoss));
  if (bossNodes.length !== 1) {
    violations.push(`tier ${tier.tierIndex}: expected exactly 1 boss node, found ${bossNodes.length}`);
  }

  const properNouns: string[] = [];
  for (const region of tier.regions) {
    for (const node of region.nodes) properNouns.push(node.name);
    for (const cluster of region.dungeonClusters) {
      for (const node of cluster.nodes) properNouns.push(node.name);
    }
    for (const faction of region.factions) properNouns.push(faction.name);
    for (const npc of region.npcs) properNouns.push(npc.name);
  }
  const seenNouns = new Set<string>();
  for (const noun of properNouns) {
    if (seenNouns.has(noun)) {
      violations.push(`duplicate proper noun within tier ${tier.tierIndex}: "${noun}"`);
    }
    seenNouns.add(noun);
  }

  return violations;
}
