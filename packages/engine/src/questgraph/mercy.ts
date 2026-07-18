import type { Rng } from "../rng/index.js";
import type { EventLogWriter } from "../log/index.js";
import { MERCY_ROLL_CHANCE, MERCY_TICKS_SINCE_REACHABLE_THRESHOLD } from "../worldgen/config.js";
import { factDisplayId } from "./hints.js";
import { reachableAtStep } from "./reachability.js";
import type { MercyPlayerStateInput, MercyRelocationEvent, QuestFact, RegionQuestGraph } from "./types.js";

/**
 * The set of fact ids with at least one live hint pointing at them —
 * "live" here means the hint exists in this generated region's hint
 * list, since Phase 4 has no run-state tracking hint consumption yet.
 * Every fact in these fixtures gets HINTS_PER_FACT hints whenever its
 * placement pool is nonempty, so in practice almost every generated
 * fact is pinned — that's the correct, intended shape (Mercy adds
 * hints; Mercy never moves a hinted item), not a bug. Gate 3 proves the
 * mechanism with a contrived unhinted fixture rather than hunting for a
 * naturally-occurring unhinted fact.
 */
export function computeLiveHintedFactIds(region: RegionQuestGraph): Set<string> {
  const displayIdToFactId = new Map(region.facts.map((f) => [factDisplayId(f), f.id]));
  const pinned = new Set<string>();
  for (const hint of region.hints) {
    const tf = hint.targetFact;
    if (tf.kind === "dependency") {
      for (const req of tf.requires) {
        const factId = displayIdToFactId.get(req);
        if (factId !== undefined) pinned.add(factId);
      }
    } else {
      const factId = displayIdToFactId.get(tf.item);
      if (factId !== undefined) pinned.add(factId);
    }
  }
  return pinned;
}

export interface ApplyMercyPassInput {
  readonly root: Rng;
  readonly regionKey: string; // e.g. `questgraph:tier:{n}:region:{i}` — the same key buildRegionDag used, so `:mercy` sits alongside `:dag`/`:items`/`:skills`/`:hints`.
  readonly region: RegionQuestGraph;
  readonly allNodeIds: readonly string[];
  readonly gateNodeIds: readonly string[];
  /** Caller-supplied logged player state (Deliverable 4: "a seeded roll plus logged player state"). No live playthrough exists yet this phase — a future live-play phase sources this from the real event log. */
  readonly playerState: readonly MercyPlayerStateInput[];
  readonly log: EventLogWriter;
  readonly tick: number;
}

export interface ApplyMercyPassResult {
  readonly region: RegionQuestGraph;
  readonly events: readonly MercyRelocationEvent[];
}

/**
 * Deliverable 4. Only facts with ZERO live hints pointing at them are
 * even considered; pinned facts are returned untouched, full stop —
 * see computeLiveHintedFactIds's doc comment for why that's the whole
 * point. For each eligible fact whose logged ticksSinceReachable
 * crosses the threshold, one seeded roll decides relocation; a hit
 * appends a real event to `log` (replay reproduces it exactly, same as
 * any other event) and collapses the fact onto a single new node drawn
 * from the same reachable-at-this-gate-step pool placement already
 * uses — so a relocated fact can never end up behind a lock it wasn't
 * already eligible to sit in front of.
 */
export function applyMercyPass(input: ApplyMercyPassInput): ApplyMercyPassResult {
  const { root, regionKey, region, allNodeIds, gateNodeIds, playerState, log, tick } = input;
  const rng = root.substream(`${regionKey}:mercy`);
  const pinned = computeLiveHintedFactIds(region);
  const stateByFact = new Map(playerState.map((p) => [p.factId, p.ticksSinceReachable]));
  const events: MercyRelocationEvent[] = [];

  const updatedFacts: QuestFact[] = region.facts.map((fact) => {
    if (pinned.has(fact.id)) return fact;
    const ticksSinceReachable = stateByFact.get(fact.id);
    if (ticksSinceReachable === undefined || ticksSinceReachable < MERCY_TICKS_SINCE_REACHABLE_THRESHOLD) return fact;
    if (rng.nextFloat() >= MERCY_ROLL_CHANCE) return fact;

    const candidates = reachableAtStep(allNodeIds, gateNodeIds, fact.gateStep).filter(
      (id) => !fact.placementNodeIds.includes(id),
    );
    if (candidates.length === 0) return fact;

    const toNodeId = candidates[rng.nextInt(candidates.length)];
    const event: MercyRelocationEvent = {
      factId: fact.id,
      regionId: region.regionId,
      fromNodeIds: fact.placementNodeIds,
      toNodeId,
    };
    events.push(event);
    log.append(tick, "questgraph:mercy-relocation", event);
    return { ...fact, placementNodeIds: [toNodeId] };
  });

  return { region: { ...region, facts: updatedFacts }, events };
}
