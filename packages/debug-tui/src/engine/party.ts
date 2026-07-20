// ---------------------------------------------------------------------
// DEBUG-ONLY party assembly. PartySpec in packages/engine/src/harness is
// still a near-empty stub (memberNames only) — nothing builds a real
// PartyMemberRequest from fixture content yet. This is the minimal
// scaffold to unblock the Battle tab, NOT the real Phase 11
// run-lifecycle party system (recruitment, persistence, chronicle
// callback own their own later work). See CLAUDE.md "Debug tooling" §5.
// ---------------------------------------------------------------------

import { EQUIP_CAP } from "../../../engine/src/worldgen/config.js";
import { canEquip } from "../../../engine/src/content/access.js";
import type { JobId } from "../../../engine/src/content/types.js";
import type { PartyMemberRequest } from "../../../engine/src/battle/types.js";
import type { ContentPort } from "./access.js";

/** UNCALIBRATED debug placeholders — no real HP/MP curve exists yet either. */
function debugMaxHp(vit: number): number {
  return 20 + Math.round(vit * 8);
}
function debugMaxMp(int: number): number {
  return 10 + Math.round(int * 6);
}

export function debugBuildPartyMember(content: ContentPort, jobId: JobId, id: string, level: number): PartyMemberRequest {
  const job = content.getJob(jobId);
  const stats = {
    STR: job.statGrowth.STR * level,
    INT: job.statGrowth.INT * level,
    VIT: job.statGrowth.VIT * level,
    AGI: job.statGrowth.AGI * level,
    PER: job.statGrowth.PER * level,
  };
  const eligibleByTag = content.listAbilities().filter((a) => canEquip(job, a));
  const loadout = [...new Set([...job.signatureAbilities, ...eligibleByTag.map((a) => a.id)])].slice(0, EQUIP_CAP);
  const maxHp = debugMaxHp(stats.VIT);
  const maxMp = debugMaxMp(stats.INT);
  const weaponArchetypeId = job.equipProficiencies[0];
  if (!weaponArchetypeId) throw new Error(`debug party assembler: job "${jobId}" has no equip proficiencies`);

  return {
    id,
    name: job.name,
    level,
    jobId: job.id,
    jobLevel: level,
    stats,
    maxHp,
    hp: maxHp,
    maxMp,
    mp: maxMp,
    weaponArchetypeId,
    abilityLoadout: loadout,
    row: job.defaultRow,
    boost: 0,
    wounds: 0,
  };
}

/** A default preset party that loads instantly with zero setup (§2 Tab 3 ask). */
export function debugPresetParty(content: ContentPort, level = 5): PartyMemberRequest[] {
  return [
    debugBuildPartyMember(content, "job:warrior", "1-hero", level),
    debugBuildPartyMember(content, "job:mage", "2-mage", level),
  ];
}
