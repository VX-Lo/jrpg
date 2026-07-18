import { describe, expect, it } from "vitest";
import { worldgen } from "../../src/worldgen/worldgen.js";
import { loadContentFromDir } from "../../src/content/loader.js";
import { buildTierQuestGraph } from "../../src/questgraph/questgraph.js";
import { solveB } from "../../src/questgraph/solverB.js";
import { CONTENT_DIR } from "../content/contentDir.js";

// Gate 1 — Solver B completeness (deadlock check). Across 1,000+ seeds,
// Solver B (brute force, hints ignored) completes 100%. Any failure here
// is a real deadlock — a generation bug in the forward-placement rule,
// not statistical noise. Fix the generator, not the solver.

const SEED_COUNT = 1000;
const content = loadContentFromDir(CONTENT_DIR);

describe("Gate 1 — Solver B completeness", () => {
  it(`solves ${SEED_COUNT} seeds by brute force with zero deadlocks`, () => {
    const failures: string[] = [];

    for (let i = 0; i < SEED_COUNT; i++) {
      const seed = BigInt(i) * 2654435761n + 1n;
      const tierIndex = (i % 80) + 1;

      const tier = worldgen(seed, tierIndex);
      const graph = buildTierQuestGraph(tier, content);
      const result = solveB(tier, graph);
      if (result.outcome !== "success") {
        failures.push(`seed=${seed} tier=${tierIndex}: Solver B failed to reach the boss lock`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length}/${SEED_COUNT} deadlocked:\n${failures.slice(0, 20).join("\n")}`);
    }
    expect(failures).toEqual([]);
  });
});
