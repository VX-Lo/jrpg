// ---------------------------------------------------------------------
// Status effects — exactly four shapes (CLAUDE.md §5, the YAGNI
// envelope). A new status is a StatusId + STATUS_SHAPES entry + content
// data, never new engine code. All statuses always apply; resistance
// scales duration/magnitude, never whether it lands (no coin flip).
// ---------------------------------------------------------------------

import type { StatusId, TagId } from "../content/types.js";
import { addModifier, resolveVariable } from "./registry.js";
import type { LiveCombatant, LiveStatus, StatusShape } from "./types.js";

/**
 * Which of the four shapes each fixture status is. Adding a new status
 * from data means adding a StatusId to content/primitives.ts KNOWN_STATUSES
 * and an entry here — no other engine change (buff/debuff-shaped statuses
 * go through the buff/debuff primitive directly, not apply_status, since
 * that shape needs an explicit target stat that ApplyStatusParams doesn't
 * carry).
 */
export const STATUS_SHAPES: Readonly<Record<StatusId, StatusShape>> = {
  sleep: "queue_delay",
  slow: "queue_delay",
  poison: "dot",
  oiled: "vulnerability_tag",
};

export interface ApplyStatusInput {
  readonly status: StatusId;
  readonly baseDuration: number;
  readonly baseMagnitude: number;
  readonly source: string;
  readonly currentTick: number;
}

/**
 * Statuses always apply (CLAUDE.md §5 — no land/resist coin flip).
 * `statusResistance` (a registry variable, bounded [0,1]) scales down
 * duration and magnitude instead: a high-resist target eats a short/weak
 * version, a low-resist target eats the long/strong one.
 */
export function applyStatus(target: LiveCombatant, input: ApplyStatusInput): void {
  const shape = STATUS_SHAPES[input.status];
  const resistance = resolveVariable(target, "statusResistance", input.currentTick);
  const retention = 1 - resistance;
  const duration = Math.max(1, Math.round(input.baseDuration * retention));
  const magnitude = input.baseMagnitude * retention;
  const id = `${input.source}:${input.status}:${input.currentTick}`;
  const expiresAtTick = input.currentTick + duration;

  const live: LiveStatus = {
    id,
    statusId: input.status,
    shape,
    magnitude,
    appliedAtTick: input.currentTick,
    expiresAtTick,
    source: input.source,
    grantsTag: shape === "vulnerability_tag" ? input.status : undefined,
  };

  if (shape === "queue_delay") {
    target.nextActionTick += magnitude;
  }
  if (shape === "vulnerability_tag") {
    addModifier(target, {
      targetVariable: "damageTakenMult",
      operation: "multiply",
      magnitude: 1 + magnitude,
      durationTicks: duration,
      source: `status:${input.status}:${input.source}`,
      currentTick: input.currentTick,
    });
  }
  target.statuses.push(live);
}

export function hasVulnerabilityTag(actor: LiveCombatant, tag: TagId, currentTick: number): boolean {
  return actor.statuses.some((s) => s.shape === "vulnerability_tag" && s.grantsTag === tag && currentTick < s.expiresAtTick);
}

/**
 * Every tag currently granted to `actor` by an active vulnerability_tag
 * status (e.g. "oiled" granting the "oiled" tag). A setup status can only
 * make a target register as weak to something it wasn't authored with if
 * this gets merged into the weakness lookup at damage-resolution time —
 * see resolver.ts's "damage" effect case.
 */
export function activeGrantedTags(actor: LiveCombatant, currentTick: number): readonly TagId[] {
  return actor.statuses
    .filter((s) => s.shape === "vulnerability_tag" && s.grantsTag !== undefined && currentTick < s.expiresAtTick)
    .map((s) => s.grantsTag as TagId);
}

export interface StatusTickResult {
  readonly skipTurn: boolean;
  readonly dotDamage: number;
}

/**
 * Run once at the start of the affected actor's turn, before they act:
 * queue-delay statuses push their queue slot back again and skip this
 * action (sleep/slow), DoT statuses report damage for the resolver to
 * apply. Expired statuses are pruned here.
 */
export function tickStatusesOnTurnStart(actor: LiveCombatant, currentTick: number): StatusTickResult {
  let skipTurn = false;
  let dotDamage = 0;
  for (const status of actor.statuses) {
    if (currentTick >= status.expiresAtTick) continue;
    if (status.shape === "dot") dotDamage += status.magnitude;
    if (status.shape === "queue_delay") {
      actor.nextActionTick += status.magnitude;
      skipTurn = true;
    }
  }
  actor.statuses = actor.statuses.filter((s) => currentTick < s.expiresAtTick);
  return { skipTurn, dotDamage };
}

/** Remaining duration expressed in the affected actor's OWN turns, not ticks (CLAUDE.md §4 — the UI's native unit). Recomputed live so Slowing the actor visibly stretches the window. */
export function remainingTurnsForStatus(status: LiveStatus, actor: LiveCombatant, currentTick: number, currentActionCost: number): number {
  const remainingTicks = Math.max(0, status.expiresAtTick - currentTick);
  return remainingTicks / Math.max(1, currentActionCost);
}
