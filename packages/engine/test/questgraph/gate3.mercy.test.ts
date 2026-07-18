import { describe, expect, it } from "vitest";
import { createRng } from "../../src/rng/index.js";
import { EventLogWriter } from "../../src/log/index.js";
import { applyMercyPass } from "../../src/questgraph/mercy.js";
import type { Hint, ItemFact, RegionQuestGraph } from "../../src/questgraph/types.js";

// Gate 3 — Mercy pinning. Targeted test, not statistical: hint an item,
// make it eligible for relocation consideration (ticksSinceReachable
// over threshold), assert it never relocates while any live hint
// references it. Then remove the hint and assert an otherwise-identical
// unhinted item can relocate. Proves both directions.

function makeFact(id: string, node: string, gateStep: number): ItemFact {
  return { id, kind: "item", itemId: `item:${id}`, regionId: "r0", placementNodeIds: [node], gateStep };
}

function makeRegion(hintedFactId: string | undefined, facts: readonly ItemFact[]): RegionQuestGraph {
  const hints: Hint[] = [];
  if (hintedFactId !== undefined) {
    const fact = facts.find((f) => f.id === hintedFactId);
    if (fact === undefined) throw new Error("test setup: hintedFactId not in facts");
    hints.push({
      id: `${hintedFactId}-hint0`,
      targetFact: { kind: "location", item: fact.itemId, candidateRegions: ["r0"] },
      specificity: "precise",
      sourceNodeId: "n0",
    });
  }
  return {
    regionId: "r0",
    facts,
    locks: [{ id: "r0-lock0", lockedNodeId: "n9", requiredFactIds: facts.map((f) => f.id), integrity: 10 }],
    hints,
    skillTrainers: [],
    eliteCaptures: [],
  };
}

const allNodeIds = ["n0", "n1", "n2", "n3", "n4", "n9"];
const gateNodeIds = ["n9"]; // single gate at the end; everything else always reachable

const TRIALS = 40; // MERCY_ROLL_CHANCE is 0.5 — 40 independent seeds makes "never once fires" a real signal, not luck.

describe("Gate 3 — Mercy pinning", () => {
  it("never relocates a fact with a live hint pointing at it, across many eligible trials", () => {
    const factHinted = makeFact("factA", "n1", 0);
    const region = makeRegion("factA", [factHinted]);

    for (let seed = 0; seed < TRIALS; seed++) {
      const root = createRng(seed);
      const log = new EventLogWriter();
      const result = applyMercyPass({
        root,
        regionKey: `questgraph:test:${seed}:region:0`,
        region,
        allNodeIds,
        gateNodeIds,
        playerState: [{ factId: "factA", ticksSinceReachable: 999999 }],
        log,
        tick: 0,
      });

      expect(result.events).toEqual([]);
      expect(result.region.facts[0].placementNodeIds).toEqual(["n1"]);
      expect(log.toArray()).toEqual([]);
    }
  });

  it("relocates an otherwise-identical unhinted fact at least once across the same trials", () => {
    const factUnhinted = makeFact("factA", "n1", 0);
    const region = makeRegion(undefined, [factUnhinted]);

    let relocatedAtLeastOnce = false;
    for (let seed = 0; seed < TRIALS; seed++) {
      const root = createRng(seed);
      const log = new EventLogWriter();
      const result = applyMercyPass({
        root,
        regionKey: `questgraph:test:${seed}:region:0`,
        region,
        allNodeIds,
        gateNodeIds,
        playerState: [{ factId: "factA", ticksSinceReachable: 999999 }],
        log,
        tick: 0,
      });

      if (result.events.length > 0) {
        relocatedAtLeastOnce = true;
        expect(result.events[0].factId).toBe("factA");
        expect(result.events[0].fromNodeIds).toEqual(["n1"]);
        expect(result.region.facts[0].placementNodeIds).toEqual([result.events[0].toNodeId]);
        expect(result.region.facts[0].placementNodeIds).not.toEqual(["n1"]);
        expect(log.toArray()).toHaveLength(1);
        expect(log.toArray()[0].type).toBe("questgraph:mercy-relocation");
      }
    }

    expect(relocatedAtLeastOnce).toBe(true);
  });

  it("does not relocate a fact below the ticksSinceReachable threshold, even unhinted", () => {
    const factUnhinted = makeFact("factA", "n1", 0);
    const region = makeRegion(undefined, [factUnhinted]);

    for (let seed = 0; seed < TRIALS; seed++) {
      const root = createRng(seed);
      const log = new EventLogWriter();
      const result = applyMercyPass({
        root,
        regionKey: `questgraph:test:${seed}:region:0`,
        region,
        allNodeIds,
        gateNodeIds,
        playerState: [{ factId: "factA", ticksSinceReachable: 0 }],
        log,
        tick: 0,
      });
      expect(result.events).toEqual([]);
    }
  });

  it("is deterministic: same seed and inputs reproduce the identical relocation decision", () => {
    const factUnhinted = makeFact("factA", "n1", 0);
    const region = makeRegion(undefined, [factUnhinted]);

    function run() {
      const root = createRng(12345);
      const log = new EventLogWriter();
      return applyMercyPass({
        root,
        regionKey: "questgraph:tier:5:region:0",
        region,
        allNodeIds,
        gateNodeIds,
        playerState: [{ factId: "factA", ticksSinceReachable: 999999 }],
        log,
        tick: 0,
      });
    }

    const a = run();
    const b = run();
    expect(a.events).toEqual(b.events);
  });
});
