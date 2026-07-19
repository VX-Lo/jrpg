import { describe, expect, it } from "vitest";
import { embedTier } from "../../src/spatial/embed.js";
import { defaultChunkLibrary } from "../../src/spatial/chunks/defaultLibrary.js";
import { floodFill, poiTileOf } from "../../src/spatial/walkability.js";

/**
 * Gate 1 — walkability, FORWARD direction: no softlocks.
 *
 * For every logical-node adjacency the Phase 4 quest DAG requires to be
 * mutually reachable, a physically walkable tile-path must exist between
 * the nodes' embedded locations. One failure is one real softlock.
 *
 * WHAT "THE DAG REQUIRES" CASHES OUT TO, precisely. Phase 4 builds an
 * INDEPENDENT quest DAG per region (see CLAUDE.md): a region's gate
 * sequence, its facts, its hints and its trainers/captures are all drawn
 * from nodes within that region, and reachability is reasoned about
 * region-locally. So the DAG's requirement is that within each region,
 * every logical node can reach every other — which is what this asserts.
 * Asserting it for ALL pairs rather than only the gate chain is strictly
 * stronger and cheaper to state, so there is no gap between what Phase 4
 * needs and what this proves.
 *
 * Inter-region movement is Deliverable 3's corridors and is checked by
 * Gate 2's counterpart assertions.
 */
describe("Gate 1 — walkability (forward: no softlocks)", () => {
  it("every logical node in a region is walkably reachable from every other, across 1000 embeddings", () => {
    const library = defaultChunkLibrary();
    let checkedPairs = 0;

    for (let s = 1; s <= 1000; s++) {
      const tierIndex = (s % 40) + 1;
      const { tier, spatial } = embedTier(BigInt(s), tierIndex, library);

      for (let regionIndex = 0; regionIndex < tier.regions.length; regionIndex++) {
        const region = tier.regions[regionIndex];
        const tiles = region.nodes.map((n) => poiTileOf(spatial, n.id));
        if (tiles.length <= 1) continue;

        // One flood fill from the first node reaches all the others iff the
        // region's nodes are mutually reachable (reachability is symmetric).
        const reached = floodFill(spatial.mask, [tiles[0]]);
        for (let i = 1; i < tiles.length; i++) {
          checkedPairs++;
          expect(
            reached[tiles[i]],
            `seed ${s} tier ${tierIndex} region ${region.id}: ${region.nodes[i].name} ` +
              `(tile ${tiles[i]}) is NOT walkably reachable from ${region.nodes[0].name} — softlock`,
          ).toBe(1);
        }
      }
    }

    expect(checkedPairs).toBeGreaterThan(20000);
  }, 600_000);
});
