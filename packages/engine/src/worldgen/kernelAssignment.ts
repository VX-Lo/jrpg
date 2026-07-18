import type { Rng } from "../rng/index.js";
import type { RegionKernel } from "./types.js";
import { KERNELS } from "./kernels/index.js";
import { shuffledIndices } from "./util.js";

/**
 * Assigns one kernel per region for this tier, WITHOUT replacement.
 *
 * Deliberate deviation from the naive "one independent substream draw
 * per region" pattern: with only a handful of fixture kernels this
 * phase, two regions independently drawing the same kernel would share
 * curated name pools and produce duplicate proper nouns within a tier —
 * exactly what Gate 1 forbids. Kernel *exclusivity* is inherently a
 * tier-scoped decision (it's a fact about all of a tier's regions
 * together), so it gets one coordinating draw at the tier level, same
 * as `shape` and `boss` — not a per-region independent draw. This still
 * satisfies determinism/perturbation: it's its own single substream key,
 * unaffected by any other key added later.
 */
export function assignKernels(root: Rng, tierIndex: number, regionCount: number): readonly RegionKernel[] {
  const rng = root.substream(`worldgen:tier:${tierIndex}:regions:kernels`);
  const order = shuffledIndices(rng, KERNELS.length);
  return order.slice(0, regionCount).map((idx) => KERNELS[idx]);
}
