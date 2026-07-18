import type { Tier } from "../worldgen/types.js";
import { factDisplayId } from "./hints.js";
import type { Hint, QuestFact, QuestLock, SolverAResult, TierQuestGraph } from "./types.js";

/**
 * Deliverable 5. Evidence-constrained inference solver.
 *
 * Scope: the boss region's local DAG only. Each region's facts live
 * entirely within that region (a documented Phase 4 architecture
 * choice — see CLAUDE.md), and Location/Exclusion hint narrowing works
 * by set intersection on region-id *labels* without ever requiring a
 * physical visit to a decoy region — so the boss region's own chain is
 * the tier's whole "golden path," and every other region is optional
 * side content Gate 6 checks structurally instead. Restricting Solver A
 * to the boss region keeps guessCount/tedium meaningful: a guess here
 * is always a real hole in the golden path's hint economy, never noise
 * from wandering unrelated regions.
 *
 * THE rule that distinguishes this from Solver B (rule 4): VISITING a
 * node (walking up to it, reading whatever hints/lock-plaques are
 * there) is always free and never touches fact content. INTERACTING
 * with a node — checking whether it actually holds a specific fact —
 * only ever happens when a fact's candidate set has narrowed to exactly
 * that node (deduction) or when every other option is exhausted and a
 * choice among remaining candidates is unavoidable (a logged guess).
 * Earlier drafts of this solver auto-resolved facts against every
 * visited node regardless of narrowing, which is Solver B wearing
 * bookkeeping — caught before this file shipped by noticing Solver A
 * was completing every test seed with zero guesses, a "too good to be
 * true" signal. Splitting visit (passive) from interact (evidence-
 * gated) is what makes guessCount an honest measurement of the hint
 * economy's holes rather than a constant zero.
 *
 * A node is USABLE once its own lock (if any) is satisfied — see
 * questgraph/reachability.ts's "locks gate usability, not traversal"
 * note. A locked node can always be walked up to (revealing its lock's
 * required fact ids — the keyhole-shape rule, otherwise a fact with a
 * thin hint economy could be permanently undiscoverable, which would be
 * a generation bug Gate 2 should catch, not a solver bug), but it
 * cannot be interacted with until usable.
 */
export function solveA(tier: Tier, graph: TierQuestGraph): SolverAResult {
  const bossRegion = graph.regions.find((r) => r.regionId === graph.bossRegionId);
  const bossNodeList = tier.regions.find((r) => r.id === graph.bossRegionId);
  if (bossRegion === undefined || bossNodeList === undefined) {
    throw new Error(`solveA: boss region ${graph.bossRegionId} not found`);
  }

  const allRegionIds = tier.regions.map((r) => r.id);
  const allNodeIds = bossNodeList.nodes.map((n) => n.id);
  const factsById = new Map<string, QuestFact>(bossRegion.facts.map((f) => [f.id, f]));
  const lockByNode = new Map<string, QuestLock>(bossRegion.locks.map((l) => [l.lockedNodeId, l]));
  const hintsByNode = new Map<string, Hint[]>();
  for (const hint of bossRegion.hints) {
    const list = hintsByNode.get(hint.sourceNodeId) ?? [];
    list.push(hint);
    hintsByNode.set(hint.sourceNodeId, list);
  }
  const displayIdToFactId = new Map(bossRegion.facts.map((f) => [factDisplayId(f), f.id]));

  interface Knowledge {
    readonly regionCandidates: Set<string>;
    readonly nodeCandidates: Set<string>;
  }
  const knowledge = new Map<string, Knowledge>();
  const acquired = new Set<string>();
  const satisfiedLocks = new Set<string>();
  const visited = new Set<string>(); // hints read at this node (passive — never touches fact content)
  const lockRequirementKnown = new Set<string>(); // encountered: walked up to, learned requiredFactIds
  let guessCount = 0;
  let resolvedCount = 0;
  const trace: string[] = [];

  const isUsable = (nodeId: string): boolean => {
    const lock = lockByNode.get(nodeId);
    return lock === undefined || satisfiedLocks.has(lock.id);
  };

  const updateSatisfiedLocks = (): void => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const lock of bossRegion.locks) {
        if (satisfiedLocks.has(lock.id)) continue;
        if (lock.requiredFactIds.every((id) => acquired.has(id))) {
          satisfiedLocks.add(lock.id);
          changed = true;
        }
      }
    }
  };

  /** Checks whether `nodeId` actually holds `factId` — the ONLY place ground truth is consulted. Must only be called when evidence justifies it (deduction or a logged guess), never during passive visiting. */
  const interact = (factId: string, nodeId: string, isGuess: boolean): void => {
    const fact = factsById.get(factId);
    const k = knowledge.get(factId);
    if (fact === undefined || k === undefined || acquired.has(factId)) return;
    trace.push(`${isGuess ? "guess" : "interact"} ${factId} @ ${nodeId}`);
    if (fact.placementNodeIds.includes(nodeId)) {
      acquired.add(factId);
      knowledge.delete(factId);
      resolvedCount++;
      trace.push(`acquire ${factId} @ ${nodeId}`);
      updateSatisfiedLocks();
    } else {
      k.nodeCandidates.delete(nodeId);
    }
  };

  const discover = (factId: string): void => {
    if (acquired.has(factId) || knowledge.has(factId)) return;
    if (!factsById.has(factId)) return;
    knowledge.set(factId, { regionCandidates: new Set(allRegionIds), nodeCandidates: new Set(allNodeIds) });
  };

  const narrowRegion = (factId: string, allow: Set<string> | undefined, exclude: string | undefined): void => {
    discover(factId);
    const k = knowledge.get(factId);
    if (k === undefined) return; // already acquired
    if (allow !== undefined) for (const r of [...k.regionCandidates]) if (!allow.has(r)) k.regionCandidates.delete(r);
    if (exclude !== undefined) k.regionCandidates.delete(exclude);
    if (!k.regionCandidates.has(graph.bossRegionId)) {
      // A hint's decoys narrowed the region set away from the boss
      // region entirely — impossible for a truthful hint about a fact
      // that genuinely lives here (see hints.ts), guarded rather than
      // silently producing an unsolvable node set.
      k.regionCandidates.add(graph.bossRegionId);
    }
  };

  const narrowNode = (factId: string, nodeId: string): void => {
    discover(factId);
    const k = knowledge.get(factId);
    if (k === undefined) return;
    k.nodeCandidates.clear();
    k.nodeCandidates.add(nodeId);
    k.regionCandidates.clear();
    k.regionCandidates.add(graph.bossRegionId);
  };

  const applyHint = (hint: Hint): void => {
    const tf = hint.targetFact;
    if (tf.kind === "location") {
      const factId = displayIdToFactId.get(tf.item);
      if (factId !== undefined) narrowRegion(factId, new Set(tf.candidateRegions), undefined);
    } else if (tf.kind === "exclusion") {
      const factId = displayIdToFactId.get(tf.item);
      if (factId !== undefined) narrowRegion(factId, undefined, tf.region);
    } else if (tf.kind === "proximity") {
      const factId = displayIdToFactId.get(tf.item);
      if (factId !== undefined) narrowNode(factId, tf.landmark);
    } else {
      for (const req of tf.requires) {
        const factId = displayIdToFactId.get(req);
        if (factId !== undefined) discover(factId);
      }
    }
  };

  /** Passive: read whatever's here. Never checks fact content — see the module doc comment on why that split matters. */
  const visitNode = (nodeId: string): void => {
    visited.add(nodeId);
    trace.push(`visit ${nodeId}`);
    const lock = lockByNode.get(nodeId);
    if (lock !== undefined) {
      for (const fid of lock.requiredFactIds) discover(fid);
      lockRequirementKnown.add(lock.id);
    }
    for (const hint of hintsByNode.get(nodeId) ?? []) applyHint(hint);
  };

  const encounterLockedNode = (nodeId: string): void => {
    const lock = lockByNode.get(nodeId);
    if (lock === undefined) return;
    for (const fid of lock.requiredFactIds) discover(fid);
    lockRequirementKnown.add(lock.id);
    trace.push(`encounter locked ${nodeId} (lock ${lock.id})`);
  };

  const totalFacts = bossRegion.facts.length;
  const maxSteps = allNodeIds.length * 2 + totalFacts * (allNodeIds.length + 2) + 50;
  let steps = 0;

  while (bossRegion.locks.length > 0 && !satisfiedLocks.has(graph.bossLockId)) {
    steps++;
    if (steps > maxSteps) {
      return { outcome: "failure", guessCount, tedium: resolvedCount > 0 ? guessCount / resolvedCount : 0, trace };
    }

    // (a) any currently-usable, unvisited node — always free (pure information gathering).
    const usableUnvisited = allNodeIds.find((id) => !visited.has(id) && isUsable(id));
    if (usableUnvisited !== undefined) {
      visitNode(usableUnvisited);
      continue;
    }

    // (b) any locked node whose own requirement isn't yet known — walking up to a locked door is always free.
    const unknownLocked = allNodeIds.find((id) => {
      const lock = lockByNode.get(id);
      return lock !== undefined && !satisfiedLocks.has(lock.id) && !lockRequirementKnown.has(lock.id);
    });
    if (unknownLocked !== undefined) {
      encounterLockedNode(unknownLocked);
      continue;
    }

    // (c) deduction: a known, unacquired fact narrowed to exactly one USABLE candidate.
    let acted = false;
    for (const [factId, k] of knowledge) {
      if (acquired.has(factId)) continue;
      const usableCandidates = [...k.nodeCandidates].filter(isUsable);
      if (usableCandidates.length === 1) {
        interact(factId, usableCandidates[0], false);
        acted = true;
        break;
      }
    }
    if (acted) continue;

    // (d) guess: forward progress requires a choice among multiple remaining candidates. Logged, not a failure.
    for (const [factId, k] of knowledge) {
      if (acquired.has(factId)) continue;
      const usableCandidates = [...k.nodeCandidates].filter(isUsable).sort();
      if (usableCandidates.length > 1) {
        guessCount++;
        interact(factId, usableCandidates[0], true);
        acted = true;
        break;
      }
    }
    if (acted) continue;

    // (e) truly stuck — every node accounted for, no actionable candidate anywhere. A generation bug, not expected in valid output.
    return { outcome: "failure", guessCount, tedium: resolvedCount > 0 ? guessCount / resolvedCount : 0, trace };
  }

  return { outcome: "success", guessCount, tedium: resolvedCount > 0 ? guessCount / resolvedCount : 0, trace };
}
