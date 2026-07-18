import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTENT_DIR } from "./contentDir.js";

/**
 * Copies the real content directory into an isolated OS temp dir, lets
 * `mutate` write/modify fixture files into that COPY, runs `run` against
 * it, then deletes the temp dir. Tests that write fixture files into the
 * shared real CONTENT_DIR directly would otherwise contaminate every
 * other test file's concurrently-running loadContentFromDir() call
 * (loadContentFromDir scans the whole directory) — this keeps each test
 * fully isolated and safely parallelizable.
 */
export function withTempContentDir<T>(mutate: (dir: string) => void, run: (dir: string) => T): T {
  const tempDir = mkdtempSync(join(tmpdir(), "hollowmark-content-"));
  try {
    cpSync(CONTENT_DIR, tempDir, { recursive: true });
    mutate(tempDir);
    return run(tempDir);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
