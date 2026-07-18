import type { Rng } from "../rng/index.js";
import type { Region, RegionKernel } from "./types.js";
import { buildRegionNodes } from "./nodes.js";
import { buildRegionEdges } from "./edges.js";
import { buildDungeonCluster } from "./dungeon.js";
import { buildFactions } from "./factions.js";
import { buildNpcs } from "./npcs.js";

export function generateRegion(
  root: Rng,
  tierIndex: number,
  regionIndex: number,
  regionSize: number,
  kernel: RegionKernel,
): Region {
  const regionId = `t${tierIndex}-r${regionIndex}`;
  const regionKey = `worldgen:tier:${tierIndex}:region:${regionIndex}`;

  const nodesRng = root.substream(`${regionKey}:nodes`);
  const { nodes, entryNodeId } = buildRegionNodes(nodesRng, tierIndex, regionIndex, regionSize, kernel);

  const edgesRng = root.substream(`${regionKey}:edges`);
  const edges = buildRegionEdges(edgesRng, nodes);

  const dungeonClusters = nodes
    .filter((n) => n.kind === "dungeonEntrance")
    .map((entrance) => {
      const clusterRng = root.substream(`${regionKey}:dungeon:${entrance.id}:cluster`);
      return buildDungeonCluster(clusterRng, entrance);
    });

  const factionsRng = root.substream(`${regionKey}:factions`);
  const factions = buildFactions(factionsRng, kernel, regionId);

  const npcsRng = root.substream(`${regionKey}:npcs`);
  const npcs = buildNpcs(npcsRng, kernel, regionId);

  return {
    id: regionId,
    kernelId: kernel.id,
    economicAxis: kernel.economicAxis,
    nodeBudget: regionSize,
    entryNodeId,
    nodes,
    edges,
    dungeonClusters,
    factions,
    npcs,
  };
}
