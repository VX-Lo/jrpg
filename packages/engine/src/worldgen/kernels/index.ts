import type { RegionKernel } from "../types.js";
import { fenKernel } from "./fen.js";
import { cinderreachKernel } from "./cinderreach.js";
import { hollowKernel } from "./hollow.js";
import { canopyKernel } from "./canopy.js";

/**
 * Fixture kernel set for Phase 2 — 4 kernels, enough to prove the
 * pipeline and make the spot-check gate meaningful. The full authored
 * set of 15-25 kernels is a Phase 3 design pass.
 *
 * Exactly 4 because MAX_REGIONS_PER_TIER is 4 (config.ts) — kernel
 * assignment per tier is drawn without replacement, so the pool must be
 * at least that large.
 */
export const KERNELS: readonly RegionKernel[] = [fenKernel, cinderreachKernel, hollowKernel, canopyKernel];

export { fenKernel, cinderreachKernel, hollowKernel, canopyKernel };
