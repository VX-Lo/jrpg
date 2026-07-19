import { describe, expect, it } from "vitest";
import { embedTier } from "../../src/spatial/embed.js";
import { defaultChunkLibrary } from "../../src/spatial/chunks/defaultLibrary.js";
import { blendStripWidth, kernelsShareBoundaryRoot } from "../../src/spatial/blend.js";
import { chunkScaleFor, farthestZoomView, stepTickCost, tileSizeFor } from "../../src/spatial/zoom.js";
import { ownerAt } from "../../src/spatial/voronoi.js";
import { CHUNK_SIZE, ROOM_CHUNK_SIZE, REVISIT_TICK_MULTIPLIER, ZOOM_TICKS_PER_STEP } from "../../src/worldgen/config.js";

describe("Deliverable 4 — blending", () => {
  const library = defaultChunkLibrary();

  it("reuses Phase 2's boundary-root data for strip width instead of new relationship data", () => {
    // The Fen and the Hollow both declare "silt-"; the Fen and Cinderreach
    // share nothing. Narrative closeness buys physical softness for free.
    expect(kernelsShareBoundaryRoot("kernel:fen", "kernel:hollow")).toBe(true);
    expect(blendStripWidth("kernel:fen", "kernel:hollow")).toBe(5);

    expect(kernelsShareBoundaryRoot("kernel:fen", "kernel:cinderreach")).toBe(false);
    expect(blendStripWidth("kernel:fen", "kernel:cinderreach")).toBe(3);

    // Symmetric, and never accidentally self-related in a way that matters.
    expect(blendStripWidth("kernel:hollow", "kernel:fen")).toBe(blendStripWidth("kernel:fen", "kernel:hollow"));
  });

  it("actually mixes palettes at corridors, and only near them", () => {
    for (const [seed, tierIndex] of [
      [42n, 5],
      [999n, 10],
      [7n, 40],
    ] as [bigint, number][]) {
      const { spatial } = embedTier(seed, tierIndex, library);

      let mixed = 0;
      for (let y = 0; y < spatial.mask.height; y++) {
        for (let x = 0; x < spatial.mask.width; x++) {
          const at = y * spatial.mask.width + x;
          const owner = ownerAt(spatial.blobs, Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
          if (owner >= 0 && spatial.visualRegion[at] !== owner) mixed++;
        }
      }

      // Some blending must happen where corridors exist...
      expect(mixed, `seed ${seed}: no palette mixing at all`).toBeGreaterThan(0);
      // ...but it is a STRIP, not a wash over the map. A blend that spread
      // everywhere would dissolve the regions it is supposed to join.
      expect(mixed / spatial.mask.tiles.length).toBeLessThan(0.05);
    }
  });
});

describe("Deliverable 6 — zoom scales", () => {
  const library = defaultChunkLibrary();

  it("maps each zoom to its own chunk library and tile size", () => {
    expect(chunkScaleFor("farthest")).toBeNull(); // pure abstraction, no terrain
    expect(chunkScaleFor("far")).toBe("wilderness");
    expect(chunkScaleFor("medium")).toBe("settlement");
    expect(chunkScaleFor("closest")).toBe("room");

    expect(tileSizeFor("closest")).toBe(ROOM_CHUNK_SIZE);
    expect(tileSizeFor("far")).toBe(CHUNK_SIZE);
    expect(ROOM_CHUNK_SIZE).toBeLessThan(CHUNK_SIZE);
  });

  it("scales ticks-per-step by zoom, with the closest zoom as the 1-tick baseline", () => {
    expect(stepTickCost("closest", false)).toBe(1);
    expect(stepTickCost("medium", false)).toBeGreaterThan(stepTickCost("closest", false));
    expect(stepTickCost("far", false)).toBeGreaterThan(stepTickCost("medium", false));
    // The farthest zoom has no per-step cost — you traverse a region edge
    // and pay that edge's own weightTicks.
    expect(ZOOM_TICKS_PER_STEP.farthest).toBe(0);
  });

  it("charges a reduced rate for re-crossing familiar ground", () => {
    const first = stepTickCost("far", false);
    const again = stepTickCost("far", true);
    expect(again).toBeLessThan(first);
    expect(again).toBeCloseTo(first * REVISIT_TICK_MULTIPLIER);

    // A vehicle is the same mechanism with a different modifier.
    expect(stepTickCost("far", false, 0.5)).toBeCloseTo(first * 0.5);
  });

  it("builds the farthest zoom purely from the logical region graph", () => {
    const { tier } = embedTier(42n, 5, library);
    const view = farthestZoomView(tier);

    expect(view).toHaveLength(tier.regions.length);
    for (const target of view) {
      expect(tier.regions.some((r) => r.id === target.regionId)).toBe(true);
      // Fast travel lands you at the region's entry settlement.
      expect(target.entryNodeId).toBe(tier.regions[target.regionIndex].entryNodeId);
      // Every link corresponds to a real Phase 2 region edge.
      for (const link of target.links) {
        expect(
          tier.regionEdges.some(
            (e) =>
              (e.from === target.regionId && e.to === link.regionId) ||
              (e.to === target.regionId && e.from === link.regionId),
          ),
        ).toBe(true);
      }
    }
  });
});
