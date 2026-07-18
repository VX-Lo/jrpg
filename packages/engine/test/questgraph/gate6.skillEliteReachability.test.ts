import { describe, expect, it } from "vitest";
import { worldgen } from "../../src/worldgen/worldgen.js";
import { loadContentFromDir } from "../../src/content/loader.js";
import { buildTierQuestGraph } from "../../src/questgraph/questgraph.js";
import { validateQuestGraph } from "../../src/questgraph/validate.js";
import { CONTENT_DIR } from "../content/contentDir.js";

// Gate 6 — Skill/elite node reachability. Skill trainer and elite-
// capture nodes placed by Deliverable 8 pass the same reachability
// guarantee as items — no orphans, discoverable via the same forward-
// generation logic. Verified structurally (every such node resolves
// under the full reachability fixpoint — the same one Solver B/Gate 1
// use, but here every lock must resolve, not just the boss lock).

const SEED_COUNT = 1000;
const content = loadContentFromDir(CONTENT_DIR);

describe("Gate 6 — skill trainer / elite capture reachability", () => {
  it(`places no orphaned skill trainer or elite-capture node across ${SEED_COUNT} seeds`, () => {
    const failures: string[] = [];
    let trainerCount = 0;
    let eliteCount = 0;

    for (let i = 0; i < SEED_COUNT; i++) {
      const seed = BigInt(i) * 2654435761n + 1n;
      const tierIndex = (i % 80) + 1;

      const tier = worldgen(seed, tierIndex);
      const graph = buildTierQuestGraph(tier, content);
      for (const region of graph.regions) {
        trainerCount += region.skillTrainers.length;
        eliteCount += region.eliteCaptures.length;
      }

      const violations = validateQuestGraph(tier, graph);
      if (violations.length > 0) {
        failures.push(`seed=${seed} tier=${tierIndex}: ${violations.join("; ")}`);
      }
    }

    // Sanity: the mechanism actually placed a meaningful number of each
    // across the corpus (SKILL_TRAINERS_PER_REGION_MAX/ELITE_CAPTURES_PER_REGION_MAX
    // both allow 0, so a handful of seeds placing none is expected —
    // but not literally zero across 1000 seeds worth of regions).
    expect(trainerCount).toBeGreaterThan(0);
    expect(eliteCount).toBeGreaterThan(0);

    if (failures.length > 0) {
      throw new Error(`${failures.length}/${SEED_COUNT} seeds had orphaned/invalid placements:\n${failures.slice(0, 20).join("\n")}`);
    }
    expect(failures).toEqual([]);
  });
});
