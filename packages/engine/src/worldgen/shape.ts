import type { Rng } from "../rng/index.js";
import { REGION_SHAPES } from "./config.js";

/** Rolls this tier's region shape from the config's fixed pool. */
export function rollShape(root: Rng, tierIndex: number): readonly number[] {
  const rng = root.substream(`worldgen:tier:${tierIndex}:shape`);
  const idx = rng.nextInt(REGION_SHAPES.length);
  return REGION_SHAPES[idx];
}
