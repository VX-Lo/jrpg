import type { Rng } from "../rng/index.js";
import type { Faction, RegionKernel } from "./types.js";
import { MIN_FACTIONS_PER_REGION, MAX_FACTIONS_PER_REGION } from "./config.js";
import { pickWithoutReplacement } from "./util.js";

/**
 * A faction is a name, a home region, and a reputation scalar starting
 * at 0. No territory, no diplomacy, no simulation — that's Phase 7's
 * scope fence, and it applies here too.
 */
export function buildFactions(rng: Rng, kernel: RegionKernel, regionId: string): Faction[] {
  const count = MIN_FACTIONS_PER_REGION + rng.nextInt(MAX_FACTIONS_PER_REGION - MIN_FACTIONS_PER_REGION + 1);
  const nameIdx = pickWithoutReplacement(rng, kernel.factionNamePool.length, count);
  return nameIdx.map((idx, i) => ({
    id: `${regionId}-faction-${i}`,
    name: kernel.factionNamePool[idx],
    homeRegionId: regionId,
    reputation: 0,
  }));
}
