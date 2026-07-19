import type { Tier } from "../worldgen/types.js";
import type { ChunkScale, ZoomScale } from "./types.js";
import { CHUNK_SIZE, ROOM_CHUNK_SIZE, REVISIT_TICK_MULTIPLIER, ZOOM_TICKS_PER_STEP } from "../worldgen/config.js";

/**
 * Deliverable 6 — the four zoom scales.
 *
 * One stitching engine serves every scale that has terrain; only the chunk
 * LIBRARY and the tile size differ (roadmap §16b). The farthest zoom is the
 * exception and needs no generation at all — it IS Phase 2's logical
 * region graph, rendered abstract.
 *
 *   farthest  no chunks       fast-travel targets, the region graph itself
 *   far       wilderness      the world map; find cities, dungeons, POIs
 *   medium    settlement      towns, large dungeon exteriors
 *   closest   room            inn rooms, dungeon rooms; smallest chunks
 *
 * The tile world is TURN-BASED, not real-time: standing still is paused, a
 * step is a tick, the game increments and stops. Nothing here is an
 * animation loop, and nothing here should become one.
 */

/** The chunk library a zoom scale draws from. `farthest` has none. */
export function chunkScaleFor(zoom: ZoomScale): ChunkScale | null {
  if (zoom === "farthest") return null;
  if (zoom === "far") return "wilderness";
  if (zoom === "medium") return "settlement";
  return "room";
}

export function tileSizeFor(zoom: ZoomScale): number {
  return zoom === "closest" ? ROOM_CHUNK_SIZE : CHUNK_SIZE;
}

/**
 * Ticks for one step at a zoom, accounting for familiarity.
 *
 * The per-zoom base costs are RATIOS, not arbitrary numbers: the closest
 * zoom is the 1-tick baseline, and a far-zoom step covers roughly a whole
 * coarse cell of ground, so it costs proportionally more. That is what
 * makes tick-as-distance mean the same thing at every scale — a player who
 * crosses a region on the world map has spent about what they would have
 * spent walking it room by room.
 *
 * `alreadyCrossed` implements "movement gets cheaper as you explore"
 * (roadmap §16b), generalising Phase 2's hub-inn fast-travel discount one
 * scale down: the first crossing of a cell costs full price, later ones a
 * reduced flat rate. A found vehicle is the SAME mechanism with a
 * different modifier — which is why `modifier` exists as a plain
 * multiplier rather than a vehicle system. No vehicles are wired here.
 */
export function stepTickCost(zoom: ZoomScale, alreadyCrossed: boolean, modifier = 1): number {
  const base = ZOOM_TICKS_PER_STEP[zoom];
  const familiarity = alreadyCrossed ? REVISIT_TICK_MULTIPLIER : 1;
  return base * familiarity * modifier;
}

/** A fast-travel target on the farthest zoom. */
export interface FarthestZoomTarget {
  readonly regionId: string;
  readonly regionIndex: number;
  readonly kernelId: string;
  /** The region's entry settlement — where fast travel lands you. */
  readonly entryNodeId: string;
  /** Region ids reachable in one hop, with the tick cost of that hop. */
  readonly links: readonly { readonly regionId: string; readonly weightTicks: number }[];
}

/**
 * The farthest zoom, built with NO generation whatsoever.
 *
 * It is a view over data Phase 2 already produced — the regions and their
 * adjacency graph. Roadmap §16b calls this "pure abstraction, the logical
 * region-graph", and building terrain for it would be inventing a fourth
 * map of something already fully described. This is also why the farthest
 * zoom has no ticks-per-step: you do not take steps on it, you traverse a
 * region edge and pay that edge's own `weightTicks`.
 */
export function farthestZoomView(tier: Tier): FarthestZoomTarget[] {
  return tier.regions.map((region, regionIndex) => ({
    regionId: region.id,
    regionIndex,
    kernelId: region.kernelId,
    entryNodeId: region.entryNodeId,
    links: tier.regionEdges
      .filter((e) => e.from === region.id || e.to === region.id)
      .map((e) => ({
        regionId: e.from === region.id ? e.to : e.from,
        weightTicks: e.weightTicks,
      })),
  }));
}

/**
 * Tracks which coarse cells a party has already crossed, so
 * `stepTickCost` can charge the familiarity rate.
 *
 * Deliberately a plain caller-owned structure rather than state inside the
 * generator: terrain is a pure function of (seed, tierIndex) and must stay
 * that way (rule 2, and cold-depth). Where visited-cell state actually
 * LIVES is a run-state question, and run state is the event log's job —
 * a later live-play phase sources this from the log rather than from here.
 */
export interface FamiliarityTracker {
  readonly crossed: Set<string>;
}

export function createFamiliarityTracker(): FamiliarityTracker {
  return { crossed: new Set<string>() };
}

export function crossCell(tracker: FamiliarityTracker, cellKey: string, zoom: ZoomScale): number {
  const already = tracker.crossed.has(cellKey);
  tracker.crossed.add(cellKey);
  return stepTickCost(zoom, already);
}
