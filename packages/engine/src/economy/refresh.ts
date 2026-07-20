// ---------------------------------------------------------------------
// Stock refresh on tier-boss-death (CLAUDE.md §6.4) — listens for the
// EXISTING `battle:referenceable` event Phase 5 already emits (see
// battle/events.ts's `downedWhat`, which now reports `"tier-boss-defeated"`
// when the downed combatant was flagged isBoss). No new hook, no
// parallel signal: this just scans the same event log every other
// event-reader in the codebase reads.
// ---------------------------------------------------------------------

import type { EventLogReader } from "../log/index.js";
import type { BattleReferenceableEventPayload } from "../battle/events.js";
import type { EconomyPort } from "./types.js";

/**
 * Scans `events` for `battle:referenceable` payloads with
 * `what === "tier-boss-defeated"` and refreshes every region on the
 * given port once per such event, in log order. Idempotent to call
 * repeatedly with a growing log — regions already refreshed for an
 * event `seq` are not refreshed again (tracked by the caller via
 * `sinceSeq`).
 */
export function refreshEconomyOnBossDeaths(
  port: EconomyPort,
  events: EventLogReader,
  regionIds: readonly string[],
  sinceSeq = 0,
): number {
  const bossDeaths = events
    .byType<BattleReferenceableEventPayload>("battle:referenceable")
    .filter((e) => e.seq >= sinceSeq && e.payload.what === "tier-boss-defeated");
  for (const event of bossDeaths) {
    for (const regionId of regionIds) port.refreshRegion(regionId, event.tick);
  }
  return bossDeaths.length;
}
