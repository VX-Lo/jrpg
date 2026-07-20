// ---------------------------------------------------------------------
// Auto-resolve (CLAUDE.md §11): skips the presentation of the queue, not
// the passage of time. Takes no BattleInput[] — fully seed-determined —
// but still charges tickCost, still earns XP, still logs, still emits
// bestiary observations. Same BattleResult shape as the full resolver.
// ---------------------------------------------------------------------

import { AUTO_RESOLVE_THRESHOLD, BASE_ACTION_TICKS } from "../worldgen/config.js";
import type { BattleContext } from "./resolver.js";
import { avgStat, buildLiveState } from "./state.js";
import type { BattleRequest, BattleResult, LiveCombatant, PartyMemberDelta } from "./types.js";

/** partyPower / enemyPower — the ratio the caller compares against AUTO_RESOLVE_THRESHOLD (CLAUDE.md §11). */
export function computePowerRatio(party: readonly LiveCombatant[], enemies: readonly LiveCombatant[]): number {
  const partyPower = party.reduce((sum, p) => sum + p.hp * avgStat(p.stats), 0);
  const enemyPower = enemies.reduce((sum, e) => sum + e.hp * avgStat(e.stats), 0) || 1;
  return partyPower / enemyPower;
}

function xpForEnemy(enemy: LiveCombatant, partyAvgLevel: number): number {
  const base = enemy.level * 10;
  const diff = partyAvgLevel - enemy.level;
  const scalar = Math.max(0, Math.min(1.5, 1 - diff * 0.1));
  return Math.round(base * scalar);
}

/**
 * Resolves the encounter headlessly: no queue simulation, no inputs.
 * Callers must check computePowerRatio > AUTO_RESOLVE_THRESHOLD first —
 * this function asserts it and throws otherwise, so a misrouted call is
 * loud rather than silently producing an unearned win.
 */
export function autoResolveBattle(request: BattleRequest, ctx: BattleContext): BattleResult {
  const { party, enemies } = buildLiveState(request, ctx.content, ctx.startTick);
  const ratio = computePowerRatio(party, enemies);
  if (ratio <= AUTO_RESOLVE_THRESHOLD) {
    throw new Error(`autoResolveBattle: powerRatio ${ratio.toFixed(2)} does not exceed AUTO_RESOLVE_THRESHOLD (${AUTO_RESOLVE_THRESHOLD}) — run the full resolver instead.`);
  }

  const totalEnemyHp = enemies.reduce((sum, e) => sum + e.hp, 0);
  const partyPower = party.reduce((sum, p) => sum + avgStat(p.stats), 0) || 1;
  const tickCost = Math.max(BASE_ACTION_TICKS, Math.round((totalEnemyHp / partyPower) * (BASE_ACTION_TICKS / 10)));

  for (const enemy of enemies) enemy.hp = 0;
  for (const enemy of enemies) enemy.koed = true;

  ctx.log.append(ctx.startTick, "battle:auto-resolve", { encounterId: request.encounterId, ratio, tickCost });

  const partyAvgLevel = party.reduce((sum, p) => sum + p.level, 0) / Math.max(1, party.length);
  const xpTotal = enemies.reduce((sum, e) => sum + xpForEnemy(e, partyAvgLevel), 0);
  const xpPerMember = Math.floor(xpTotal / Math.max(1, party.length));
  const gold = enemies.reduce((sum, e) => sum + e.level * 5, 0);

  const partyDeltas: readonly PartyMemberDelta[] = party.map((p) => ({
    id: p.id,
    hp: p.hp,
    mp: p.mp,
    woundsGained: p.wounds,
    koed: false,
    xpEarned: xpPerMember,
    finalBoost: p.boost,
  }));

  const bestiaryObservations = enemies.map((e) => ({
    archetypeId: e.id,
    tagsRevealed: e.tags,
    weaknessesRevealed: ctx.content.getWeaknessesFor(e.tags),
  }));

  return {
    outcome: "party_win",
    partyDeltas,
    rewards: { gold, gear: [] },
    tickCost,
    log: ctx.log.toArray(),
    bestiaryObservations,
  };
}
