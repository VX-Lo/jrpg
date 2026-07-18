import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the real fixture content directory (packages/engine/content). */
export const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "content");
