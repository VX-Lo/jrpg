import type { Rng } from "../rng/index.js";
import type { Region, ThreatArchetypeRef } from "./types.js";
import { THREAT_ARCHETYPE_IDS } from "./config.js";

export interface BossPlacement {
  readonly bossRegionIndex: number;
  readonly bossNodeId: string;
  readonly bossThreatArchetype: ThreatArchetypeRef;
}

/**
 * Places exactly one boss node for the tier: a marked node with a
 * ThreatArchetype reference. Does NOT build the quest chain to it —
 * that's Phase 4's job. Boss candidates are landmark nodes only (every
 * region always has at least one, by construction — see nodes.ts), so a
 * boss is never dropped into a settlement.
 */
export function placeBoss(root: Rng, tierIndex: number, regions: readonly Region[]): BossPlacement {
  const rng = root.substream(`worldgen:tier:${tierIndex}:boss`);

  const regionIdx = rng.nextInt(regions.length);
  const region = regions[regionIdx];
  const candidates = region.nodes.filter((n) => n.kind === "landmark");
  if (candidates.length === 0) {
    throw new Error(`placeBoss: region ${region.id} has no landmark nodes to host a boss`);
  }
  const bossNode = candidates[rng.nextInt(candidates.length)];

  const archetypeId = THREAT_ARCHETYPE_IDS[rng.nextInt(THREAT_ARCHETYPE_IDS.length)];

  return {
    bossRegionIndex: regionIdx,
    bossNodeId: bossNode.id,
    bossThreatArchetype: { archetypeId },
  };
}

/** Rebuilds `regions` with the placed boss node marked `isBoss: true` (nodes are immutable). */
export function applyBoss(regions: readonly Region[], placement: BossPlacement): Region[] {
  return regions.map((region, i) => {
    if (i !== placement.bossRegionIndex) return region;
    return {
      ...region,
      nodes: region.nodes.map((node) =>
        node.id === placement.bossNodeId ? { ...node, isBoss: true } : node,
      ),
    };
  });
}
