import type { Ability, Job } from "./types.js";

/**
 * Access via OVERLAP, never full containment (D3). A signature ability
 * bypasses the tag check entirely — it's locked to its job by identity.
 */
export function canEquip(job: Job, ability: Ability): boolean {
  if (job.signatureAbilities.includes(ability.id)) return true;
  return ability.tags.some((tag) => job.allowedTags.includes(tag));
}

/**
 * Mastery is a PRIMARY MATCH, distinct from access. A job can equip an
 * ability via overlap and still get zero mastery bonus on it — the same
 * soft-gate house style as counter-material combat and lock integrity:
 * never blocked, only costed.
 */
export function hasMasteryBonus(job: Job, ability: Ability): boolean {
  return ability.primaryDomainTag === job.primaryTag;
}
