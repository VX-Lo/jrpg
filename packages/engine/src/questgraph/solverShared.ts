import type { Tier } from "../worldgen/types.js";
import type { Hint, QuestFact, QuestLock, TierQuestGraph } from "./types.js";

/** Tier-wide indices both solvers build once, so neither has to grep the region list on every step. Building this index does not itself constitute god-vision: node existence (the map) is public; hint CONTENT, lock requirements, and fact placement are not exposed here — only lookups by id. */
export interface TierIndex {
  readonly allNodeIds: readonly string[];
  readonly nodeRegion: ReadonlyMap<string, string>;
  readonly factsById: ReadonlyMap<string, QuestFact>;
  readonly lockByNode: ReadonlyMap<string, QuestLock>;
  readonly hintsByNode: ReadonlyMap<string, readonly Hint[]>;
  readonly allLocks: readonly QuestLock[];
}

export function buildTierIndex(tier: Tier, graph: TierQuestGraph): TierIndex {
  const allNodeIds: string[] = [];
  const nodeRegion = new Map<string, string>();
  const factsById = new Map<string, QuestFact>();
  const lockByNode = new Map<string, QuestLock>();
  const hintsByNode = new Map<string, Hint[]>();
  const allLocks: QuestLock[] = [];

  const regionNodeIds = new Map(tier.regions.map((r) => [r.id, r.nodes.map((n) => n.id)]));

  for (const region of graph.regions) {
    for (const nodeId of regionNodeIds.get(region.regionId) ?? []) {
      allNodeIds.push(nodeId);
      nodeRegion.set(nodeId, region.regionId);
    }
    for (const fact of region.facts) factsById.set(fact.id, fact);
    for (const lock of region.locks) {
      lockByNode.set(lock.lockedNodeId, lock);
      allLocks.push(lock);
    }
    for (const hint of region.hints) {
      const list = hintsByNode.get(hint.sourceNodeId) ?? [];
      list.push(hint);
      hintsByNode.set(hint.sourceNodeId, list);
    }
  }

  return { allNodeIds, nodeRegion, factsById, lockByNode, hintsByNode, allLocks };
}

/** A node is usable (its fact content collectible) iff it isn't the lockedNodeId of a currently-unsatisfied lock. Locks gate usability, never physical presence — see questgraph/reachability.ts. */
export function isNodeUsable(nodeId: string, index: TierIndex, satisfiedLocks: ReadonlySet<string>): boolean {
  const lock = index.lockByNode.get(nodeId);
  if (lock === undefined) return true;
  return satisfiedLocks.has(lock.id);
}
