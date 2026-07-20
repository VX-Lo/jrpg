// ---------------------------------------------------------------------
// Gold — derived from the event log (CLAUDE.md §6.6), the project's
// existing run-state pattern (Invariant: "Generator, not database").
// No bare mutable `gold: number` field exists anywhere; current gold is
// always a replay of buy/sell/reward events.
// ---------------------------------------------------------------------

import type { Event, EventLogReader, EventLogWriter } from "../log/index.js";
import { replay } from "../log/index.js";

export interface GoldRewardPayload {
  readonly amount: number;
  /** Free-text provenance (e.g. "battle:{encounterId}") — not consumed by computeGold, useful for debugging/UI. */
  readonly source: string;
}

/** Logs a gold reward (e.g. from a battle's `BattleResult.rewards.gold` once a caller applies it — battle/ itself never logs this, applying rewards is downstream per Phase 5 scope). */
export function logGoldReward(log: EventLogWriter, tick: number, amount: number, source: string): void {
  log.append(tick, "economy:reward", { amount, source } satisfies GoldRewardPayload);
}

interface BuySellPayload {
  readonly total: number;
}

/** Replays the full event log to compute current gold: + reward amounts, + sell proceeds, - buy costs. Never stored as a mutable field. */
export function computeGold(events: EventLogReader): number {
  return replay(0, events.all(), (gold: number, event: Event) => {
    switch (event.type) {
      case "economy:reward":
        return gold + (event.payload as GoldRewardPayload).amount;
      case "economy:sell":
        return gold + (event.payload as BuySellPayload).total;
      case "economy:buy":
        return gold - (event.payload as BuySellPayload).total;
      default:
        return gold;
    }
  });
}
