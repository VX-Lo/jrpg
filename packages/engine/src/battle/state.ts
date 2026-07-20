// ---------------------------------------------------------------------
// Converts the pure BattleRequest into live, mutable combat state. Enemy
// stat blocks/break shields arrive already-derived from archetype+band
// (CLAUDE.md §2) — this module never reaches into worldgen/band logic.
// ---------------------------------------------------------------------

import type { ContentPort } from "../content/index.js";
import { PRIMARY_STATS } from "../content/types.js";
import type { BattleRequest, EnemyCombatantRequest, LiveCombatant, PartyMemberRequest } from "./types.js";

export function avgStat(stats: Readonly<Record<string, number>>): number {
  return PRIMARY_STATS.reduce((sum, s) => sum + stats[s], 0) / PRIMARY_STATS.length;
}

function toLivePartyMember(member: PartyMemberRequest, content: ContentPort, startTick: number): LiveCombatant {
  const job = content.getJob(member.jobId);
  const abilities = member.abilityLoadout.map((id) => content.getAbility(id));
  const weapon = content.getWeaponArchetype(member.weaponArchetypeId);
  return {
    id: member.id,
    side: "party",
    name: member.name,
    level: member.level,
    tags: job.allowedTags,
    stats: member.stats,
    maxHp: member.maxHp,
    hp: member.hp,
    maxMp: member.maxMp,
    mp: member.mp,
    row: member.row,
    nextActionTick: startTick,
    threat: 0,
    boost: member.boost,
    wounds: member.wounds,
    koed: member.hp <= 0,
    defending: false,
    statuses: [],
    modifiers: [],
    abilities,
    weaponArchetypeId: member.weaponArchetypeId,
    reach: weapon.reach,
    breakShieldMax: 0,
    breakShieldCurrent: 0,
    breakWindowUntilTick: null,
    scanned: false,
  };
}

function toLiveEnemy(enemy: EnemyCombatantRequest, startTick: number, countered: boolean): LiveCombatant {
  return {
    id: enemy.id,
    side: "enemy",
    name: enemy.name,
    level: enemy.level,
    tags: enemy.tags,
    stats: enemy.stats,
    maxHp: enemy.maxHp,
    hp: enemy.hp,
    maxMp: enemy.maxMp,
    mp: enemy.mp,
    row: enemy.row,
    nextActionTick: startTick,
    threat: 0,
    boost: 0,
    wounds: 0,
    koed: enemy.hp <= 0,
    defending: false,
    statuses: [],
    modifiers: [],
    abilities: enemy.abilities,
    rowAttack: enemy.rowAttack,
    threatBehavior: enemy.threatBehavior,
    threatThreshold: enemy.threatThreshold,
    counterMaterial: enemy.counterMaterial,
    countered,
    breakShieldMax: enemy.breakShieldMax,
    breakShieldCurrent: enemy.breakShieldMax,
    breakWindowUntilTick: null,
    scanned: false,
  };
}

export interface LiveBattleState {
  readonly party: LiveCombatant[];
  readonly enemies: LiveCombatant[];
}

export function buildLiveState(request: BattleRequest, content: ContentPort, startTick: number): LiveBattleState {
  const party = request.party.map((m) => toLivePartyMember(m, content, startTick));
  const enemies = request.encounter.map((e) => toLiveEnemy(e, startTick, request.counteredArchetypeIds.has(e.archetypeId)));
  return { party, enemies };
}
