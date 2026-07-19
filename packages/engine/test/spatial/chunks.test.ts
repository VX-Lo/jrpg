import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadChunkLibraryFromDir } from "../../src/spatial/chunks/loader.js";
import { orientChunk } from "../../src/spatial/chunks/orient.js";
import { actualWalkableOffsets, validateChunk, unreachableInteriorTiles } from "../../src/spatial/chunks/validate.js";
import { ALL_ORIENTATIONS, EDGE_NAMES, orientationKey } from "../../src/spatial/types.js";
import type { Chunk, TileKind } from "../../src/spatial/types.js";
import { CHUNK_SIZE } from "../../src/worldgen/config.js";

const CHUNK_DIR = join(__dirname, "../../content/chunks");
const library = loadChunkLibraryFromDir(CHUNK_DIR);

/** Builds a chunk from ASCII rows for the negative cases below. */
function chunkFromRows(id: string, rows: readonly string[], overrides: Partial<Chunk> = {}): Chunk {
  const tiles: TileKind[][] = rows.map((r) =>
    [...r].map((g) => (g === "#" ? "impassable" : g === "P" ? "poi" : "walkable")),
  );
  const infer = (edge: (typeof EDGE_NAMES)[number]) => {
    const offsets = actualWalkableOffsets(tiles, edge, CHUNK_SIZE);
    return offsets.length > 0
      ? { kind: "open" as const, walkableTiles: offsets }
      : { kind: "wall" as const, walkableTiles: [] };
  };
  return {
    id,
    biomeTag: "common",
    scale: "wilderness",
    size: CHUNK_SIZE,
    tiles,
    connectors: { north: infer("north"), east: infer("east"), south: infer("south"), west: infer("west") },
    poiSlot: rows.some((r) => r.includes("P")),
    enclosedDecorative: false,
    ...overrides,
  };
}

const SOLID_ROWS = Array.from({ length: CHUNK_SIZE }, () => "#".repeat(CHUNK_SIZE));

describe("Deliverable 1 — chunk library", () => {
  it("loads the fixture library, and every chunk passes authoring validation", () => {
    expect(library.all.length).toBeGreaterThan(0);
    for (const chunk of library.all) expect(() => validateChunk(chunk)).not.toThrow();
  });

  it("covers every open-edge pattern the assembler can be asked for", () => {
    // The assembler satisfies a required through-path by rotating a base
    // chunk. If a pattern family were missing entirely, no rotation could
    // cover it and assembly would get stuck on a fixture gap.
    const openCounts = new Set(
      library.all.map((c) => EDGE_NAMES.filter((e) => c.connectors[e].kind === "open").length),
    );
    for (const count of [0, 1, 2, 3, 4]) expect(openCounts).toContain(count);

    // Both 2-open shapes exist: straight (opposite edges) and bend (adjacent).
    const twoOpen = library.all.filter(
      (c) => EDGE_NAMES.filter((e) => c.connectors[e].kind === "open").length === 2,
    );
    const isStraight = (c: Chunk) =>
      (c.connectors.north.kind === "open") === (c.connectors.south.kind === "open");
    expect(twoOpen.some(isStraight)).toBe(true);
    expect(twoOpen.some((c) => !isStraight(c))).toBe(true);
  });

  it("provides a chunk that can host a logical node", () => {
    expect(library.all.some((c) => c.poiSlot)).toBe(true);
  });
});

describe("Deliverable 1 — orientation derivation", () => {
  it("keeps every connector spec HONEST in all 8 orientations", () => {
    // The load-bearing test for the rotate/mirror math. If an orientation
    // moved tiles without moving connectors correspondingly, the oriented
    // chunk would claim a passage where none exists (softlock) or hide one
    // that does (shortcut) — both silently, and both only at assembly time.
    for (const chunk of library.all) {
      for (const orientation of ALL_ORIENTATIONS) {
        const o = orientChunk(chunk, orientation);
        for (const edge of EDGE_NAMES) {
          const actual = actualWalkableOffsets(o.tiles, edge, o.size);
          expect(
            [...o.connectors[edge].walkableTiles],
            `${chunk.id} ${orientationKey(chunk.id, orientation)} edge ${edge}`,
          ).toEqual(actual);
          // Only "open" edges may carry walkable tiles, after orienting too.
          if (o.connectors[edge].kind !== "open") expect(actual).toEqual([]);
        }
      }
    }
  });

  it("preserves walkable tile count and poi count under every orientation", () => {
    for (const chunk of library.all) {
      const count = (t: readonly (readonly TileKind[])[], kind: TileKind) =>
        t.flat().filter((v) => v === kind).length;
      for (const orientation of ALL_ORIENTATIONS) {
        const o = orientChunk(chunk, orientation);
        expect(count(o.tiles, "walkable")).toBe(count(chunk.tiles, "walkable"));
        expect(count(o.tiles, "poi")).toBe(count(chunk.tiles, "poi"));
      }
    }
  });

  it("four clockwise quarter-turns is the identity", () => {
    for (const chunk of library.all) {
      let t = chunk.tiles;
      for (let i = 0; i < 4; i++) {
        t = orientChunk({ ...chunk, tiles: t }, { rotationQuarters: 1, mirrored: false }).tiles;
      }
      expect(t).toEqual(chunk.tiles);
    }
  });

  it("rotation moves an asymmetric chunk's open edge to the expected side", () => {
    // common:dead-end opens north only. One clockwise turn must open east.
    const deadEnd = library.byId.get("common:dead-end");
    expect(deadEnd).toBeDefined();
    const turned = orientChunk(deadEnd as Chunk, { rotationQuarters: 1, mirrored: false });
    expect(turned.connectors.east.kind).toBe("open");
    expect(turned.connectors.north.kind).toBe("wall");
    expect(turned.connectors.east.walkableTiles.length).toBeGreaterThan(0);
  });
});

describe("Deliverable 1 — validation fails loud", () => {
  it("rejects an over-declared connector (a promised passage that does not exist)", () => {
    const rows = [...SOLID_ROWS];
    const chunk = chunkFromRows("bad:over-declared", rows, {
      connectors: {
        north: { kind: "open", walkableTiles: [6, 7, 8, 9] }, // the grid is solid
        east: { kind: "wall", walkableTiles: [] },
        south: { kind: "wall", walkableTiles: [] },
        west: { kind: "wall", walkableTiles: [] },
      },
    });
    expect(() => validateChunk(chunk)).toThrow(/DISHONEST/);
  });

  it("rejects an under-declared connector (a hidden passage past a sealed border)", () => {
    const rows = [...SOLID_ROWS];
    rows[0] = "######....######"; // genuinely walkable at 6-9 on the north edge
    const chunk = chunkFromRows("bad:under-declared", rows, {
      connectors: {
        north: { kind: "wall", walkableTiles: [] }, // ...but claims to be a wall
        east: { kind: "wall", walkableTiles: [] },
        south: { kind: "wall", walkableTiles: [] },
        west: { kind: "wall", walkableTiles: [] },
      },
    });
    expect(() => validateChunk(chunk)).toThrow(/DISHONEST|only "open" edges/);
  });

  it("rejects a sealed interior pocket unless flagged decorative", () => {
    const rows = [...SOLID_ROWS];
    rows[0] = "######....######";
    rows[8] = "#####......#####"; // a walkable strip with no route to the north opening
    const chunk = chunkFromRows("bad:pocket", rows);
    expect(() => validateChunk(chunk)).toThrow(/SEALED INTERIOR POCKET/);

    const flagged = { ...chunk, enclosedDecorative: true };
    expect(() => validateChunk(flagged)).not.toThrow();
  });

  it("rejects an 'open' edge that nothing can pass through", () => {
    const chunk = chunkFromRows("bad:open-but-solid", [...SOLID_ROWS], {
      connectors: {
        north: { kind: "open", walkableTiles: [] },
        east: { kind: "wall", walkableTiles: [] },
        south: { kind: "wall", walkableTiles: [] },
        west: { kind: "wall", walkableTiles: [] },
      },
    });
    expect(() => validateChunk(chunk)).toThrow(/open.*no walkable offsets|is a lie/);
  });

  it("rejects a poi tile on a chunk that does not declare poiSlot, and vice versa", () => {
    const rows = [...SOLID_ROWS];
    rows.fill("######....######", 0, CHUNK_SIZE);
    rows[7] = "######.P..######";
    const withPoi = chunkFromRows("bad:poi-mismatch", rows, { poiSlot: false });
    expect(() => validateChunk(withPoi)).toThrow(/poiSlot is false/);

    const noPoi = library.all.find((c) => !c.poiSlot && !c.enclosedDecorative) as Chunk;
    expect(() => validateChunk({ ...noPoi, poiSlot: true })).toThrow(/no "poi" tile/);
  });

  it("the fixture walled-garden really is an enclosed pocket (the flag is earned, not decorative)", () => {
    const garden = library.byId.get("common:walled-garden") as Chunk;
    expect(garden.enclosedDecorative).toBe(true);
    expect(unreachableInteriorTiles(garden).length).toBeGreaterThan(0);
  });
});
