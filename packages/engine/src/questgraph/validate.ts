import type { Tier } from "../worldgen/types.js";
import { computeReachabilityFixpoint } from "./solverB.js";
import type { TierQuestGraph } from "./types.js";

/**
 * Structural validity check for a generated TierQuestGraph. Returns a
 * list of violation descriptions — empty means valid. Two things this
 * checks that the solvers don't:
 *
 * 1. Every fact/trainer/capture references a real node in its own
 *    region (no dangling ids).
 * 2. No fact is ever placed on a node reserved by its own gate or a
 *    later one in the same region — the deadlock-free-by-construction
 *    invariant Deliverable 2 exists to guarantee, re-verified here
 *    rather than only trusted.
 *
 * Gate 6 (skill/elite reachability) additionally requires every skill
 * trainer and elite-capture node to be reachable at all — checked via
 * the same reachability fixpoint Solver B and Gate 1 use, but asserting
 * every SUCH NODE ends up usable (not just the boss lock), since a
 * trainer sitting behind a lock that never resolves would be a real
 * orphan Gate 1 alone wouldn't catch (Gate 1 only cares whether the
 * boss lock resolves).
 */
export function validateQuestGraph(tier: Tier, graph: TierQuestGraph): string[] {
  const violations: string[] = [];
  const { satisfiedLocks } = computeReachabilityFixpoint(tier, graph);

  for (const region of graph.regions) {
    const tierRegion = tier.regions.find((r) => r.id === region.regionId);
    if (tierRegion === undefined) {
      violations.push(`region ${region.regionId}: not present in the source Tier`);
      continue;
    }
    const nodeIds = new Set(tierRegion.nodes.map((n) => n.id));
    const gateNodeIds = region.locks.map((l) => l.lockedNodeId);
    const lockByNode = new Map(region.locks.map((l) => [l.lockedNodeId, l]));

    const nodeIsUsable = (nodeId: string): boolean => {
      const lock = lockByNode.get(nodeId);
      return lock === undefined || satisfiedLocks.has(lock.id);
    };

    for (const fact of region.facts) {
      for (const nodeId of fact.placementNodeIds) {
        if (!nodeIds.has(nodeId)) {
          violations.push(`region ${region.regionId}: fact ${fact.id} references unknown node ${nodeId}`);
        }
      }
      const reservedFromOwnGate = new Set(gateNodeIds.slice(fact.gateStep));
      for (const nodeId of fact.placementNodeIds) {
        if (reservedFromOwnGate.has(nodeId)) {
          violations.push(
            `region ${region.regionId}: fact ${fact.id} (gateStep ${fact.gateStep}) placed on node ${nodeId}, reserved by its own or a later gate`,
          );
        }
      }
    }

    for (const trainer of region.skillTrainers) {
      if (!nodeIds.has(trainer.nodeId)) {
        violations.push(`region ${region.regionId}: skill trainer ${trainer.id} references unknown node ${trainer.nodeId}`);
      } else if (!nodeIsUsable(trainer.nodeId)) {
        violations.push(`region ${region.regionId}: skill trainer ${trainer.id} sits on node ${trainer.nodeId}, behind a lock that never resolves — orphaned`);
      }
    }

    for (const capture of region.eliteCaptures) {
      if (!nodeIds.has(capture.nodeId)) {
        violations.push(`region ${region.regionId}: elite capture ${capture.id} references unknown node ${capture.nodeId}`);
      } else if (!nodeIsUsable(capture.nodeId)) {
        violations.push(`region ${region.regionId}: elite capture ${capture.id} sits on node ${capture.nodeId}, behind a lock that never resolves — orphaned`);
      }
    }
  }

  return violations;
}
