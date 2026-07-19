import { describe, expect, it } from "vitest";
import { embedTier } from "../../src/spatial/embed.js";
import { defaultChunkLibrary } from "../../src/spatial/chunks/defaultLibrary.js";
import { physicallyTouchingRegionPairs } from "../../src/spatial/walkability.js";
import { regionPairKey } from "../../src/spatial/types.js";

/**
 * Gate 2 — walkability, REVERSE direction: no shortcuts.
 *
 * For every pair of regions with NO edge in Phase 2's region-adjacency
 * graph, there must be NO walkable tile-path directly between their blobs.
 *
 * THIS IS THE HALF THAT FAILS SILENTLY. A missing corridor announces
 * itself the moment a player can't finish a quest; an EXTRA one never
 * does. It just quietly hands the player a route the quest DAG never
 * accounted for — skipping a detour Phase 4's two-solver gate counted on,
 * invalidating what that gate proved without breaking a single test that
 * looks at the graph. Nothing else in the project would catch it.
 *
 * "Directly" is the operative word and is asserted literally: no walkable
 * tile owned by region A may be orthogonally adjacent to a walkable tile
 * owned by region B. A path A→C→B is legal when both of those hops are
 * sanctioned; what may not exist is an unsanctioned SEAM.
 *
 * The measurement runs off the tile mask alone (see
 * physicallyTouchingRegionPairs), so it cannot inherit the assembler's own
 * belief about which seams it sealed. If assembly leaked one, this finds
 * it.
 */
describe("Gate 2 — walkability (reverse: no shortcuts)", () => {
  it("no walkable seam exists between regions Phase 2's graph does not connect, across 1000 embeddings", () => {
    const library = defaultChunkLibrary();
    let sealedPairsChecked = 0;
    let tiersWithSealedPairs = 0;

    for (let s = 1; s <= 1000; s++) {
      const tierIndex = (s % 40) + 1;
      const { tier, spatial } = embedTier(BigInt(s), tierIndex, library);

      const indexOf = new Map(tier.regions.map((r, i) => [r.id, i]));
      const graphPairs = new Set(
        tier.regionEdges.map((e) =>
          regionPairKey(indexOf.get(e.from) as number, indexOf.get(e.to) as number),
        ),
      );

      const touching = physicallyTouchingRegionPairs(spatial);

      // Every physical seam must correspond to a real graph edge.
      for (const pair of touching) {
        expect(
          graphPairs.has(pair),
          `seed ${s} tier ${tierIndex}: regions ${pair} are walkably adjacent in tile space but Phase 2's ` +
            `region graph has NO edge between them — this is an unauthorised shortcut`,
        ).toBe(true);
      }

      // And count the sealed pairs actually exercised, so a regression that
      // made every region pair graph-connected couldn't make this gate pass
      // vacuously.
      let sealedHere = 0;
      for (let a = 0; a < tier.regions.length; a++) {
        for (let b = a + 1; b < tier.regions.length; b++) {
          const pair = regionPairKey(a, b);
          if (graphPairs.has(pair)) continue;
          sealedHere++;
          sealedPairsChecked++;
          expect(
            touching.has(pair),
            `seed ${s} tier ${tierIndex}: regions ${pair} have no graph edge but ARE walkably adjacent`,
          ).toBe(false);
        }
      }
      if (sealedHere > 0) tiersWithSealedPairs++;
    }

    // Anti-vacuity: the gate must have had real sealed borders to assert on.
    expect(sealedPairsChecked).toBeGreaterThan(200);
    expect(tiersWithSealedPairs).toBeGreaterThan(200);
    // eslint-disable-next-line no-console
    console.log(
      `Gate 2 — asserted ${sealedPairsChecked} sealed region pairs across ${tiersWithSealedPairs} tiers`,
    );
  }, 600_000);
});
