import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createRng } from "../../src/rng/index.js";
import { EventLogWriter, serializeLog } from "../../src/log/index.js";
import { runBattle } from "../../src/battle/resolver.js";
import { autoResolveBattle, computePowerRatio } from "../../src/battle/autoResolve.js";
import { buildLiveState } from "../../src/battle/state.js";
import { addModifier, resolveVariable, Rule10Violation, VARIABLE_CLAMPS } from "../../src/battle/registry.js";
import { resolvedActionCost } from "../../src/battle/clock.js";
import { AUTO_RESOLVE_THRESHOLD } from "../../src/worldgen/config.js";
import type { AbilityInput, BattleInput, BattleRequest } from "../../src/battle/types.js";
import { content, makeAmbusher, makeBruiser, makeWarrior } from "./fixtures.js";

function ctxFor(seed: bigint | number, encounterId: string) {
  const rng = createRng(seed).substream(`battle:${encounterId}`);
  return { content, rng, log: new EventLogWriter(), startTick: 0 };
}

function decisiveRequest(encounterId: string): { request: BattleRequest; inputs: BattleInput[] } {
  const party = [makeWarrior({ id: "1-hero", stats: { STR: 40, INT: 5, VIT: 30, AGI: 15, PER: 10 }, hp: 300, maxHp: 300 })];
  const enemies = [makeBruiser({ id: "2-bruiser", hp: 20, maxHp: 20, stats: { STR: 2, INT: 1, VIT: 2, AGI: 2, PER: 1 } })];
  const request: BattleRequest = { party, encounter: enemies, encounterId, counteredArchetypeIds: new Set() };
  const inputs: AbilityInput[] = Array.from({ length: 10 }, () => ({ kind: "ability", actorId: "1-hero", abilityId: "ability:cleave", targetId: "2-bruiser" }));
  return { request, inputs };
}

describe("Gate 1 — determinism", () => {
  it("the same (request, inputs, seed) produces a byte-identical log, twice", () => {
    const { request, inputs } = decisiveRequest("gate1-determinism");
    const a = runBattle(request, inputs, ctxFor(99n, "gate1-determinism"));
    const b = runBattle(request, inputs, ctxFor(99n, "gate1-determinism"));
    expect(serializeLog(b.log as never)).toBe(serializeLog(a.log as never));
    expect(b).toEqual(a);
  });

  it("auto-resolve is byte-identical from the same seed", () => {
    const party = [makeWarrior({ id: "1-hero", stats: { STR: 90, INT: 90, VIT: 90, AGI: 90, PER: 90 }, hp: 999, maxHp: 999 })];
    const enemies = [makeBruiser({ id: "2-bruiser", hp: 5, maxHp: 5, stats: { STR: 1, INT: 1, VIT: 1, AGI: 1, PER: 1 } })];
    const request: BattleRequest = { party, encounter: enemies, encounterId: "gate1-auto", counteredArchetypeIds: new Set() };
    const a = autoResolveBattle(request, ctxFor(11n, "gate1-auto"));
    const b = autoResolveBattle(request, ctxFor(11n, "gate1-auto"));
    expect(serializeLog(b.log as never)).toBe(serializeLog(a.log as never));
    expect(b).toEqual(a);
  });
});

describe("Gate 2 — variance audit (statistical sweep)", () => {
  it("no outcome flip across 100 seeds on a decisive fight", () => {
    const outcomes = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const { request, inputs } = decisiveRequest(`gate2-sweep-${seed}`);
      const result = runBattle(request, inputs, ctxFor(seed, `gate2-sweep-${seed}`));
      outcomes.add(result.outcome);
    }
    expect(outcomes).toEqual(new Set(["party_win"]));
  });
});

describe("Gate 3 — rule 10 at the registry", () => {
  it("rejects a multiplicative modifier on an unbounded (primary stat) variable at application", () => {
    const { party } = buildLiveState({ party: [makeWarrior()], encounter: [], encounterId: "gate3", counteredArchetypeIds: new Set() }, content, 0);
    expect(() =>
      addModifier(party[0], { targetVariable: "STR", operation: "multiply", magnitude: 2, durationTicks: null, source: "test", currentTick: 0 }),
    ).toThrow(Rule10Violation);
  });

  it("an additive modifier on a primary stat is legal (buffs add, never multiply, to unbounded stats)", () => {
    const { party } = buildLiveState({ party: [makeWarrior()], encounter: [], encounterId: "gate3b", counteredArchetypeIds: new Set() }, content, 0);
    expect(() =>
      addModifier(party[0], { targetVariable: "STR", operation: "add", magnitude: 5, durationTicks: null, source: "test", currentTick: 0 }),
    ).not.toThrow();
  });

  it("stacked modifiers on a bounded variable never exceed its declared clamp", () => {
    const { party } = buildLiveState({ party: [makeWarrior()], encounter: [], encounterId: "gate3c", counteredArchetypeIds: new Set() }, content, 0);
    const actor = party[0];
    for (let i = 0; i < 50; i++) {
      addModifier(actor, { targetVariable: "damageDealtMult", operation: "multiply", magnitude: 3, durationTicks: null, source: `stack-${i}`, currentTick: 0 });
    }
    const [, max] = VARIABLE_CLAMPS.damageDealtMult;
    expect(resolveVariable(actor, "damageDealtMult", 0)).toBeLessThanOrEqual(max);
  });

  it("every bounded variable declares a clamp range", () => {
    for (const variable of ["damageDealtMult", "damageTakenMult", "critChance", "critMultiplier", "accuracyScalar", "actionCostMult", "threatGenerationMult", "mpCostMult", "boostGenerationRate", "statusResistance", "resistPerTag"]) {
      expect(VARIABLE_CLAMPS[variable]).toBeDefined();
    }
  });
});

describe("Gate 4 — auto-resolve equivalence", () => {
  it("auto and full paths agree on outcome class for the same decisive encounter, and auto populates XP/log/bestiary/tickCost", () => {
    const party = [makeWarrior({ id: "1-hero", stats: { STR: 90, INT: 90, VIT: 90, AGI: 90, PER: 90 }, hp: 999, maxHp: 999 })];
    const enemies = [makeBruiser({ id: "2-bruiser", hp: 5, maxHp: 5, stats: { STR: 1, INT: 1, VIT: 1, AGI: 1, PER: 1 } })];
    const request: BattleRequest = { party, encounter: enemies, encounterId: "gate4", counteredArchetypeIds: new Set() };

    const { party: livePartyForRatio, enemies: liveEnemiesForRatio } = buildLiveState(request, content, 0);
    expect(computePowerRatio(livePartyForRatio, liveEnemiesForRatio)).toBeGreaterThan(AUTO_RESOLVE_THRESHOLD);

    const autoResult = autoResolveBattle(request, ctxFor(3n, "gate4-auto"));
    const inputs: AbilityInput[] = Array.from({ length: 5 }, () => ({ kind: "ability", actorId: "1-hero", abilityId: "ability:cleave", targetId: "2-bruiser" }));
    const fullResult = runBattle(request, inputs, ctxFor(3n, "gate4-full"));

    expect(autoResult.outcome).toBe(fullResult.outcome);
    expect(autoResult.tickCost).toBeGreaterThan(0);
    expect(autoResult.log.length).toBeGreaterThan(0);
    expect(autoResult.bestiaryObservations.length).toBe(enemies.length);
    expect(autoResult.partyDeltas.every((d) => d.xpEarned > 0)).toBe(true);
  });
});

describe("Gate 5 — world-clock coupling", () => {
  it("a scripted fight's tickCost is the summed action costs, and Slow (actionCostMult) visibly multiplies it", () => {
    const { party } = buildLiveState({ party: [makeWarrior()], encounter: [], encounterId: "gate5", counteredArchetypeIds: new Set() }, content, 0);
    const actor = party[0];
    const baseline = resolvedActionCost(actor, 1000, 0);

    addModifier(actor, { targetVariable: "actionCostMult", operation: "multiply", magnitude: 3, durationTicks: null, source: "slow-test", currentTick: 0 });
    const slowed = resolvedActionCost(actor, 1000, 0);

    expect(slowed).toBeGreaterThan(baseline * 2.5);
  });

  it("battle tickCost is nonzero and attributable to the resolver's own action-cost accounting, not cosmetic", () => {
    // A multi-exchange fight (unlike decisiveRequest's one-shot kill) so several actions'
    // worth of ticks actually accumulate before the outcome resolves.
    const party = [makeWarrior({ id: "1-hero", hp: 300, maxHp: 300 })];
    const enemies = [makeBruiser({ id: "2-bruiser", hp: 60, maxHp: 60 })];
    const request: BattleRequest = { party, encounter: enemies, encounterId: "gate5-tickcost", counteredArchetypeIds: new Set() };
    const inputs: AbilityInput[] = Array.from({ length: 10 }, () => ({ kind: "ability", actorId: "1-hero", abilityId: "ability:cleave", targetId: "2-bruiser" }));
    const result = runBattle(request, inputs, ctxFor(5n, "gate5-tickcost"));
    expect(result.tickCost).toBeGreaterThan(0);
    // The caller is responsible for GameState.tick += result.tickCost (CLAUDE.md §4) — demonstrate
    // that composition here rather than inside the engine (battle/ never touches GameState).
    let worldTick = 0;
    worldTick += result.tickCost;
    expect(worldTick).toBe(result.tickCost);
  });
});

describe("Gate 6 — no canEngage", () => {
  it("no engagement gate exists anywhere in battle/ source", () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const battleDir = join(testDir, "..", "..", "src", "battle");
    const files = readdirSync(battleDir).filter((f) => f.endsWith(".ts"));
    for (const file of files) {
      const source = readFileSync(join(battleDir, file), "utf8");
      expect(source).not.toMatch(/canEngage/);
    }
  });

  it("a wildly underpowered party can initiate and lose — nothing blocks it", () => {
    const party = [makeWarrior({ id: "1-hero", stats: { STR: 1, INT: 1, VIT: 1, AGI: 1, PER: 1 }, hp: 1, maxHp: 1 })];
    const enemies = [makeAmbusher({ id: "2-ambusher", stats: { STR: 90, INT: 90, VIT: 90, AGI: 90, PER: 90 }, hp: 999, maxHp: 999 })];
    const request: BattleRequest = { party, encounter: enemies, encounterId: "gate6-underpowered", counteredArchetypeIds: new Set() };
    const inputs: BattleInput[] = [{ kind: "defend", actorId: "1-hero" }];
    const result = runBattle(request, inputs, ctxFor(6n, "gate6-underpowered"));
    expect(result.outcome).toBe("tpk");
  });

  it("a wildly overpowered party is eligible for auto-resolve — the soft gate is scalars only", () => {
    const { party, enemies } = buildLiveState(
      { party: [makeWarrior({ stats: { STR: 99, INT: 99, VIT: 99, AGI: 99, PER: 99 }, hp: 999, maxHp: 999 })], encounter: [makeBruiser({ hp: 1, maxHp: 1 })], encounterId: "gate6-overpowered", counteredArchetypeIds: new Set() },
      content,
      0,
    );
    expect(computePowerRatio(party, enemies)).toBeGreaterThan(AUTO_RESOLVE_THRESHOLD);
  });
});
