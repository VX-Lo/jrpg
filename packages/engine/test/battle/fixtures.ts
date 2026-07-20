import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContentFromDir } from "../../src/content/loader.js";
import type { ContentPort } from "../../src/content/index.js";
import type { EnemyCombatantRequest, PartyMemberRequest } from "../../src/battle/types.js";

export const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "content");
export const content: ContentPort = loadContentFromDir(CONTENT_DIR);

export function makeWarrior(overrides: Partial<PartyMemberRequest> = {}): PartyMemberRequest {
  return {
    id: "hero",
    name: "Hero",
    level: 5,
    jobId: "job:warrior",
    jobLevel: 5,
    stats: { STR: 20, INT: 5, VIT: 15, AGI: 10, PER: 8 },
    maxHp: 100,
    hp: 100,
    maxMp: 20,
    mp: 20,
    weaponArchetypeId: "weapon:sword",
    abilityLoadout: ["ability:cleave", "ability:provoke", "ability:weaken", "ability:delay-strike"],
    row: "front",
    boost: 0,
    wounds: 0,
    ...overrides,
  };
}

export function makeMage(overrides: Partial<PartyMemberRequest> = {}): PartyMemberRequest {
  return {
    id: "mage",
    name: "Mage",
    level: 5,
    jobId: "job:mage",
    jobLevel: 5,
    stats: { STR: 5, INT: 20, VIT: 8, AGI: 8, PER: 10 },
    maxHp: 60,
    hp: 60,
    maxMp: 40,
    mp: 40,
    weaponArchetypeId: "weapon:staff",
    abilityLoadout: ["ability:fireball", "ability:heal-light", "ability:haste-self", "ability:poison-dart"],
    row: "back",
    boost: 0,
    wounds: 0,
    ...overrides,
  };
}

export function makeBruiser(overrides: Partial<EnemyCombatantRequest> = {}): EnemyCombatantRequest {
  const archetype = content.getThreatArchetype("archetype:bruiser");
  return {
    id: "bruiser-1",
    name: "Bruiser",
    archetypeId: archetype.id,
    level: 5,
    stats: { STR: 15, INT: 2, VIT: 12, AGI: 6, PER: 4 },
    maxHp: 80,
    hp: 80,
    maxMp: 10,
    mp: 10,
    row: archetype.rowLine,
    tags: archetype.tags,
    rowAttack: archetype.rowAttack ?? false,
    threatBehavior: archetype.threatBehavior,
    threatThreshold: 10,
    counterMaterial: archetype.counterMaterial,
    abilities: [content.getAbility("ability:cleave")],
    breakShieldMax: 30,
    ...overrides,
  };
}

export function makeAmbusher(overrides: Partial<EnemyCombatantRequest> = {}): EnemyCombatantRequest {
  const archetype = content.getThreatArchetype("archetype:ambusher");
  return {
    id: "ambusher-1",
    name: "Ambusher",
    archetypeId: archetype.id,
    level: 5,
    stats: { STR: 12, INT: 8, VIT: 8, AGI: 14, PER: 10 },
    maxHp: 50,
    hp: 50,
    maxMp: 10,
    mp: 10,
    row: archetype.rowLine,
    tags: archetype.tags,
    rowAttack: archetype.rowAttack ?? false,
    threatBehavior: archetype.threatBehavior,
    threatThreshold: 10,
    counterMaterial: archetype.counterMaterial,
    abilities: [content.getAbility("ability:cleave")],
    breakShieldMax: 20,
    ...overrides,
  };
}
