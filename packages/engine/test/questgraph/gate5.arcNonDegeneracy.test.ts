import { describe, expect, it } from "vitest";
import { worldgen } from "../../src/worldgen/worldgen.js";
import { EventLogWriter } from "../../src/log/index.js";
import { buildTierArcs } from "../../src/questgraph/arcs/tierArcs.js";
import { ARC_TEMPLATES } from "../../src/questgraph/arcs/templates.js";
import type { ArcOutcomeTag } from "../../src/questgraph/arcs/types.js";

// Gate 5 — Regional arc outcome non-degeneracy. No single outcome tag
// exceeds 85% of instances for a given arc template across 100+ seeds.
// An arc that resolves to Status Quo 95% of the time is a design
// failure, exactly like a tedious quest graph.

const MAX_OUTCOME_SHARE = 0.85;
const TIER_COUNT = 400; // generous margin over the 100+/template requirement, since selection is weighted not forced

describe("Gate 5 — regional arc outcome non-degeneracy", () => {
  it(`no outcome tag exceeds ${MAX_OUTCOME_SHARE * 100}% of instances for any arc template`, () => {
    const counts = new Map<string, Record<ArcOutcomeTag, number>>();
    for (const t of ARC_TEMPLATES) counts.set(t.id, { Victory: 0, Lockdown: 0, StatusQuo: 0, Inversion: 0 });

    for (let i = 0; i < TIER_COUNT; i++) {
      const seed = BigInt(i) * 999331n + 7n;
      const tierIndex = (i % 80) + 1;
      const tier = worldgen(seed, tierIndex);
      const log = new EventLogWriter();
      const results = buildTierArcs(tier, log, 0);
      for (const result of results) {
        counts.get(result.templateId)![result.outcomeTag]++;
      }
    }

    const report: string[] = [];
    const violations: string[] = [];
    for (const [templateId, tagCounts] of counts) {
      const total = Object.values(tagCounts).reduce((a, b) => a + b, 0);
      expect(total, `template ${templateId} needs 100+ instances`).toBeGreaterThanOrEqual(100);

      for (const [tag, count] of Object.entries(tagCounts)) {
        const share = count / total;
        report.push(`${templateId} ${tag}: ${count}/${total} (${(share * 100).toFixed(1)}%)`);
        if (share > MAX_OUTCOME_SHARE) {
          violations.push(`${templateId}: outcome "${tag}" is ${(share * 100).toFixed(1)}% of ${total} instances (max ${MAX_OUTCOME_SHARE * 100}%)`);
        }
      }
    }

    console.log(`Gate 5 outcome distribution:\n${report.join("\n")}`);

    if (violations.length > 0) {
      throw new Error(`Degenerate outcome distribution:\n${violations.join("\n")}`);
    }
    expect(violations).toEqual([]);
  });
});
