import type { Tier } from "../worldgen/types.js";
import { buildTierIndex } from "./solverShared.js";
import type { SolverBResult, TierQuestGraph } from "./types.js";

/**
 * Deliverable 6. Solver A's control group: full reachability search,
 * hints ignored entirely, every fact whose placement node is currently
 * usable is immediately acquired. Fixpoint iteration handles ordering
 * for free — a fact placed on a node that's still locked by an earlier
 * unsatisfied gate simply becomes acquirable once that gate opens on a
 * later pass. B succeeding where A fails is the tedium signature (Gate
 * 2); this solver's only job is to prove the graph is structurally
 * completable at all (Gate 1) — it says nothing about whether doing so
 * is a puzzle or tedium.
 */
export function solveB(tier: Tier, graph: TierQuestGraph): SolverBResult {
  const index = buildTierIndex(tier, graph);
  const acquired = new Set<string>();
  const satisfiedLocks = new Set<string>();

  let changed = true;
  while (changed) {
    changed = false;

    const lockedNodeIds = new Set(
      index.allLocks.filter((l) => !satisfiedLocks.has(l.id)).map((l) => l.lockedNodeId),
    );

    for (const fact of index.factsById.values()) {
      if (acquired.has(fact.id)) continue;
      if (fact.placementNodeIds.some((nodeId) => !lockedNodeIds.has(nodeId))) {
        acquired.add(fact.id);
        changed = true;
      }
    }

    for (const lock of index.allLocks) {
      if (satisfiedLocks.has(lock.id)) continue;
      if (lock.requiredFactIds.every((id) => acquired.has(id))) {
        satisfiedLocks.add(lock.id);
        changed = true;
      }
    }
  }

  return { outcome: satisfiedLocks.has(graph.bossLockId) ? "success" : "failure" };
}
