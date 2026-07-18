import type { Rng } from "../../rng/index.js";
import type { EventLogWriter } from "../../log/index.js";
import type { Region } from "../../worldgen/types.js";
import { ARC_BEAT_QUEST_COMPLETE_CHANCE } from "../../worldgen/config.js";
import type { ArcInstanceResult, ArcTemplate, BeatTransition } from "./types.js";

/** Referenceable-event-taxonomy-shaped payload (ROADMAP.md §12): who/where/what/magnitude generated fillers over a small authored archetype. Phase 7's Echo system reads this later; this phase only emits it correctly — no reference-roll, no Echo spawning here (scope fence). */
export interface ArcTerminalEventPayload {
  readonly archetype: "regional-arc-resolution";
  readonly regionId: string;
  readonly arcTemplateId: string;
  readonly arcTemplateName: string;
  readonly outcomeTag: ArcInstanceResult["outcomeTag"];
  readonly who: string;
  readonly where: string;
  readonly what: string;
  readonly magnitude: number;
  readonly trajectory: readonly BeatTransition[];
}

/**
 * Deliverable 7. Forward-builds the Beat trajectory node by node — the
 * same discipline as the item DAG (Deliverable 2), no place-then-
 * validate: each step is decided from the CURRENT beat's own two
 * declared transitions, never by looking ahead or backtracking. No live
 * play exists yet this phase, so completion-vs-timeout at each Beat is
 * a seeded roll standing in for it (ARC_BEAT_QUEST_COMPLETE_CHANCE) —
 * the same "simulate what a future live-play phase will log" pattern
 * Deliverable 4's mercy pass uses. World ticks accumulate on every
 * transition regardless of which branch fired, so "the arc doesn't
 * wait for the player" holds even along the success path.
 *
 * Terminates within `template.beats.length + template.terminals.length`
 * transitions by construction — every BeatDef's two transition targets
 * point at another beat or a terminal id, and non-terminal beat ids are
 * finite, so the walk cannot cycle forever without revisiting a beat;
 * ARC_MAX_BEATS still caps it defensively (Gate 4 measures the real
 * bound empirically across many seeds).
 */
export function simulateArc(
  root: Rng,
  tierIndex: number,
  regionIndex: number,
  region: Region,
  template: ArcTemplate,
): ArcInstanceResult {
  const rng = root.substream(`arcs:tier:${tierIndex}:region:${regionIndex}:beats`);
  const beatsById = new Map(template.beats.map((b) => [b.id, b]));
  const terminalsById = new Map(template.terminals.map((t) => [t.id, t]));

  let currentId = template.startBeatId;
  let value = template.initialValue;
  const trajectory: BeatTransition[] = [];
  const maxSteps = template.beats.length + template.terminals.length + 2; // defensive cap; see doc comment on why this can't actually be hit

  for (let step = 0; step < maxSteps; step++) {
    const terminal = terminalsById.get(currentId);
    if (terminal !== undefined) {
      return {
        templateId: template.id,
        regionId: region.id,
        trajectory,
        terminalBeatId: terminal.id,
        outcomeTag: terminal.outcomeTag,
        finalVariableValue: value,
      };
    }

    const beat = beatsById.get(currentId);
    if (beat === undefined) {
      throw new Error(`simulateArc: template ${template.id} references unknown beat/terminal id "${currentId}"`);
    }

    const questCompletes = rng.nextFloat() < ARC_BEAT_QUEST_COMPLETE_CHANCE;
    value += beat.delta;
    trajectory.push({
      beatId: beat.id,
      firedBy: questCompletes ? "questComplete" : "tickTimeout",
      delta: beat.delta,
      variableValueAfter: value,
    });
    currentId = questCompletes ? beat.onQuestComplete : beat.onTickTimeout;
  }

  throw new Error(`simulateArc: template ${template.id} did not reach a terminal beat within ${maxSteps} steps`);
}

/** Logs the arc's terminal event through the real EventLogWriter — a logged fact like any other, replay-reproducible. */
export function logArcTerminalEvent(log: EventLogWriter, tick: number, region: Region, template: ArcTemplate, result: ArcInstanceResult): void {
  const who = region.factions[0]?.name ?? region.id;
  const magnitude = Math.min(3, Math.max(1, Math.round(Math.abs(result.finalVariableValue - template.initialValue) / 20)));
  const payload: ArcTerminalEventPayload = {
    archetype: "regional-arc-resolution",
    regionId: region.id,
    arcTemplateId: template.id,
    arcTemplateName: template.name,
    outcomeTag: result.outcomeTag,
    who,
    where: region.id,
    what: `${template.name} resolved as ${result.outcomeTag} in ${region.id} (${template.trackedVariable} ${template.initialValue} -> ${result.finalVariableValue})`,
    magnitude,
    trajectory: result.trajectory,
  };
  log.append(tick, "arc:terminal", payload);
}
