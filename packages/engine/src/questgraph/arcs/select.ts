import type { Rng } from "../../rng/index.js";
import type { RegionKernel } from "../../worldgen/types.js";
import { ARC_TEMPLATES, KERNEL_ARC_THEMES } from "./templates.js";
import type { ArcTemplate } from "./types.js";

const THEMED_WEIGHT = 2;
const UNIVERSAL_WEIGHT = 1;

/**
 * Weighted arc-template selection by region kernel theme (Deliverable
 * 7). Themed matches (drawn from the kernel's `arcPool` theme mapping)
 * are weighted 2x over the "universal" fallback template, which stays
 * eligible everywhere so selection never fails even for a kernel with
 * no themed match.
 */
export function selectArcTemplate(root: Rng, tierIndex: number, regionIndex: number, kernel: RegionKernel): ArcTemplate {
  const rng = root.substream(`arcs:tier:${tierIndex}:region:${regionIndex}:selection`);
  const kernelThemes = new Set(KERNEL_ARC_THEMES[kernel.id] ?? []);

  const weighted = ARC_TEMPLATES.map((template) => ({
    template,
    weight: template.theme === "universal" || kernelThemes.has(template.theme) ? THEMED_WEIGHT : UNIVERSAL_WEIGHT,
  })).filter((entry) => entry.weight > 0);

  const total = weighted.reduce((sum, e) => sum + e.weight, 0);
  let roll = rng.nextFloat() * total;
  for (const entry of weighted) {
    if (roll < entry.weight) return entry.template;
    roll -= entry.weight;
  }
  return weighted[weighted.length - 1].template;
}
