import type { TierQuestGraph, RegionQuestGraph } from "../questgraph/types.js";
import type { ArcInstanceResult } from "../questgraph/arcs/types.js";
import type { SolverAResult, SolverBResult } from "../questgraph/types.js";

function formatRegionQuestGraph(region: RegionQuestGraph, isBossRegion: boolean): string {
  const lines: string[] = [];
  lines.push(`  Region ${region.regionId}${isBossRegion ? "  <-- BOSS REGION" : ""}`);
  lines.push(`    locks (${region.locks.length}):`);
  for (const lock of region.locks) {
    lines.push(`      ${lock.id} @ ${lock.lockedNodeId}  requires [${lock.requiredFactIds.join(", ")}]  integrity=${lock.integrity}`);
  }
  lines.push(`    facts (${region.facts.length}):`);
  for (const fact of region.facts) {
    const label = fact.kind === "item" ? fact.itemId : fact.kind === "skill" ? fact.abilityId : fact.threatArchetypeId;
    lines.push(`      ${fact.id} [${fact.kind}] ${label}  @ [${fact.placementNodeIds.join(", ")}]  gateStep=${fact.gateStep}`);
  }
  lines.push(`    hints (${region.hints.length}):`);
  for (const hint of region.hints) {
    lines.push(`      ${hint.id} [${hint.specificity}] @ ${hint.sourceNodeId}  ${JSON.stringify(hint.targetFact)}`);
  }
  if (region.skillTrainers.length > 0) {
    lines.push(`    skill trainers (${region.skillTrainers.length}):`);
    for (const t of region.skillTrainers) lines.push(`      ${t.id} @ ${t.nodeId}  teaches ${t.abilityId}`);
  }
  if (region.eliteCaptures.length > 0) {
    lines.push(`    elite captures (${region.eliteCaptures.length}):`);
    for (const e of region.eliteCaptures) lines.push(`      ${e.id} @ ${e.nodeId}  archetype ${e.threatArchetypeId}`);
  }
  return lines.join("\n");
}

/** Human-readable dump of a generated TierQuestGraph — same purpose as prettyPrintTier, for Phase 4 balance work at depth. */
export function prettyPrintQuestGraph(graph: TierQuestGraph): string {
  const lines: string[] = [];
  lines.push(`=== Quest Graph — Tier ${graph.tierIndex} ===`);
  lines.push(`boss lock: ${graph.bossLockId} in region ${graph.bossRegionId}`);
  lines.push("");
  for (const region of graph.regions) {
    lines.push(formatRegionQuestGraph(region, region.regionId === graph.bossRegionId));
    lines.push("");
  }
  return lines.join("\n");
}

export function prettyPrintSolverResults(a: SolverAResult, b: SolverBResult): string {
  return [
    `Solver B (brute force): ${b.outcome}`,
    `Solver A (inference):   ${a.outcome}  guesses=${a.guessCount}  tedium=${a.tedium.toFixed(3)}`,
  ].join("\n");
}

export function prettyPrintArcs(results: readonly ArcInstanceResult[]): string {
  const lines: string[] = [`=== Regional Arcs (${results.length}) ===`];
  for (const r of results) {
    const beats = r.trajectory.map((t) => `${t.beatId}(${t.firedBy === "questComplete" ? "done" : "timeout"})`).join(" -> ");
    lines.push(`  ${r.regionId}: ${r.templateId} -> ${r.outcomeTag}  [${beats}]  final=${r.finalVariableValue}`);
  }
  return lines.join("\n");
}
