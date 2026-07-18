import { describe, expect, it } from "vitest";
import { worldgen } from "../../src/worldgen/worldgen.js";
import { EventLogWriter } from "../../src/log/index.js";
import { buildTierArcs } from "../../src/questgraph/arcs/tierArcs.js";
import { ARC_TEMPLATES } from "../../src/questgraph/arcs/templates.js";
import { ARC_MIN_BEATS, ARC_MAX_BEATS } from "../../src/worldgen/config.js";

// Gate 4 — Regional arc terminal reachability. Across 100+ seeds per
// arc template, every instance reaches a terminal Beat within its
// authored bound (ARC_MIN_BEATS..ARC_MAX_BEATS).

const SEEDS_PER_ARC_TARGET = 100;
// Each tier has as many regions as its shape (2-4), each independently
// picking an arc template weighted by kernel theme — running enough
// tiers naturally accumulates 100+ instances of every template without
// forcing selection.
const TIER_COUNT = 200;

describe("Gate 4 — regional arc terminal reachability", () => {
  it(`every arc template is authored with ${ARC_MIN_BEATS}-${ARC_MAX_BEATS} total Beats (non-terminal + terminal)`, () => {
    for (const template of ARC_TEMPLATES) {
      const total = template.beats.length + template.terminals.length;
      expect(total, `template ${template.id} has ${total} total beats`).toBeGreaterThanOrEqual(ARC_MIN_BEATS);
      expect(total, `template ${template.id} has ${total} total beats`).toBeLessThanOrEqual(ARC_MAX_BEATS);
    }
  });

  it(`every simulated arc instance reaches a terminal Beat within its template's beat bound, across ${TIER_COUNT} tiers`, () => {
    const perTemplateCounts = new Map<string, number>();
    const violations: string[] = [];

    for (let i = 0; i < TIER_COUNT; i++) {
      const seed = BigInt(i) * 999331n + 7n;
      const tierIndex = (i % 80) + 1;
      const tier = worldgen(seed, tierIndex);
      const log = new EventLogWriter();
      const results = buildTierArcs(tier, log, 0);

      for (const result of results) {
        perTemplateCounts.set(result.templateId, (perTemplateCounts.get(result.templateId) ?? 0) + 1);
        const beatCount = result.trajectory.length;
        if (beatCount < 1 || beatCount > ARC_MAX_BEATS) {
          violations.push(
            `tier=${tierIndex} region=${result.regionId} template=${result.templateId}: ${beatCount} beats, outside [1, ${ARC_MAX_BEATS}]`,
          );
        }
        // A terminal event must have been logged for every instance.
        if (log.toArray().filter((e) => e.type === "arc:terminal").length !== results.length) {
          violations.push(`tier=${tierIndex}: terminal event count mismatch vs region count`);
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(`${violations.length} violations:\n${violations.slice(0, 20).join("\n")}`);
    }

    for (const [templateId, count] of perTemplateCounts) {
      expect(count, `template ${templateId} needs ${SEEDS_PER_ARC_TARGET}+ instances for a meaningful Gate 5 sample`).toBeGreaterThanOrEqual(
        SEEDS_PER_ARC_TARGET,
      );
    }
    expect(violations).toEqual([]);
  });
});
