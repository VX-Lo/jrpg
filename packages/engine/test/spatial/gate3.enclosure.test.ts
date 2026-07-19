import { describe, expect, it } from "vitest";
import { embedTier } from "../../src/spatial/embed.js";
import { defaultChunkLibrary } from "../../src/spatial/chunks/defaultLibrary.js";
import { unreachableWalkableTiles } from "../../src/spatial/walkability.js";

/**
 * Gate 3 — flood-fill enclosure.
 *
 * Flood-fill the assembled tile mask from the BACKBONE and assert every
 * walkable tile is reached, except tiles inside a chunk explicitly flagged
 * intentionally-enclosed decorative.
 *
 * This should pass by construction. Connector honesty (validated once per
 * chunk at authoring time) means any walkable tile at a matched seam is
 * connected to its neighbour, and the no-interior-pocket check means a
 * chunk's own walkable tiles all reach its open connectors. Together those
 * leave nowhere for a sealed pocket to form. This gate exists to confirm
 * that argument EMPIRICALLY rather than to trust it — the argument has a
 * lot of moving parts (orientation math, seam matching, assembly order),
 * and any one of them regressing would break it quietly.
 */
describe("Gate 3 — flood-fill enclosure", () => {
  it("every walkable tile is reachable from the backbone, across 1000 embeddings", () => {
    const library = defaultChunkLibrary();
    const enclosedChunkIds = new Set(
      library.all.filter((c) => c.enclosedDecorative).map((c) => c.id),
    );
    let exemptChunksSeen = 0;

    for (let s = 1; s <= 1000; s++) {
      const tierIndex = (s % 40) + 1;
      const { spatial } = embedTier(BigInt(s), tierIndex, library);

      const orphans = unreachableWalkableTiles(spatial, enclosedChunkIds);
      expect(
        orphans.length,
        `seed ${s} tier ${tierIndex}: ${orphans.length} walkable tile(s) unreachable from the backbone, ` +
          `e.g. tile index ${orphans[0]} — a sealed pocket formed during assembly`,
      ).toBe(0);

      exemptChunksSeen += spatial.chunks.filter((c) => enclosedChunkIds.has(c.chunkId)).length;
    }

    // Anti-vacuity: the exemption must actually have been exercised, or
    // this gate would also pass on a library with no enclosed chunks and
    // we'd never learn whether the carve-out works.
    expect(exemptChunksSeen).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`Gate 3 — ${exemptChunksSeen} intentionally-enclosed chunk placements exempted`);
  }, 600_000);
});
