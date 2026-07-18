import type { Tier } from "../worldgen/types.js";
import { buildTierIndex } from "./solverShared.js";
import type { SolverBResult, TierQuestGraph } from "./types.js";

export interface ReachabilityFixpoint {
  readonly acquired: ReadonlySet<string>;
  readonly satisfiedLocks: ReadonlySet<string>;
}

/**
 * Full reachability search, hints ignored entirely: every fact whose
 * placement node is currently usable is immediately acquired. Fixpoint
 * iteration handles ordering for free — a fact placed on a node that's
 * still locked by an earlier unsatisfied gate simply becomes acquirable
 * once that gate opens on a later pass. Shared by Solver B (Deliverable
 * 6, Gate 1 — is the boss lock reachable at all) and Gate 6 (are skill/
 * elite placements ever orphaned anywhere in the tier, not just on the
 * golden path).
 */
export function computeReachabilityFixpoint(tier: Tier, graph: TierQuestGraph): ReachabilityFixpoint {
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

  return { acquired, satisfiedLocks };
}

/**
 * Deliverable 6. B succeeding where A fails is the tedium signature
 * (Gate 2); this solver's only job is to prove the graph is
 * structurally completable at all (Gate 1) — it says nothing about
 * whether doing so is a puzzle or tedium.
 */
export function solveB(tier: Tier, graph: TierQuestGraph): SolverBResult {
  const { satisfiedLocks } = computeReachabilityFixpoint(tier, graph);
  return { outcome: satisfiedLocks.has(graph.bossLockId) ? "success" : "failure" };
}
