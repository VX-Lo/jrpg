import type { Rng } from "../rng/index.js";
import type { NodeKind, RegionKernel, WorldNode } from "./types.js";
import {
  MIN_SETTLEMENTS_PER_REGION,
  MAX_DUNGEONS_PER_REGION,
  SETTLEMENT_NODE_FRACTION,
  DUNGEON_NODE_FRACTION,
} from "./config.js";
import { pickWithoutReplacement, shuffledIndices } from "./util.js";

interface NodeKindCounts {
  readonly settlements: number;
  readonly dungeons: number;
  readonly landmarks: number;
}

export function computeNodeKindCounts(regionSize: number): NodeKindCounts {
  const settlements = Math.max(MIN_SETTLEMENTS_PER_REGION, Math.round(regionSize * SETTLEMENT_NODE_FRACTION));
  const dungeons = Math.min(MAX_DUNGEONS_PER_REGION, Math.round(regionSize * DUNGEON_NODE_FRACTION));
  const landmarks = regionSize - settlements - dungeons;
  if (landmarks < 0) {
    throw new Error(
      `computeNodeKindCounts: settlements (${settlements}) + dungeons (${dungeons}) exceed regionSize (${regionSize}) — adjust config fractions`,
    );
  }
  return { settlements, dungeons, landmarks };
}

export interface RegionNodes {
  readonly nodes: readonly WorldNode[];
  readonly entryNodeId: string;
}

/**
 * Builds this region's node list: kinds assigned from the budget, names
 * drawn without replacement from the kernel's curated pools (never
 * runtime concatenation). Node 0 is always a settlement — the region's
 * entry point is always its main town.
 */
export function buildRegionNodes(
  rng: Rng,
  tierIndex: number,
  regionIndex: number,
  regionSize: number,
  kernel: RegionKernel,
): RegionNodes {
  const counts = computeNodeKindCounts(regionSize);

  // One guaranteed entry settlement first, then the rest of the kinds shuffled.
  const restKinds: NodeKind[] = [
    ...Array(counts.settlements - 1).fill("settlement" as const),
    ...Array(counts.dungeons).fill("dungeonEntrance" as const),
    ...Array(counts.landmarks).fill("landmark" as const),
  ];
  const order = shuffledIndices(rng, restKinds.length);
  const kinds: NodeKind[] = ["settlement", ...order.map((i) => restKinds[i])];

  const settlementNameIdx = pickWithoutReplacement(rng, kernel.settlementNamePool.length, counts.settlements);
  const dungeonAndLandmarkCount = counts.dungeons + counts.landmarks;
  const landmarkNameIdx = pickWithoutReplacement(rng, kernel.landmarkNamePool.length, dungeonAndLandmarkCount);

  let settlementCursor = 0;
  let landmarkCursor = 0;
  const nodes: WorldNode[] = kinds.map((kind, i) => {
    const id = `t${tierIndex}-r${regionIndex}-n${i}`;
    const name =
      kind === "settlement"
        ? kernel.settlementNamePool[settlementNameIdx[settlementCursor++]]
        : kernel.landmarkNamePool[landmarkNameIdx[landmarkCursor++]];
    return {
      id,
      kind,
      name,
      canHostQuestNode: true,
      isBoss: false,
    };
  });

  return { nodes, entryNodeId: nodes[0].id };
}
