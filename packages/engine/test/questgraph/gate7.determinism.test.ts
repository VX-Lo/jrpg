import { describe, expect, it } from "vitest";
import { worldgen } from "../../src/worldgen/worldgen.js";
import { loadContentFromDir } from "../../src/content/loader.js";
import { buildTierQuestGraph } from "../../src/questgraph/questgraph.js";
import { serializeQuestGraph } from "../../src/questgraph/serialize.js";
import { buildTierArcs } from "../../src/questgraph/arcs/tierArcs.js";
import { EventLogWriter, serializeLog } from "../../src/log/index.js";
import { createRng } from "../../src/rng/index.js";
import { applyMercyPass } from "../../src/questgraph/mercy.js";
import { CONTENT_DIR } from "../content/contentDir.js";

// Gate 7 — determinism. Same seed, same tier index -> byte-identical
// DAG, hints, mercy outcomes, and arc trajectories. Across many seeds,
// including deep tiers and edge-case seed values.

const CASES: readonly [bigint, number][] = [
  [0n, 1],
  [1n, 2],
  [42n, 5],
  [123456789n, 17],
  [999n, 40],
  [7n, 100],
  [18446744073709551615n, 1000], // 2^64 - 1
];

const content = loadContentFromDir(CONTENT_DIR);

describe("Gate 7 — determinism", () => {
  it.each(CASES)("seed=%s tier=%i: quest graph is byte-identical across two independent builds", (seed, tierIndex) => {
    const tier = worldgen(seed, tierIndex);
    const a = buildTierQuestGraph(tier, content);
    const b = buildTierQuestGraph(tier, content);
    expect(serializeQuestGraph(b)).toBe(serializeQuestGraph(a));
  });

  it.each(CASES)("seed=%s tier=%i: arc trajectories and their logged events are byte-identical across two independent builds", (seed, tierIndex) => {
    const tier = worldgen(seed, tierIndex);

    const logA = new EventLogWriter();
    const resultsA = buildTierArcs(tier, logA, 0);
    const logB = new EventLogWriter();
    const resultsB = buildTierArcs(tier, logB, 0);

    expect(JSON.stringify(resultsB)).toBe(JSON.stringify(resultsA));
    expect(serializeLog(logB.toArray())).toBe(serializeLog(logA.toArray()));
  });

  it.each(CASES)("seed=%s tier=%i: mercy relocation decisions are byte-identical across two independent passes", (seed, tierIndex) => {
    const tier = worldgen(seed, tierIndex);
    const graph = buildTierQuestGraph(tier, content);
    const region = graph.regions[0];
    if (region === undefined || region.facts.length === 0) return; // nothing to relocate this seed
    const playerState = region.facts.map((f) => ({ factId: f.id, ticksSinceReachable: 999999 }));

    function run() {
      const root = createRng(tier.seed);
      const log = new EventLogWriter();
      return applyMercyPass({
        root,
        regionKey: `questgraph:tier:${tierIndex}:region:0`,
        region,
        allNodeIds: tier.regions[0].nodes.map((n) => n.id),
        gateNodeIds: region.locks.map((l) => l.lockedNodeId),
        playerState,
        log,
        tick: 0,
      });
    }

    const a = run();
    const b = run();
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(JSON.stringify(a.region)).toBe(JSON.stringify(b.region));
  });
});
