// ---------------------------------------------------------------------
// CLAUDE.md Phase 5 §13 — the four pre-engine checks, written first.
// Not "three known tactics-project bugs" (there were none) — three
// sequencing checks that were already correct, plus one new CTB-specific
// ordering question.
// ---------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { createRng } from "../../src/rng/index.js";
import { EventLogWriter } from "../../src/log/index.js";
import { runBattle } from "../../src/battle/resolver.js";
import { addModifier, resolveVariable } from "../../src/battle/registry.js";
import { applyStatus } from "../../src/battle/status.js";
import { rollDamage } from "../../src/battle/damage.js";
import { buildLiveState } from "../../src/battle/state.js";
import type { Ability } from "../../src/content/types.js";
import type { AbilityInput, BattleInput, BattleRequest } from "../../src/battle/types.js";
import { content, makeAmbusher, makeBruiser, makeWarrior } from "./fixtures.js";

function ctxFor(seed: bigint | number, encounterId: string) {
  const rng = createRng(seed).substream(`battle:${encounterId}`);
  return { content, rng, log: new EventLogWriter(), startTick: 0 };
}

describe("Gate §13.1 — counters: a dead actor never acts afterward", () => {
  it("an enemy killed mid-exchange never appears as an actor in the log", () => {
    const party = [makeWarrior({ id: "1-hero" })];
    const enemies = [
      makeBruiser({ id: "2-bruiser-1", hp: 40, maxHp: 40 }),
      makeBruiser({ id: "3-bruiser-2", hp: 1, maxHp: 1 }), // dies to the first cleave
    ];
    const request: BattleRequest = {
      party,
      encounter: enemies,
      encounterId: "gate13-counters",
      counteredArchetypeIds: new Set(),
    };
    const inputs: AbilityInput[] = [
      { kind: "ability", actorId: "1-hero", abilityId: "ability:cleave", targetId: "2-bruiser-1" },
      { kind: "ability", actorId: "1-hero", abilityId: "ability:cleave", targetId: "2-bruiser-1" },
      { kind: "ability", actorId: "1-hero", abilityId: "ability:cleave", targetId: "2-bruiser-1" },
      { kind: "ability", actorId: "1-hero", abilityId: "ability:cleave", targetId: "2-bruiser-1" },
      { kind: "ability", actorId: "1-hero", abilityId: "ability:cleave", targetId: "2-bruiser-1" },
      { kind: "ability", actorId: "1-hero", abilityId: "ability:cleave", targetId: "2-bruiser-1" },
      { kind: "ability", actorId: "1-hero", abilityId: "ability:cleave", targetId: "2-bruiser-1" },
      { kind: "ability", actorId: "1-hero", abilityId: "ability:cleave", targetId: "2-bruiser-1" },
    ];
    const result = runBattle(request, inputs, ctxFor(1n, "gate13-counters"));

    expect(result.outcome).toBe("party_win");
    const actedAsBruiser2 = result.log.filter(
      (e) => (e as { payload?: { actorId?: string } }).payload?.actorId === "3-bruiser-2",
    );
    expect(actedAsBruiser2).toHaveLength(0);
  });
});

describe("Gate §13.2 — doubles: a second hit resolves against post-first-hit state", () => {
  it("an oiled-then-damage double resolves the damage step against the just-applied vulnerability", () => {
    const oilThenSmash: Ability = {
      id: "test:oil-then-smash",
      name: "Oil Then Smash",
      tags: ["physical"],
      primaryDomainTag: "physical",
      targetShape: "one",
      tickCost: 100,
      resourceCost: 0,
      effects: [
        { primitive: "apply_status", params: { status: "oiled", baseDuration: 10, baseMagnitude: 0.5 } },
        { primitive: "damage", params: { powerFormula: { base: { kind: "primary_stat", stat: "STR" }, multipliers: [{ kind: "constant", value: 1 }] } } },
      ],
    };
    const smashOnly: Ability = { ...oilThenSmash, id: "test:smash-only", effects: [oilThenSmash.effects[1]] };

    function runWith(ability: Ability) {
      const party = [makeWarrior({ id: "1-hero", hp: 1, maxHp: 100 })];
      const enemies = [makeAmbusher({ id: "2-ambusher", abilities: [ability] })];
      const request: BattleRequest = { party, encounter: enemies, encounterId: `gate13-doubles-${ability.id}`, counteredArchetypeIds: new Set() };
      // Hero defends (a no-op for this check); the enemy then acts and one hit ends the
      // fight (hero starts at 1 HP) so the loop terminates deterministically after exactly
      // one exchange, regardless of which ability variant is used.
      const inputs: BattleInput[] = [{ kind: "defend", actorId: "1-hero" }];
      const result = runBattle(request, inputs, ctxFor(42n, `gate13-doubles-${ability.id}`));
      const damageEvent = result.log.find((e) => (e as { type: string }).type === "battle:damage") as { payload: { amount: number } };
      return damageEvent.payload.amount;
    }

    const amountWithOil = runWith(oilThenSmash);
    const amountWithoutOil = runWith(smashOnly);

    // Both runs consume the identical rng draws for the damage effect (apply_status draws none),
    // so the only difference is the 1.5x damageTakenMult the oiled status (applied moments
    // earlier in the SAME ability) left live for the damage effect to read.
    expect(amountWithOil).toBeGreaterThan(amountWithoutOil);
    expect(amountWithOil).toBeCloseTo(Math.round(amountWithoutOil * 1.5), 0);
  });

  it("registry state set by one effect is visible to the next resolveVariable call, not snapshotted", () => {
    const { enemies } = buildLiveState(
      { party: [], encounter: [makeAmbusher({ id: "x" })], encounterId: "gate13-doubles-unit", counteredArchetypeIds: new Set() },
      content,
      0,
    );
    const target = enemies[0];
    expect(resolveVariable(target, "damageTakenMult", 0)).toBe(1);
    applyStatus(target, { status: "oiled", baseDuration: 10, baseMagnitude: 0.5, source: "test", currentTick: 0 });
    expect(resolveVariable(target, "damageTakenMult", 0)).toBeCloseTo(1.5, 5);
  });
});

describe("Gate §13.3 — variance is margin, not outcome", () => {
  it("a decisively-differentiated fight never flips outcome across many rng draws", () => {
    const outcomes = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const party = [makeWarrior({ id: "1-hero", stats: { STR: 40, INT: 5, VIT: 30, AGI: 15, PER: 10 }, hp: 300, maxHp: 300 })];
      const enemies = [makeBruiser({ id: "2-bruiser", hp: 20, maxHp: 20, stats: { STR: 2, INT: 1, VIT: 2, AGI: 2, PER: 1 } })];
      const request: BattleRequest = { party, encounter: enemies, encounterId: `gate13-variance-${seed}`, counteredArchetypeIds: new Set() };
      const inputs: AbilityInput[] = Array.from({ length: 10 }, () => ({
        kind: "ability" as const,
        actorId: "1-hero",
        abilityId: "ability:cleave",
        targetId: "2-bruiser",
      }));
      const result = runBattle(request, inputs, ctxFor(seed, `gate13-variance-${seed}`));
      outcomes.add(result.outcome);
    }
    expect(outcomes).toEqual(new Set(["party_win"]));
  });

  it("the uncountered soft-gate widens variance without ever flipping a decisive fight", () => {
    const outcomes = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const party = [makeWarrior({ id: "1-hero", stats: { STR: 40, INT: 5, VIT: 30, AGI: 15, PER: 10 }, hp: 300, maxHp: 300 })];
      const enemies = [makeAmbusher({ id: "2-ambusher", hp: 20, maxHp: 20, stats: { STR: 2, INT: 1, VIT: 2, AGI: 2, PER: 1 } })];
      // counteredArchetypeIds left empty — soft gate is "uncountered" for this fight.
      const request: BattleRequest = { party, encounter: enemies, encounterId: `gate13-uncountered-${seed}`, counteredArchetypeIds: new Set() };
      const inputs: AbilityInput[] = Array.from({ length: 10 }, () => ({
        kind: "ability" as const,
        actorId: "1-hero",
        abilityId: "ability:cleave",
        targetId: "2-ambusher",
      }));
      const result = runBattle(request, inputs, ctxFor(seed, `gate13-uncountered-${seed}`));
      outcomes.add(result.outcome);
    }
    expect(outcomes).toEqual(new Set(["party_win"]));
  });
});

describe("Gate §13.4 — Break-trigger vs accuracy-scaler ordering is stable", () => {
  it("a simultaneous glancing-blow scalar and Break-trigger resolve identically across repeated calls", () => {
    function buildScenario() {
      const { party, enemies } = buildLiveState(
        { party: [makeWarrior({ id: "1-hero" })], encounter: [makeAmbusher({ id: "2-ambusher", breakShieldMax: 1 })], encounterId: "gate13-ordering", counteredArchetypeIds: new Set() },
        content,
        0,
      );
      const attacker = party[0];
      addModifier(attacker, { targetVariable: "accuracyScalar", operation: "multiply", magnitude: 0.5, durationTicks: null, source: "test:glancing", currentTick: 0 });
      return { attacker, target: enemies[0] };
    }

    function roll(seed: bigint) {
      const { attacker, target } = buildScenario();
      const rng = createRng(seed).substream("gate13-ordering");
      return rollDamage({
        attacker,
        target,
        powerFormula: { base: { kind: "primary_stat", stat: "STR" }, multipliers: [{ kind: "constant", value: 1 }] },
        channel: "physical",
        abilityTags: ["holy"], // exploits the ambusher's undead->holy weakness
        targetWeaknessTags: content.getWeaknessesFor(target.tags),
        relevantStatValue: attacker.stats.STR,
        jobLevel: attacker.level,
        hasMasteryMatch: false,
        uncountered: true,
        currentTick: 0,
        rng,
      });
    }

    const first = roll(7n);
    const second = roll(7n);
    expect(second).toEqual(first);
    expect(first.accuracyScalar).toBeCloseTo(0.5, 5);
    expect(first.isWeaknessHit).toBe(true);
  });
});
