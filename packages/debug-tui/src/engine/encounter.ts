// ---------------------------------------------------------------------
// DEBUG-ONLY encounter building. No archetype+band -> EnemyCombatantRequest
// formula exists in packages/engine yet (Phase 5 Decisions #3/#4 — there
// was no live caller to get it right for). This tool is that first
// caller, so it needs *something* — simple, explicitly placeholder
// scaling, not a Phase 6/7 balance pass. See CLAUDE.md "Debug tooling" §5.
// ---------------------------------------------------------------------

import type { ThreatArchetype } from "../../../engine/src/content/types.js";
import type { EnemyCombatantRequest } from "../../../engine/src/battle/types.js";
import type { ContentPort, Rng } from "./access.js";

export function debugBuildEnemy(content: ContentPort, archetype: ThreatArchetype, band: number, id: string): EnemyCombatantRequest {
  const level = Math.max(1, Math.round(band));
  const power = archetype.powerTier;
  const statBase = 4 + band * 1.5 + power * 2;
  const stats = {
    STR: Math.round(statBase),
    INT: Math.round(statBase * 0.6),
    VIT: Math.round(statBase),
    AGI: Math.round(statBase * 0.7),
    PER: Math.round(statBase * 0.5),
  };
  const maxHp = Math.round(30 + band * 12 * power);
  const maxMp = Math.round(10 + band * 4);
  const matchingAbilities = content.listAbilities().filter((a) => a.tags.some((t) => archetype.tags.includes(t)));
  const abilities = matchingAbilities.length > 0 ? matchingAbilities : [content.getAbility("ability:cleave")];

  return {
    id,
    name: archetype.name,
    archetypeId: archetype.id,
    level,
    stats,
    maxHp,
    hp: maxHp,
    maxMp,
    mp: maxMp,
    row: archetype.rowLine,
    tags: archetype.tags,
    rowAttack: archetype.rowAttack ?? false,
    threatBehavior: archetype.threatBehavior,
    threatThreshold: 10,
    counterMaterial: archetype.counterMaterial,
    abilities,
    breakShieldMax: Math.round(15 + band * 5 * power),
  };
}

/** Rolls `count` random threat archetypes at `band` — the "reroll encounter" variety loop. */
export function debugRollEncounter(content: ContentPort, band: number, rng: Rng, count = 1): EnemyCombatantRequest[] {
  const pool = content.listThreatArchetypes();
  const out: EnemyCombatantRequest[] = [];
  for (let i = 0; i < count; i++) {
    const archetype = pool[rng.nextInt(pool.length)];
    out.push(debugBuildEnemy(content, archetype, band, `${i + 1}-${archetype.id.replace("archetype:", "")}`));
  }
  return out;
}
