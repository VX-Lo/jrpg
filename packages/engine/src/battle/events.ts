// ---------------------------------------------------------------------
// Referenceable-event-taxonomy-shaped payloads (CLAUDE.md §12), same
// who/where/what/magnitude discipline as questgraph/arcs/arcEngine.ts's
// arc terminals. Phase 7's Echo system reads these later; this phase
// only emits them correctly — no reference-roll, no Echo spawning here.
// ---------------------------------------------------------------------

import type { EventLogWriter } from "../log/index.js";
import type { LiveCombatant } from "./types.js";

export interface BattleReferenceableEventPayload {
  readonly archetype: "battle-notable-event";
  readonly encounterId: string;
  readonly who: string;
  readonly where: string;
  readonly what: string;
  readonly magnitude: number;
}

function downedWhat(combatant: LiveCombatant): string {
  if (combatant.side === "party") return "party-member-downed";
  return combatant.isBoss ? "tier-boss-defeated" : "threat-defeated";
}

export function logCombatantDowned(log: EventLogWriter, tick: number, encounterId: string, combatant: LiveCombatant): void {
  const payload: BattleReferenceableEventPayload = {
    archetype: "battle-notable-event",
    encounterId,
    who: combatant.name,
    where: encounterId,
    what: downedWhat(combatant),
    magnitude: combatant.level,
  };
  log.append(tick, "battle:referenceable", payload);
}
