import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ChunkLibrary } from "../types.js";
import { loadChunkLibraryFromDir } from "./loader.js";

/**
 * The on-disk chunk library, loaded once.
 *
 * Memoised because `embedTier` is called across thousands of seeds in the
 * gates and re-reading and re-validating the same TOML each time would
 * dominate the runtime. The cache holds immutable authored CONTENT — it is
 * not run state, it never varies by seed, and it cannot make one call to
 * embedTier depend on another (which would break cold-depth). This is the
 * same "I/O at the edges, purity in the core" split the CLI already uses.
 */
let cached: ChunkLibrary | null = null;

export function chunkContentDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../../content/chunks");
}

export function defaultChunkLibrary(): ChunkLibrary {
  if (cached === null) cached = loadChunkLibraryFromDir(chunkContentDir());
  return cached;
}
