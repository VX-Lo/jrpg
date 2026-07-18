import { describe, expect, it } from "vitest";
import { worldgen } from "../../src/worldgen/worldgen.js";
import { loadContentFromDir } from "../../src/content/loader.js";
import { buildTierQuestGraph } from "../../src/questgraph/questgraph.js";
import { solveA } from "../../src/questgraph/solverA.js";
import { CONTENT_DIR } from "../content/contentDir.js";

// Gate 2 — THE TWO-SOLVER GATE, the signature gate of the project.
// Across 1,000+ seeds, Solver A completes 100% using inference alone
// (rule 6: every seed winnable by inference, not exhaustive search).
// Pass/fail is completion rate only; tedium index and guess count are
// recorded metrics for future tuning, not additional thresholds this
// phase — reported here and in CLAUDE.md per the session protocol.

const SEED_COUNT = 1000;
const content = loadContentFromDir(CONTENT_DIR);

describe("Gate 2 — Solver A completeness (the two-solver gate)", () => {
  it(`completes ${SEED_COUNT} seeds by inference alone, zero exhaustive search`, () => {
    const failures: string[] = [];
    let totalGuesses = 0;
    let totalTedium = 0;

    for (let i = 0; i < SEED_COUNT; i++) {
      const seed = BigInt(i) * 2654435761n + 1n;
      const tierIndex = (i % 80) + 1;

      const tier = worldgen(seed, tierIndex);
      const graph = buildTierQuestGraph(tier, content);
      const result = solveA(tier, graph);

      if (result.outcome !== "success") {
        failures.push(`seed=${seed} tier=${tierIndex}: trace tail: ${result.trace.slice(-8).join(" | ")}`);
      }
      totalGuesses += result.guessCount;
      totalTedium += result.tedium;
    }

    const avgGuesses = totalGuesses / SEED_COUNT;
    const avgTedium = totalTedium / SEED_COUNT;
    console.log(`Gate 2 metrics — avg guesses/seed: ${avgGuesses.toFixed(3)}, avg tedium index: ${avgTedium.toFixed(3)}`);

    if (failures.length > 0) {
      throw new Error(
        `${failures.length}/${SEED_COUNT} seeds NOT solvable by inference alone (Solver A failed where the gate requires 100%):\n${failures.slice(0, 20).join("\n")}`,
      );
    }
    expect(failures).toEqual([]);
  });
});
