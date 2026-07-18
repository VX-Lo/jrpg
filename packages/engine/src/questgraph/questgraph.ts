import { createRng } from "../rng/index.js";
import type { ContentPort } from "../content/loader.js";
import type { Tier } from "../worldgen/types.js";
import { buildRegionDag } from "./dag.js";
import { emitRegionHints } from "./hints.js";
import type { RegionQuestGraph, TierQuestGraph } from "./types.js";

/** Common-tier abilities: any Ability not locked as a job's signature ability. No new schema field — reuses Phase 3's existing signature/non-signature split (see CLAUDE.md). */
export function computeCommonAbilityIds(content: ContentPort): string[] {
  const signatureIds = new Set(content.listJobs().flatMap((j) => j.signatureAbilities));
  return content.listAbilities().map((a) => a.id).filter((id) => !signatureIds.has(id));
}

/** Regional-scope threat archetypes — the pool elite-capture facts/markers draw from. Falls back to world-scope if a fixture set has no regional entries. */
export function computeCaptureThreatArchetypeIds(content: ContentPort): string[] {
  const all = content.listThreatArchetypes();
  const regional = all.filter((t) => t.scope === "regional").map((t) => t.id);
  return regional.length > 0 ? regional : all.map((t) => t.id);
}

/**
 * Builds the tier's full quest graph: one independent local DAG per
 * region (Deliverable 2), hints layered on top (Deliverable 3). Only
 * the boss region's chain is load-bearing for tier completion — the
 * boss node's own lock is the tier's win condition; every other
 * region's chain gates optional local content. See CLAUDE.md's Phase 4
 * architecture section for why this stays per-region rather than one
 * tier-spanning DAG.
 */
export function buildTierQuestGraph(tier: Tier, content: ContentPort): TierQuestGraph {
  const root = createRng(tier.seed);
  const commonAbilityIds = computeCommonAbilityIds(content);
  const captureThreatArchetypeIds = computeCaptureThreatArchetypeIds(content);
  const allRegionIds = tier.regions.map((r) => r.id);

  let bossRegionId = "";
  let bossLockId = "";

  const regions: RegionQuestGraph[] = tier.regions.map((region, regionIndex) => {
    const isBossRegion = region.id === tier.bossRegionId;
    const { graph, bossLockId: regionBossLockId, gateNodeIds } = buildRegionDag({
      root,
      tierIndex: tier.tierIndex,
      regionIndex,
      band: tier.band,
      region,
      isBossRegion,
      bossNodeId: isBossRegion ? tier.bossNodeId : undefined,
      commonAbilityIds,
      captureThreatArchetypeIds,
    });

    if (isBossRegion && regionBossLockId !== undefined) {
      bossRegionId = region.id;
      bossLockId = regionBossLockId;
    }

    const hints = emitRegionHints({
      root,
      tierIndex: tier.tierIndex,
      regionIndex,
      regionId: region.id,
      facts: graph.facts,
      locks: graph.locks,
      gateNodeIds,
      allNodeIds: region.nodes.map((n) => n.id),
      allRegionIds,
    });

    return { ...graph, hints };
  });

  if (bossRegionId === "" || bossLockId === "") {
    throw new Error(`buildTierQuestGraph: tier ${tier.tierIndex} boss region ${tier.bossRegionId} produced no boss lock`);
  }

  return { tierIndex: tier.tierIndex, seed: root.seed, bossRegionId, bossLockId, regions };
}
