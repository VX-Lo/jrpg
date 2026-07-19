import { describe, expect, it } from "vitest";
import { embedTier } from "../../src/spatial/embed.js";
import { defaultChunkLibrary } from "../../src/spatial/chunks/defaultLibrary.js";
import { floodFill, poiTileOf } from "../../src/spatial/walkability.js";
import { regionPairKey } from "../../src/spatial/types.js";

/**
 * Gate 1 — walkability, FORWARD direction: no softlocks.
 *
 * "A single failure is a real softlock." Every assertion here is a literal
 * zero-failure count over the full seed set, not a rate — same standard
 * Phase 4 set for its solver gates ("any failure is a real deadlock — a
 * generation bug, not statistical noise. Fix the generator, not the
 * solver.").
 *
 * THREE PROPERTIES, because the first alone left a real gap. The original
 * Gate 1 asserted only property 1, which meant the tier-wide question —
 * can the player physically get from one region to another at all? — was
 * measured in a scratch script and never guarded by CI. Properties 2 and 3
 * close that.
 *
 *   1. WITHIN-REGION. Phase 4 builds an independent quest DAG per region,
 *      reasoning about reachability region-locally, so the DAG's own
 *      requirement is that a region's logical nodes be mutually reachable.
 *      Asserting it for ALL pairs is strictly stronger than asserting it
 *      for the gate chain, so there is no gap between what Phase 4 needs
 *      and what this proves.
 *
 *   2. TIER-WIDE. Every logical node in the tier is walkably reachable
 *      from every other. This is the property a player would actually
 *      experience as "I cannot get there", and it subsumes 1.
 *
 *   3. EVERY GRAPH EDGE IS HONOURED, directly or by a legitimate multi-hop
 *      chain. A corridor is only ever carved ON a graph edge (borders.ts),
 *      so any physical inter-region route is BY CONSTRUCTION a chain of
 *      real graph edges — a multi-hop route through genuinely connected
 *      regions, never a shortcut. Gate 2 independently confirms no
 *      unauthorised seam exists, so 3 cannot be satisfied by cheating.
 *
 * Property 3 is what makes the residual "uncarved graph edge" case
 * (measured at 3 of 2221 edges) provably harmless rather than merely rare:
 * in all three cases the two regions remain connected through other carved
 * edges, so no route the world intends is actually missing.
 */
describe("Gate 1 — walkability (forward: no softlocks)", () => {
  const library = defaultChunkLibrary();
  const SEEDS = 1000;

  it("asserts all three walkability properties with zero failures across 1000 embeddings", () => {
    let withinPairs = 0;
    let withinFailures = 0;
    let tierWidePairs = 0;
    let tierWideFailures = 0;
    let graphEdges = 0;
    let carvedDirectly = 0;
    let satisfiedByMultiHop = 0;
    let unsatisfiedEdges = 0;

    for (let s = 1; s <= SEEDS; s++) {
      const tierIndex = (s % 40) + 1;
      const { tier, spatial } = embedTier(BigInt(s), tierIndex, library);
      const indexOf = new Map(tier.regions.map((r, i) => [r.id, i]));

      // ---- property 1: within-region mutual reachability ----
      for (const region of tier.regions) {
        const tiles = region.nodes.map((n) => poiTileOf(spatial, n.id));
        if (tiles.length <= 1) continue;
        // Reachability is symmetric, so one fill from the first node
        // decides mutual reachability for the whole region.
        const reached = floodFill(spatial.mask, [tiles[0]]);
        for (let i = 1; i < tiles.length; i++) {
          withinPairs++;
          if (reached[tiles[i]] !== 1) {
            withinFailures++;
            expect.fail(
              `seed ${s} tier ${tierIndex} region ${region.id}: ${region.nodes[i].name} is NOT walkably ` +
                `reachable from ${region.nodes[0].name} — softlock`,
            );
          }
        }
      }

      // ---- property 2: tier-wide reachability of every logical node ----
      const allNodes = tier.regions.flatMap((r) => r.nodes);
      const origin = poiTileOf(spatial, allNodes[0].id);
      const reachedTier = floodFill(spatial.mask, [origin]);
      for (const node of allNodes.slice(1)) {
        tierWidePairs++;
        if (reachedTier[poiTileOf(spatial, node.id)] !== 1) {
          tierWideFailures++;
          expect.fail(
            `seed ${s} tier ${tierIndex}: ${node.name} is NOT walkably reachable from ${allNodes[0].name} ` +
              `anywhere in the tier — a region is physically cut off`,
          );
        }
      }

      // ---- property 3: every graph edge honoured, directly or multi-hop ----
      const carvedAdjacency = new Map<number, number[]>();
      tier.regions.forEach((_, i) => carvedAdjacency.set(i, []));
      for (const edge of tier.regionEdges) {
        const a = indexOf.get(edge.from) as number;
        const b = indexOf.get(edge.to) as number;
        if (!spatial.borders.connectedPairs.has(regionPairKey(a, b))) continue;
        carvedAdjacency.get(a)?.push(b);
        carvedAdjacency.get(b)?.push(a);
      }

      for (const edge of tier.regionEdges) {
        graphEdges++;
        const a = indexOf.get(edge.from) as number;
        const b = indexOf.get(edge.to) as number;

        if (spatial.borders.connectedPairs.has(regionPairKey(a, b))) {
          carvedDirectly++;
          continue;
        }

        // Not carved directly — a legitimate multi-hop chain must exist,
        // and it may only traverse edges that are themselves real, carved
        // graph edges.
        const seen = new Set<number>([a]);
        const queue = [a];
        while (queue.length > 0) {
          for (const next of carvedAdjacency.get(queue.pop() as number) ?? []) {
            if (seen.has(next)) continue;
            seen.add(next);
            queue.push(next);
          }
        }

        if (seen.has(b)) {
          satisfiedByMultiHop++;
        } else {
          unsatisfiedEdges++;
          expect.fail(
            `seed ${s} tier ${tierIndex}: graph edge ${edge.from}<->${edge.to} has no carved corridor AND ` +
              `no multi-hop route through carved edges — the world intends a route that does not physically exist`,
          );
        }
      }
    }

    // Literal zeroes, reported as counts.
    expect(withinFailures).toBe(0);
    expect(tierWideFailures).toBe(0);
    expect(unsatisfiedEdges).toBe(0);

    // Anti-vacuity: the gate must have had real work to do.
    expect(withinPairs).toBeGreaterThan(20000);
    expect(tierWidePairs).toBeGreaterThan(20000);
    expect(graphEdges).toBeGreaterThan(2000);

    // eslint-disable-next-line no-console
    console.log(
      `Gate 1 — ${SEEDS} embeddings\n` +
        `  within-region node pairs reachable : ${withinPairs}/${withinPairs} (${withinFailures} failures)\n` +
        `  tier-wide node pairs reachable     : ${tierWidePairs}/${tierWidePairs} (${tierWideFailures} failures)\n` +
        `  graph edges honoured               : ${graphEdges}/${graphEdges} ` +
        `(${carvedDirectly} direct corridor, ${satisfiedByMultiHop} multi-hop, ${unsatisfiedEdges} unsatisfied)`,
    );
  }, 900_000);
});
