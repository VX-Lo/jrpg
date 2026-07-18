import { createRng } from "../../rng/index.js";
import type { EventLogWriter } from "../../log/index.js";
import type { Tier } from "../../worldgen/types.js";
import { KERNELS } from "../../worldgen/kernels/index.js";
import { selectArcTemplate } from "./select.js";
import { simulateArc, logArcTerminalEvent } from "./arcEngine.js";
import type { ArcInstanceResult } from "./types.js";

/**
 * Runs region-arc selection + simulation for every region in a tier,
 * logging each terminal event. `log`/`tick` are the caller's real event
 * log — this is a real generation-time side effect (like worldgen's own
 * substream draws), not a demo.
 */
export function buildTierArcs(tier: Tier, log: EventLogWriter, tick: number): ArcInstanceResult[] {
  const root = createRng(tier.seed);
  const kernelsById = new Map(KERNELS.map((k) => [k.id, k]));

  return tier.regions.map((region, regionIndex) => {
    const kernel = kernelsById.get(region.kernelId);
    if (kernel === undefined) throw new Error(`buildTierArcs: unknown kernel ${region.kernelId} for region ${region.id}`);

    const template = selectArcTemplate(root, tier.tierIndex, regionIndex, kernel);
    const result = simulateArc(root, tier.tierIndex, regionIndex, region, template);
    logArcTerminalEvent(log, tick, region, template, result);
    return result;
  });
}
