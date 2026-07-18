import type { Rng } from "../rng/index.js";
import type { Npc, RegionKernel } from "./types.js";
import { MIN_NPCS_PER_REGION, MAX_NPCS_PER_REGION } from "./config.js";
import { pickWithoutReplacement } from "./util.js";

/**
 * Traits and jobs are generic across kernels (not proper nouns, so they
 * don't need per-kernel curation or tier-wide uniqueness) — small
 * fixture pools for now, same as the name pools.
 */
const TRAITS: readonly string[] = [
  "gruff",
  "curious",
  "superstitious",
  "quietly generous",
  "quick to anger",
  "meticulous",
  "restless",
  "unflappable",
  "sharp-tongued",
  "sentimental",
];

const JOBS: readonly string[] = [
  "fisher",
  "smith",
  "guard",
  "merchant",
  "herbalist",
  "innkeeper",
  "scout",
  "clerk",
  "trapper",
  "shrine-keeper",
];

/** A generated individual: name from the region's curated pool, one job, one trait — a person, not a class with a name attached. */
export function buildNpcs(rng: Rng, kernel: RegionKernel, regionId: string): Npc[] {
  const count = MIN_NPCS_PER_REGION + rng.nextInt(MAX_NPCS_PER_REGION - MIN_NPCS_PER_REGION + 1);
  const nameIdx = pickWithoutReplacement(rng, kernel.npcNamePool.length, count);
  return nameIdx.map((idx, i) => ({
    id: `${regionId}-npc-${i}`,
    name: kernel.npcNamePool[idx],
    originRegionId: regionId,
    trait: TRAITS[rng.nextInt(TRAITS.length)],
    job: JOBS[rng.nextInt(JOBS.length)],
  }));
}
