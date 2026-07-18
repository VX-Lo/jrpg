import { describe, expect, it } from "vitest";
import { createRng } from "../../src/rng/index.js";
import { worldgen } from "../../src/worldgen/worldgen.js";
import { loadContentFromDir } from "../../src/content/loader.js";
import { buildTierQuestGraph, computeCommonAbilityIds, computeCaptureThreatArchetypeIds } from "../../src/questgraph/questgraph.js";
import { serializeQuestGraph } from "../../src/questgraph/serialize.js";
import { buildRegionDag } from "../../src/questgraph/dag.js";
import { emitRegionHints } from "../../src/questgraph/hints.js";
import { buildTierArcs } from "../../src/questgraph/arcs/tierArcs.js";
import { EventLogWriter, serializeLog } from "../../src/log/index.js";
import { KERNELS } from "../../src/worldgen/kernels/index.js";
import { selectArcTemplate } from "../../src/questgraph/arcs/select.js";
import { simulateArc, logArcTerminalEvent } from "../../src/questgraph/arcs/arcEngine.js";
import type { RegionQuestGraph, TierQuestGraph } from "../../src/questgraph/types.js";
import type { Tier } from "../../src/worldgen/types.js";
import { CONTENT_DIR } from "../content/contentDir.js";

// Gate 8 — perturbation. Adding a new questgraph/arc substream key must
// not perturb any pre-existing draw. Same shape as Phases 1-3's
// perturbation gates: reimplement the real call sequence with genuinely
// new substream-keyed consumers spliced in, assert byte-identical output.

const content = loadContentFromDir(CONTENT_DIR);

function questGraphWithExtraDraws(tier: Tier): TierQuestGraph {
  const root = createRng(tier.seed);
  const commonAbilityIds = computeCommonAbilityIds(content);
  const captureThreatArchetypeIds = computeCaptureThreatArchetypeIds(content);
  const allRegionIds = tier.regions.map((r) => r.id);

  let bossRegionId = "";
  let bossLockId = "";

  const regions: RegionQuestGraph[] = tier.regions.map((region, regionIndex) => {
    const isBossRegion = region.id === tier.bossRegionId;

    // A brand-new consumer with a brand-new key, not present in
    // questgraph.ts, drawing real values, inserted before DAG building.
    const omenRng = root.substream(`questgraph:tier:${tier.tierIndex}:region:${regionIndex}:omen`);
    void omenRng.nextUint64();
    void omenRng.nextInt(11);

    const { graph, bossLockId: regionBossLockId, gateNodeIds } = buildRegionDag({
      root,
      tierIndex: tier.tierIndex,
      regionIndex,
      band: tier.band,
      region,
      isBossRegion,
      bossNodeId: isBossRegion ? tier.bossNodeId : undefined,
      commonAbilityIds,
      captureThreatArchetypeIds,
    });

    if (isBossRegion && regionBossLockId !== undefined) {
      bossRegionId = region.id;
      bossLockId = regionBossLockId;
    }

    const hints = emitRegionHints({
      root,
      tierIndex: tier.tierIndex,
      regionIndex,
      regionId: region.id,
      facts: graph.facts,
      locks: graph.locks,
      gateNodeIds,
      allNodeIds: region.nodes.map((n) => n.id),
      allRegionIds,
    });

    return { ...graph, hints };
  });

  // A second new key, inserted after all regions are built.
  const epilogueRng = root.substream(`questgraph:tier:${tier.tierIndex}:epilogue`);
  void epilogueRng.nextFloat();

  if (bossRegionId === "" || bossLockId === "") throw new Error("test setup: no boss lock produced");
  return { tierIndex: tier.tierIndex, seed: root.seed, bossRegionId, bossLockId, regions };
}

function arcsWithExtraDraws(tier: Tier, log: EventLogWriter, tick: number) {
  const root = createRng(tier.seed);
  const kernelsById = new Map(KERNELS.map((k) => [k.id, k]));

  return tier.regions.map((region, regionIndex) => {
    const kernel = kernelsById.get(region.kernelId);
    if (kernel === undefined) throw new Error("test setup: unknown kernel");

    // New consumer spliced between selection and simulation.
    const rumorRng = root.substream(`arcs:tier:${tier.tierIndex}:region:${regionIndex}:rumor`);
    void rumorRng.nextInt(5);

    const template = selectArcTemplate(root, tier.tierIndex, regionIndex, kernel);
    const result = simulateArc(root, tier.tierIndex, regionIndex, region, template);
    logArcTerminalEvent(log, tick, region, template, result);
    return result;
  });
}

describe("Gate 8 — perturbation (real questgraph/arcs consumers)", () => {
  const cases: readonly [bigint, number][] = [
    [1n, 1],
    [42n, 5],
    [777n, 40],
  ];

  it("adding new questgraph substream keys does not perturb any pre-existing generated field", () => {
    for (const [seed, tierIndex] of cases) {
      const tier = worldgen(seed, tierIndex);
      const original = buildTierQuestGraph(tier, content);
      const perturbed = questGraphWithExtraDraws(tier);
      expect(serializeQuestGraph(perturbed)).toBe(serializeQuestGraph(original));
    }
  });

  it("adding new arc substream keys does not perturb any pre-existing generated field", () => {
    for (const [seed, tierIndex] of cases) {
      const tier = worldgen(seed, tierIndex);

      const logOriginal = new EventLogWriter();
      const original = buildTierArcs(tier, logOriginal, 0);

      const logPerturbed = new EventLogWriter();
      const perturbed = arcsWithExtraDraws(tier, logPerturbed, 0);

      expect(JSON.stringify(perturbed)).toBe(JSON.stringify(original));
      expect(serializeLog(logPerturbed.toArray())).toBe(serializeLog(logOriginal.toArray()));
    }
  });
});
