import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type {
  Chunk,
  ChunkConnectors,
  ChunkLibrary,
  ChunkScale,
  ConnectorKind,
  ConnectorSpec,
  EdgeName,
  TileKind,
} from "../types.js";
import { EDGE_NAMES } from "../types.js";
import { validateChunk, actualWalkableOffsets, expectedSizeForScale } from "./validate.js";

/**
 * Chunk library loader. Same shape as Phase 3's ContentPort: one file per
 * entity so adding terrain is "drop a file in", TOML on disk, validated
 * loudly at load.
 *
 * Chunks are authored as ASCII rows, because a 16x16 tile mask written as
 * a nested numeric array is unreviewable and a wrong tile would be
 * invisible in code review. As glyphs, the chunk looks like what it is.
 */

/** Authoring glyphs. Deliberately few — see TileKind. */
const GLYPH_TO_TILE: Readonly<Record<string, TileKind>> = {
  ".": "walkable",
  "#": "impassable",
  P: "poi",
};

export const TILE_TO_GLYPH: Readonly<Record<TileKind, string>> = {
  walkable: ".",
  impassable: "#",
  poi: "P",
};

const CONNECTOR_KINDS: readonly string[] = ["open", "wall", "water", "cliff"];
const CHUNK_SCALES: readonly string[] = ["wilderness", "settlement", "room"];

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${where}: expected a table, got ${Array.isArray(value) ? "an array" : typeof value}`);
  }
  return value as Record<string, unknown>;
}

function requireString(rec: Record<string, unknown>, field: string, where: string): string {
  const v = rec[field];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`${where}: missing or non-string required field "${field}"`);
  }
  return v;
}

function parseRows(raw: unknown, where: string): TileKind[][] {
  if (!Array.isArray(raw)) throw new Error(`${where}: "rows" must be an array of strings`);
  return raw.map((line, y) => {
    if (typeof line !== "string") throw new Error(`${where}: row ${y} is not a string`);
    return [...line].map((glyph, x) => {
      const tile = GLYPH_TO_TILE[glyph];
      if (tile === undefined) {
        throw new Error(
          `${where}: row ${y} col ${x} has unknown glyph "${glyph}" — legal glyphs are ${Object.keys(GLYPH_TO_TILE).join(" ")}`,
        );
      }
      return tile;
    });
  });
}

/**
 * Parses one connector. `walkable_tiles` is OPTIONAL in the TOML: when
 * omitted on an `open` edge it is inferred from the tile grid. That is a
 * convenience for authoring, not a weakening of the honesty rule —
 * validateChunk still re-derives and compares, so an explicitly-declared
 * wrong list is still rejected. Declaring it explicitly is how an author
 * asks to be checked.
 */
function parseConnector(
  raw: unknown,
  edge: EdgeName,
  tiles: readonly (readonly TileKind[])[],
  size: number,
  where: string,
): ConnectorSpec {
  const rec = asRecord(raw, `${where}: connector "${edge}"`);
  const kind = requireString(rec, "kind", `${where}: connector "${edge}"`);
  if (!CONNECTOR_KINDS.includes(kind)) {
    throw new Error(`${where}: connector "${edge}" has unknown kind "${kind}" — legal kinds are ${CONNECTOR_KINDS.join(", ")}`);
  }

  let walkableTiles: number[];
  if (rec.walkable_tiles === undefined) {
    walkableTiles = kind === "open" ? actualWalkableOffsets(tiles, edge, size) : [];
  } else {
    if (!Array.isArray(rec.walkable_tiles)) {
      throw new Error(`${where}: connector "${edge}" walkable_tiles must be an array of integers`);
    }
    walkableTiles = rec.walkable_tiles.map((n) => {
      if (typeof n !== "number" || !Number.isInteger(n)) {
        throw new Error(`${where}: connector "${edge}" walkable_tiles contains a non-integer: ${String(n)}`);
      }
      return n;
    });
  }

  return { kind: kind as ConnectorKind, walkableTiles };
}

function parseChunk(raw: unknown, sourcePath: string): Chunk {
  const where = `chunk file ${sourcePath}`;
  const rec = asRecord(raw, where);

  const id = requireString(rec, "id", where);
  const biomeTag = requireString(rec, "biome_tag", `chunk "${id}"`);
  const scale = requireString(rec, "scale", `chunk "${id}"`);
  if (!CHUNK_SCALES.includes(scale)) {
    throw new Error(`chunk "${id}": unknown scale "${scale}" — legal scales are ${CHUNK_SCALES.join(", ")}`);
  }

  const tiles = parseRows(rec.rows, `chunk "${id}"`);
  const size = expectedSizeForScale(scale as ChunkScale);

  const connectorsRaw = asRecord(rec.connectors, `chunk "${id}": connectors`);
  const connectors = Object.fromEntries(
    EDGE_NAMES.map((edge) => {
      if (connectorsRaw[edge] === undefined) {
        throw new Error(`chunk "${id}": missing connector for edge "${edge}" — all four must be declared`);
      }
      return [edge, parseConnector(connectorsRaw[edge], edge, tiles, size, `chunk "${id}"`)];
    }),
  ) as unknown as ChunkConnectors;

  const chunk: Chunk = {
    id,
    biomeTag,
    scale: scale as ChunkScale,
    size,
    tiles,
    connectors,
    poiSlot: rec.poi_slot === true,
    enclosedDecorative: rec.enclosed_decorative === true,
  };

  validateChunk(chunk);
  return chunk;
}

export function scaleBiomeKey(scale: ChunkScale, biomeTag: string): string {
  return `${scale}|${biomeTag}`;
}

export function indexChunks(chunks: readonly Chunk[]): ChunkLibrary {
  const byId = new Map<string, Chunk>();
  for (const chunk of chunks) {
    if (byId.has(chunk.id)) throw new Error(`duplicate chunk id "${chunk.id}"`);
    byId.set(chunk.id, chunk);
  }

  const byScaleAndBiome = new Map<string, Chunk[]>();
  for (const chunk of chunks) {
    const key = scaleBiomeKey(chunk.scale, chunk.biomeTag);
    const bucket = byScaleAndBiome.get(key);
    if (bucket) bucket.push(chunk);
    else byScaleAndBiome.set(key, [chunk]);
  }

  return { all: chunks, byId, byScaleAndBiome };
}

/**
 * Loads every `*.toml` under `dir`. Each file holds one `[[chunks]]`
 * array — several small related chunks per file reads better than one
 * file per 16-row chunk, while still keeping "add terrain = add a file".
 *
 * Sorted by filename so load order (and therefore the library's array
 * order, which selection weighting reads) is deterministic regardless of
 * filesystem enumeration order.
 */
export function loadChunkLibraryFromDir(dir: string): ChunkLibrary {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".toml"))
    .sort()
    .map((f) => join(dir, f));

  const chunks: Chunk[] = [];
  for (const path of files) {
    const parsed = asRecord(parseToml(readFileSync(path, "utf8")), `chunk file ${path}`);
    const list = parsed.chunks;
    if (!Array.isArray(list)) {
      throw new Error(`chunk file ${path}: expected an array-of-tables named "chunks"`);
    }
    for (const entry of list) chunks.push(parseChunk(entry, path));
  }

  if (chunks.length === 0) throw new Error(`chunk library at ${dir} is empty — assembly has nothing to place`);
  return indexChunks(chunks);
}
