import type { Region, Tier } from "../worldgen/types.js";
import { KERNELS } from "../worldgen/kernels/index.js";

const kernelNameById = new Map(KERNELS.map((k) => [k.id, k.displayName]));

function formatRegion(region: Region): string {
  const lines: string[] = [];
  const kernelName = kernelNameById.get(region.kernelId) ?? region.kernelId;
  lines.push(`  Region ${region.id} — ${kernelName} [${region.economicAxis}]`);
  lines.push(`    entry: ${region.entryNodeId}`);

  lines.push(`    nodes (${region.nodes.length}/${region.nodeBudget}):`);
  for (const node of region.nodes) {
    const marker = node.isBoss ? "  <-- BOSS" : "";
    lines.push(`      [${node.kind.padEnd(15)}] ${node.name} (${node.id})${marker}`);
  }

  lines.push(`    edges (${region.edges.length}):`);
  for (const edge of region.edges) {
    lines.push(`      ${edge.from} <-> ${edge.to}  (${edge.weightTicks} ticks)`);
  }

  if (region.dungeonClusters.length > 0) {
    lines.push(`    dungeon clusters (${region.dungeonClusters.length}):`);
    for (const cluster of region.dungeonClusters) {
      lines.push(`      ${cluster.id}  (parent: ${cluster.parentNodeId}, ${cluster.nodes.length} depths)`);
      for (const node of cluster.nodes) {
        lines.push(`          - ${node.name}`);
      }
    }
  }

  lines.push(`    factions (${region.factions.length}):`);
  for (const faction of region.factions) {
    lines.push(`      ${faction.name}  (reputation: ${faction.reputation})`);
  }

  lines.push(`    npcs (${region.npcs.length}):`);
  for (const npc of region.npcs) {
    lines.push(`      ${npc.name} — ${npc.job}, ${npc.trait}`);
  }

  return lines.join("\n");
}

/** Human-readable dump of a generated Tier — how the Gate 6 spot-check and future balance work get done. */
export function prettyPrintTier(tier: Tier): string {
  const lines: string[] = [];
  lines.push(`=== Tier ${tier.tierIndex} ===`);
  lines.push(`seed: ${tier.seed}`);
  lines.push(`band: ${tier.band}`);
  lines.push(`shape: [${tier.shape.join(", ")}]  (${tier.regions.length} regions)`);
  lines.push(`boss: ${tier.bossNodeId} in region ${tier.bossRegionId}  (${tier.bossThreatArchetype.archetypeId})`);
  lines.push("");

  for (const region of tier.regions) {
    lines.push(formatRegion(region));
    lines.push("");
  }

  return lines.join("\n");
}
