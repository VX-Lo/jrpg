import { describe, expect, it } from "vitest";
import { worldgen } from "../../src/worldgen/worldgen.js";
import { embedInterior } from "../../src/spatial/interior.js";
import { defaultChunkLibrary } from "../../src/spatial/chunks/defaultLibrary.js";
import { floodFill } from "../../src/spatial/walkability.js";
import { TILE_CODE, coarseKey, isWalkableCode, orientationKey } from "../../src/spatial/types.js";
import { CHUNK_SIZE, ROOM_CHUNK_SIZE } from "../../src/worldgen/config.js";

/**
 * Gate 9 — the closest zoom assembles real terrain, to the same standard.
 *
 * ADDED IN THE GAP-CLOSING PASS. Before it, only `far` assembled anything:
 * `assembleTier` hardcoded the wilderness library, so no code path could
 * request another scale at all, and the CLI's `--zoom closest` printed the
 * far-zoom 160x160 map captioned "closest zoom, 1 tick/step". "One engine,
 * four scales" was a claim about resemblance rather than a fact about the
 * code.
 *
 * `closest` is deliberately the second scale proven rather than `medium`,
 * because it is architecturally furthest from `far` — half the tile size, a
 * different chunk library, a different open-connector profile (offsets 3-4
 * vs 6-9), one owner instead of region blobs, one POI instead of many. If
 * the engine had quietly depended on any of those, none of this would
 * build. `medium` sitting between the two proven extremes is a documented
 * deferral, not an unexamined gap.
 *
 * The assertions mirror Gates 1, 3, 5 and 7 one scale down: reachability,
 * enclosure, determinism, no-repeat.
 */
describe("Gate 9 — closest zoom (room scale)", () => {
  const library = defaultChunkLibrary();

  /** A spread of (seed, tier, node) triples to build interiors for. */
  function cases(count: number): { seed: bigint; tierIndex: number; nodeId: string; name: string }[] {
    const out: { seed: bigint; tierIndex: number; nodeId: string; name: string }[] = [];
    for (let s = 1; s <= count; s++) {
      const tierIndex = (s % 40) + 1;
      const tier = worldgen(BigInt(s), tierIndex);
      const nodes = tier.regions.flatMap((r) => r.nodes);
      const node = nodes[s % nodes.length];
      out.push({ seed: BigInt(s), tierIndex, nodeId: node.id, name: node.name });
    }
    return out;
  }

  it("uses the room library and the room tile size, not the wilderness ones", () => {
    const roomChunks = library.all.filter((c) => c.scale === "room");
    expect(roomChunks.length, "no room-scale chunks authored").toBeGreaterThan(0);
    for (const chunk of roomChunks) expect(chunk.size).toBe(ROOM_CHUNK_SIZE);

    const interior = embedInterior(1n, 1, worldgen(1n, 1).regions[0].nodes[0].id, library);
    expect(interior.tileSize).toBe(ROOM_CHUNK_SIZE);
    expect(interior.tileSize).not.toBe(CHUNK_SIZE);
    expect(interior.mask.width).toBe(interior.gridSize * ROOM_CHUNK_SIZE);

    // Every chunk placed really came from the room library.
    for (const placed of interior.chunks) {
      expect(library.byId.get(placed.chunkId)?.scale).toBe("room");
    }
  });

  it("every walkable tile is reachable from the entry room, across 400 interiors", () => {
    const enclosedIds = new Set(library.all.filter((c) => c.enclosedDecorative).map((c) => c.id));
    let exemptSeen = 0;
    let checked = 0;

    for (const { seed, tierIndex, nodeId } of cases(400)) {
      const interior = embedInterior(seed, tierIndex, nodeId, library);
      const { mask } = interior;

      // Flood from the entry room's walkable tiles.
      const starts: number[] = [];
      for (let ty = 0; ty < interior.tileSize; ty++) {
        for (let tx = 0; tx < interior.tileSize; tx++) {
          const at =
            (interior.entryCell.cy * interior.tileSize + ty) * mask.width +
            (interior.entryCell.cx * interior.tileSize + tx);
          if (isWalkableCode(mask.tiles[at])) starts.push(at);
        }
      }
      expect(starts.length, `${nodeId}: entry room has no walkable tile`).toBeGreaterThan(0);

      const visited = floodFill(mask, starts);

      // Tiles in an intentionally-enclosed room (a vault) are exempt — the
      // same single carve-out Gate 3 honours one scale up.
      const exempt = new Uint8Array(mask.tiles.length);
      for (const placed of interior.chunks) {
        if (!enclosedIds.has(placed.chunkId)) continue;
        exemptSeen++;
        for (let ty = 0; ty < interior.tileSize; ty++) {
          for (let tx = 0; tx < interior.tileSize; tx++) {
            exempt[
              (placed.cell.cy * interior.tileSize + ty) * mask.width + (placed.cell.cx * interior.tileSize + tx)
            ] = 1;
          }
        }
      }

      for (let at = 0; at < mask.tiles.length; at++) {
        if (!isWalkableCode(mask.tiles[at]) || exempt[at]) continue;
        checked++;
        expect(
          visited[at],
          `seed ${seed} tier ${tierIndex} interior ${nodeId}: walkable tile ${at} unreachable from the entry room`,
        ).toBe(1);
      }

      // The node's own point of interest must be reachable — an interior
      // whose POI you cannot walk to is the room-scale softlock.
      let poiTiles = 0;
      for (let ty = 0; ty < interior.tileSize; ty++) {
        for (let tx = 0; tx < interior.tileSize; tx++) {
          const at =
            (interior.poiCell.cy * interior.tileSize + ty) * mask.width +
            (interior.poiCell.cx * interior.tileSize + tx);
          if (mask.tiles[at] !== TILE_CODE.poi) continue;
          poiTiles++;
          expect(visited[at], `${nodeId}: the POI tile is not reachable from the entry`).toBe(1);
        }
      }
      expect(poiTiles, `${nodeId}: interior has no POI tile at all`).toBeGreaterThan(0);
    }

    expect(checked).toBeGreaterThan(10000);
    expect(exemptSeen, "no enclosed-decorative room ever placed — the carve-out is untested here").toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`Gate 9 — 400 interiors, ${checked} walkable tiles all reachable, ${exemptSeen} vault rooms exempted`);
  }, 300_000);

  it("is deterministic and independent of other interiors and tiers", () => {
    const target = { seed: 55n, tierIndex: 21, nodeId: worldgen(55n, 21).regions[0].nodes[2].id };

    const dump = (i: ReturnType<typeof embedInterior>): string =>
      JSON.stringify({ chunks: i.chunks, entry: i.entryCell, poi: i.poiCell, mask: Array.from(i.mask.tiles) });

    const cold = dump(embedInterior(target.seed, target.tierIndex, target.nodeId, library));

    // Build a pile of unrelated interiors and tiers in between.
    for (const { seed, tierIndex, nodeId } of cases(25)) embedInterior(seed, tierIndex, nodeId, library);
    const otherNode = worldgen(55n, 21).regions[0].nodes[0].id;
    embedInterior(55n, 21, otherNode, library);
    embedInterior(55n, 20, worldgen(55n, 20).regions[0].nodes[0].id, library);

    const warm = dump(embedInterior(target.seed, target.tierIndex, target.nodeId, library));
    expect(warm, "an interior was perturbed by other interiors being built").toBe(cold);
  }, 120_000);

  it("never reuses a chunk+orientation within one interior", () => {
    for (const { seed, tierIndex, nodeId } of cases(200)) {
      const interior = embedInterior(seed, tierIndex, nodeId, library);
      const seen = new Set<string>();
      for (const placed of interior.chunks) {
        const key = orientationKey(placed.chunkId, placed.orientation);
        expect(
          seen.has(key),
          `seed ${seed} interior ${nodeId}: ${key} reused at cell ${coarseKey(placed.cell.cx, placed.cell.cy)}`,
        ).toBe(false);
        seen.add(key);
      }
    }
  }, 300_000);

  it("rejects a request for a node that does not exist in the tier", () => {
    expect(() => embedInterior(1n, 1, "t1-r0-nope", library)).toThrow(/no logical node/);
  });
});
