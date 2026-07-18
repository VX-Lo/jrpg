import type { Rng } from "../rng/index.js";
import type { Region } from "../worldgen/types.js";
import {
  LOCK_INTEGRITY_BASE,
  LOCK_INTEGRITY_PER_BAND,
  QUESTGRAPH_MIN_GATES_PER_REGION,
  QUESTGRAPH_MAX_GATES_PER_REGION,
  QUESTGRAPH_MULTI_PATH_CHANCE,
  QUESTGRAPH_COMPOUND_LOCK_CHANCE,
  SKILL_TRAINERS_PER_REGION_MIN,
  SKILL_TRAINERS_PER_REGION_MAX,
  ELITE_CAPTURES_PER_REGION_MIN,
  ELITE_CAPTURES_PER_REGION_MAX,
} from "../worldgen/config.js";
import { pickWithoutReplacement } from "../worldgen/util.js";
import { reachableAtStep } from "./reachability.js";
import type { EliteCapturePlacement, QuestFact, QuestLock, RegionQuestGraph, SkillTrainerPlacement } from "./types.js";

/** Relative weights for a gate-prerequisite fact's kind. Mostly items — skill/eliteCapture prerequisites exist (a lock can require proof of a captured elite or a learned skill, not just a fetched item) but stay the minority so the golden path reads primarily as item-hunting. */
const FACT_KIND_WEIGHTS: readonly [ "item" | "skill" | "eliteCapture", number ][] = [
  ["item", 0.7],
  ["skill", 0.15],
  ["eliteCapture", 0.15],
];

function pickFactKind(rng: Rng, hasAbilities: boolean, hasThreats: boolean): "item" | "skill" | "eliteCapture" {
  const eligible = FACT_KIND_WEIGHTS.filter(
    ([kind]) => kind === "item" || (kind === "skill" && hasAbilities) || (kind === "eliteCapture" && hasThreats),
  );
  const total = eligible.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.nextFloat() * total;
  for (const [kind, w] of eligible) {
    if (roll < w) return kind;
    roll -= w;
  }
  return eligible[eligible.length - 1][0];
}

export interface BuildRegionDagInput {
  readonly root: Rng;
  readonly tierIndex: number;
  readonly regionIndex: number;
  readonly band: number;
  readonly region: Region;
  readonly isBossRegion: boolean;
  readonly bossNodeId?: string;
  readonly commonAbilityIds: readonly string[];
  readonly captureThreatArchetypeIds: readonly string[];
}

export interface BuildRegionDagResult {
  readonly graph: RegionQuestGraph;
  /** Set iff `isBossRegion` — the lock guarding the boss node itself. */
  readonly bossLockId?: string;
  /** The ordered gate sequence — exposed so hint emission (questgraph/hints.ts) can rank source-node proximity without recomputing it. */
  readonly gateNodeIds: readonly string[];
}

/**
 * Deliverables 2 + 8. Builds this region's local quest chain node by
 * node: a gate sequence is chosen up front (never place-then-validate),
 * and every fact/trainer/capture placed to satisfy gate i is drawn ONLY
 * from `reachableAtStep(i)` — nodes not reserved by gate i or any later
 * gate. This makes deadlocks structurally impossible: nothing gate i
 * needs can be locked behind gate i or anything after it.
 *
 * In the boss region, the LAST gate is forced onto the boss node itself
 * (already placed by Phase 2 — not moved, not redefined). Every other
 * region's chain terminates at its own last chosen landmark/dungeon
 * node — optional side content (skill trainers, elite captures, flavor
 * items), not load-bearing for tier completion. See CLAUDE.md's Phase 4
 * architecture section for why regions stay independent local puzzles
 * rather than one tier-spanning chain.
 */
export function buildRegionDag(input: BuildRegionDagInput): BuildRegionDagResult {
  const { root, tierIndex, regionIndex, band, region, isBossRegion, bossNodeId, commonAbilityIds, captureThreatArchetypeIds } =
    input;
  const regionKey = `questgraph:tier:${tierIndex}:region:${regionIndex}`;
  const allNodeIds = region.nodes.map((n) => n.id);

  const gateCandidatePool = region.nodes.filter(
    (n) => n.canHostQuestNode && n.id !== region.entryNodeId && !n.isBoss,
  );

  const dagRng = root.substream(`${regionKey}:dag`);
  const desiredK =
    QUESTGRAPH_MIN_GATES_PER_REGION + dagRng.nextInt(QUESTGRAPH_MAX_GATES_PER_REGION - QUESTGRAPH_MIN_GATES_PER_REGION + 1);

  let gateNodeIds: string[];
  if (isBossRegion) {
    if (bossNodeId === undefined) throw new Error("buildRegionDag: isBossRegion=true requires bossNodeId");
    const nonBossCount = Math.min(desiredK - 1, gateCandidatePool.length);
    const chosenIdx = pickWithoutReplacement(dagRng, gateCandidatePool.length, Math.max(0, nonBossCount));
    gateNodeIds = [...chosenIdx.map((i) => gateCandidatePool[i].id), bossNodeId];
  } else {
    const count = Math.min(desiredK, gateCandidatePool.length);
    const chosenIdx = pickWithoutReplacement(dagRng, gateCandidatePool.length, count);
    gateNodeIds = chosenIdx.map((i) => gateCandidatePool[i].id);
  }
  const K = gateNodeIds.length;

  const itemsRng = root.substream(`${regionKey}:items`);
  const facts: QuestFact[] = [];
  const locks: QuestLock[] = [];
  let factCounter = 0;
  const hasAbilities = commonAbilityIds.length > 0;
  const hasThreats = captureThreatArchetypeIds.length > 0;

  for (let i = 0; i < K; i++) {
    const reachable = reachableAtStep(allNodeIds, gateNodeIds, i);
    const compound = itemsRng.nextFloat() < QUESTGRAPH_COMPOUND_LOCK_CHANCE;
    const factsThisGate = compound ? 2 : 1;
    const requiredFactIds: string[] = [];

    for (let j = 0; j < factsThisGate; j++) {
      const factId = `${region.id}-fact${factCounter++}`;
      const multiPath = itemsRng.nextFloat() < QUESTGRAPH_MULTI_PATH_CHANCE && reachable.length >= 2;
      const placementCount = multiPath ? 2 : 1;
      const placementIdx = pickWithoutReplacement(itemsRng, reachable.length, placementCount);
      const placementNodeIds = placementIdx.map((idx) => reachable[idx]);

      const kind = pickFactKind(itemsRng, hasAbilities, hasThreats);
      const base = { id: factId, regionId: region.id, placementNodeIds, gateStep: i };
      if (kind === "skill") {
        const abilityId = commonAbilityIds[itemsRng.nextInt(commonAbilityIds.length)];
        facts.push({ ...base, kind: "skill", abilityId });
      } else if (kind === "eliteCapture") {
        const threatArchetypeId = captureThreatArchetypeIds[itemsRng.nextInt(captureThreatArchetypeIds.length)];
        facts.push({ ...base, kind: "eliteCapture", threatArchetypeId });
      } else {
        facts.push({ ...base, kind: "item", itemId: `item:${factId}` });
      }
      requiredFactIds.push(factId);
    }

    const integrity = Math.round(LOCK_INTEGRITY_BASE + band * LOCK_INTEGRITY_PER_BAND);
    locks.push({ id: `${region.id}-lock${i}`, lockedNodeId: gateNodeIds[i], requiredFactIds, integrity });
  }

  const skillsRng = root.substream(`${regionKey}:skills`);
  const skillTrainers: SkillTrainerPlacement[] = [];
  if (hasAbilities) {
    const count =
      SKILL_TRAINERS_PER_REGION_MIN + skillsRng.nextInt(SKILL_TRAINERS_PER_REGION_MAX - SKILL_TRAINERS_PER_REGION_MIN + 1);
    for (let t = 0; t < count; t++) {
      const step = skillsRng.nextInt(K + 1);
      const pool = reachableAtStep(allNodeIds, gateNodeIds, step);
      const nodeId = pool[skillsRng.nextInt(pool.length)];
      const abilityId = commonAbilityIds[skillsRng.nextInt(commonAbilityIds.length)];
      skillTrainers.push({ id: `${region.id}-trainer${t}`, nodeId, abilityId });
    }
  }

  const eliteCaptures: EliteCapturePlacement[] = [];
  if (hasThreats) {
    const count =
      ELITE_CAPTURES_PER_REGION_MIN + skillsRng.nextInt(ELITE_CAPTURES_PER_REGION_MAX - ELITE_CAPTURES_PER_REGION_MIN + 1);
    for (let e = 0; e < count; e++) {
      const step = skillsRng.nextInt(K + 1);
      const pool = reachableAtStep(allNodeIds, gateNodeIds, step);
      const nodeId = pool[skillsRng.nextInt(pool.length)];
      const threatArchetypeId = captureThreatArchetypeIds[skillsRng.nextInt(captureThreatArchetypeIds.length)];
      eliteCaptures.push({ id: `${region.id}-elite${e}`, nodeId, threatArchetypeId, yield: { resolved: false } });
    }
  }

  const graph: RegionQuestGraph = {
    regionId: region.id,
    facts,
    locks,
    hints: [], // filled in by questgraph/hints.ts, kept as its own build pass/substream
    skillTrainers,
    eliteCaptures,
  };

  return { graph, bossLockId: isBossRegion ? locks[locks.length - 1]?.id : undefined, gateNodeIds };
}
