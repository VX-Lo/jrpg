import type { Rng } from "../rng/index.js";
import { HINTS_PER_FACT, HINT_SPECIFICITY_CURVE } from "../worldgen/config.js";
import { pickWithoutReplacement } from "../worldgen/util.js";
import { reachableAtStep, unlockedAtStep } from "./reachability.js";
import type { Fact, Hint, ItemId, QuestFact, QuestLock, Specificity } from "./types.js";

/**
 * The id string a hint refers to, uniform across item/skill/eliteCapture
 * facts — the hint vocabulary stays small by not growing a new Fact
 * type per prerequisite kind (Deliverable 1). Always fact-unique, even
 * for skill/eliteCapture: with only a handful of Common abilities and
 * regional threat archetypes in the fixture pool, the SAME ability or
 * archetype id is very likely to be picked by more than one fact across
 * a tier (a second Weaken trainer, a second regional ambusher). Two
 * distinct facts sharing a bare content id would make a hint
 * referencing that id genuinely ambiguous about which lock it resolves
 * — narratively harmless (multiple trainers can teach the same
 * technique) but fatal for Solver A's bookkeeping, which needs each
 * hint to resolve to exactly one fact. Suffixing with the fact id keeps
 * hints unambiguous without requiring cross-region coordination to
 * dedupe content ids at generation time.
 */
export function factDisplayId(fact: QuestFact): ItemId {
  if (fact.kind === "item") return fact.itemId;
  if (fact.kind === "skill") return `${fact.abilityId}#${fact.id}`;
  return `${fact.threatArchetypeId}#${fact.id}`;
}

export interface EmitRegionHintsInput {
  readonly root: Rng;
  readonly tierIndex: number;
  readonly regionIndex: number;
  readonly regionId: string;
  readonly facts: readonly QuestFact[];
  readonly locks: readonly QuestLock[];
  readonly gateNodeIds: readonly string[];
  readonly allNodeIds: readonly string[];
  readonly allRegionIds: readonly string[];
}

/**
 * Deliverable 3. For every prerequisite fact, emits HINTS_PER_FACT
 * hints sourced from nodes reachable before the fact is needed
 * (`reachableAtStep(fact.gateStep)`), specificity increasing along
 * HINT_SPECIFICITY_CURVE the closer a hint's source node is to the
 * point where the fact becomes necessary — "closer" measured by
 * `unlockedAtStep`: a node freed up by an earlier gate is further from
 * the moment fact i is needed than one freed by gate i-1.
 *
 * `sourceNodeId` marks every hint so Solver A can only "know" it after
 * visiting that node (no god-vision) — see questgraph/solverA.ts.
 */
export function emitRegionHints(input: EmitRegionHintsInput): Hint[] {
  const { root, tierIndex, regionIndex, regionId, facts, locks, gateNodeIds, allNodeIds, allRegionIds } = input;
  const rng = root.substream(`questgraph:tier:${tierIndex}:region:${regionIndex}:hints`);
  const decoyPool = allRegionIds.filter((id) => id !== regionId);

  const hints: Hint[] = [];
  let hintCounter = 0;
  const nextHintId = () => `${regionId}-hint${hintCounter++}`;

  for (const fact of facts) {
    const candidatePool = reachableAtStep(allNodeIds, gateNodeIds, fact.gateStep).filter(
      (id) => !fact.placementNodeIds.includes(id),
    );
    const pool = candidatePool.length > 0 ? candidatePool : reachableAtStep(allNodeIds, gateNodeIds, fact.gateStep);
    if (pool.length === 0) continue;

    const n = Math.min(HINTS_PER_FACT, pool.length);
    const chosenIdx = pickWithoutReplacement(rng, pool.length, n);
    const sourceNodes = chosenIdx
      .map((i) => pool[i])
      .sort((a, b) => unlockedAtStep(a, gateNodeIds) - unlockedAtStep(b, gateNodeIds));

    const displayId = factDisplayId(fact);

    sourceNodes.forEach((sourceNodeId, rank) => {
      const curveIdx = Math.min(
        HINT_SPECIFICITY_CURVE.length - 1,
        Math.floor((rank * HINT_SPECIFICITY_CURVE.length) / n),
      );
      const specificity: Specificity = HINT_SPECIFICITY_CURVE[curveIdx];
      const targetFact = pickHintFact(rng, specificity, displayId, fact.placementNodeIds, regionId, decoyPool);
      hints.push({ id: nextHintId(), targetFact, specificity, sourceNodeId });
    });
  }

  // DependencyHint: one per compound lock, foreshadowing "the result
  // needs both of these" ahead of encountering the lock itself.
  for (const lock of locks) {
    if (lock.requiredFactIds.length < 2) continue;
    const requiredFacts = lock.requiredFactIds.map((id) => facts.find((f) => f.id === id)).filter((f): f is QuestFact => f !== undefined);
    if (requiredFacts.length < 2) continue;
    const gateStep = requiredFacts[0].gateStep;
    const pool = reachableAtStep(allNodeIds, gateNodeIds, gateStep);
    if (pool.length === 0) continue;
    const sourceNodeId = pool[rng.nextInt(pool.length)];
    const targetFact: Fact = {
      kind: "dependency",
      result: `lock:${lock.id}`,
      requires: requiredFacts.map(factDisplayId),
    };
    hints.push({ id: nextHintId(), targetFact, specificity: "medium", sourceNodeId });
  }

  return hints;
}

function pickHintFact(
  rng: Rng,
  specificity: Specificity,
  displayId: ItemId,
  placementNodeIds: readonly string[],
  trueRegionId: string,
  decoyPool: readonly string[],
): Fact {
  if (specificity === "precise") {
    // ProximityHint is node-adjacent regardless of specificity level by
    // construction (its landmark field always names a real node) — at
    // "precise" it always names a true placement node, never a decoy.
    const landmark = placementNodeIds[rng.nextInt(placementNodeIds.length)];
    return { kind: "proximity", item: displayId, landmark };
  }

  const decoyCount = specificity === "vague" ? Math.min(2, decoyPool.length) : Math.min(1, decoyPool.length);
  const useExclusion = decoyCount > 0 && rng.nextFloat() < 0.4;

  if (useExclusion) {
    const excluded = decoyPool[rng.nextInt(decoyPool.length)];
    return { kind: "exclusion", item: displayId, region: excluded };
  }

  const decoyIdx = decoyPool.length > 0 ? pickWithoutReplacement(rng, decoyPool.length, decoyCount) : [];
  const candidateRegions = [trueRegionId, ...decoyIdx.map((i) => decoyPool[i])];
  return { kind: "location", item: displayId, candidateRegions };
}
