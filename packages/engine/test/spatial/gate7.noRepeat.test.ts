import { describe, expect, it } from "vitest";
import { embedTier } from "../../src/spatial/embed.js";
import { defaultChunkLibrary } from "../../src/spatial/chunks/defaultLibrary.js";
import { orientationKey } from "../../src/spatial/types.js";

/**
 * Gate 7 — no-repeat.
 *
 * Within a single region, no chunk+orientation may appear twice (a HARD
 * rule, enforced in assemble.ts). Across a tier, repetition is discouraged
 * by soft without-replacement weighting rather than forbidden.
 *
 * The point is that literal duplicate experience should be near-impossible
 * — walking past the visibly identical rock formation twice in one region
 * is the tell that terrain is generated rather than made. The hard rule
 * inside a region is what the player would actually notice; the soft
 * weighting across a tier keeps the authored skeleton from recurring
 * often without making the constraint unsatisfiable.
 */
describe("Gate 7 — no-repeat", () => {
  const library = defaultChunkLibrary();

  it("never reuses a chunk+orientation within one region, across 400 embeddings", () => {
    for (let s = 1; s <= 400; s++) {
      const tierIndex = (s % 40) + 1;
      const { tier, spatial } = embedTier(BigInt(s), tierIndex, library);

      const seenByRegion = new Map<number, Set<string>>();
      for (const placed of spatial.chunks) {
        const key = orientationKey(placed.chunkId, placed.orientation);
        let seen = seenByRegion.get(placed.regionIndex);
        if (!seen) {
          seen = new Set<string>();
          seenByRegion.set(placed.regionIndex, seen);
        }
        expect(
          seen.has(key),
          `seed ${s} tier ${tierIndex} region ${tier.regions[placed.regionIndex].id}: ` +
            `${key} reused at cell (${placed.cell.cx},${placed.cell.cy})`,
        ).toBe(false);
        seen.add(key);
      }
    }
  }, 300_000);

  it("keeps cross-region repetition low via the soft tier-wide weighting", () => {
    let totalPlacements = 0;
    let repeatedPlacements = 0;

    for (let s = 1; s <= 400; s++) {
      const tierIndex = (s % 40) + 1;
      const { spatial } = embedTier(BigInt(s), tierIndex, library);

      const uses = new Map<string, number>();
      for (const placed of spatial.chunks) {
        const key = orientationKey(placed.chunkId, placed.orientation);
        const before = uses.get(key) ?? 0;
        if (before > 0) repeatedPlacements++;
        uses.set(key, before + 1);
        totalPlacements++;
      }
    }

    const repeatRate = repeatedPlacements / totalPlacements;
    // eslint-disable-next-line no-console
    console.log(
      `Gate 7 — tier-wide repeat rate ${(repeatRate * 100).toFixed(1)}% ` +
        `(${repeatedPlacements}/${totalPlacements} placements)`,
    );

    // A tier has up to 4 regions drawing from one fixture library, so SOME
    // cross-region reuse is expected and correct. The threshold is a
    // regression tripwire: if the weighting were removed entirely, reuse
    // would climb toward the ~3/4 a uniform pick over 4 regions implies.
    expect(repeatRate).toBeLessThan(0.4);
  }, 300_000);
});
