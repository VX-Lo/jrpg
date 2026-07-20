// ---------------------------------------------------------------------
// Phase 6.5 gate (CLAUDE.md): equip round-trip, crafted fee via
// EconomyPort, looted gear grade distribution, slot exclusivity, and a
// full rule-10 audit with real module content loaded.
// ---------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { createRng } from "../../src/rng/index.js";
import { EventLogWriter } from "../../src/log/index.js";
import { buildLiveState } from "../../src/battle/state.js";
import { resolveVariable, Rule10Violation } from "../../src/battle/registry.js";
import { rollGrade, rollLootedGear } from "../../src/content/gearInstance.js";
import { createEconomyPort, type EconomyRegionSpec } from "../../src/economy/market.js";
import { loadEconomyContentFromDir } from "../../src/economy/loader.js";
import { equipModuleModifiers, unequipModuleModifiers } from "../../src/equipment/apply.js";
import { assertModulesLegal } from "../../src/equipment/moduleValidation.js";
import { craftFee } from "../../src/equipment/crafting.js";
import { equipHead, equipModule, equipWeapon, unequipModule } from "../../src/equipment/loadout.js";
import { EMPTY_LOADOUT, SlotExclusivityError } from "../../src/equipment/types.js";
import { CONTENT_DIR, content, makeWarrior } from "../battle/fixtures.js";

const economyContent = loadEconomyContentFromDir(CONTENT_DIR);

const REGIONS: EconomyRegionSpec[] = [{ regionId: "region:a", economicAxis: "mixed" }];

describe("Phase 6.5 gate 1 — equip/unequip round-trip", () => {
  it("a module's modifiers apply exactly on equip and clear exactly on unequip", () => {
    const { party } = buildLiveState(
      { party: [makeWarrior({ id: "hero" })], encounter: [], encounterId: "gate6.5-equip", counteredArchetypeIds: new Set() },
      content,
      0,
    );
    const actor = party[0];
    const quickstep = content.getModule("module:quickstep");

    expect(resolveVariable(actor, "actionCostMult", 0)).toBe(1);
    equipModuleModifiers(actor, quickstep, 0);
    expect(resolveVariable(actor, "actionCostMult", 0)).toBeCloseTo(0.9, 5);
    unequipModuleModifiers(actor, quickstep);
    expect(resolveVariable(actor, "actionCostMult", 0)).toBe(1);
  });

  it("an additive STR module round-trips too", () => {
    const { party } = buildLiveState(
      { party: [makeWarrior({ id: "hero" })], encounter: [], encounterId: "gate6.5-equip-str", counteredArchetypeIds: new Set() },
      content,
      0,
    );
    const actor = party[0];
    const steadyGrip = content.getModule("module:steady-grip");
    const baseStr = actor.stats.STR;

    equipModuleModifiers(actor, steadyGrip, 0);
    expect(resolveVariable(actor, "STR", 0)).toBe(baseStr + 2);
    unequipModuleModifiers(actor, steadyGrip);
    expect(resolveVariable(actor, "STR", 0)).toBe(baseStr);
  });
});

describe("Phase 6.5 gate 2 — crafted fee via EconomyPort", () => {
  it("fee is computed purely from EconomyPort quotes, scaling with grade the same way the port's own prices do", () => {
    const economy = createEconomyPort(economyContent, REGIONS, createRng(1).substream("gate6.5-fee"), new EventLogWriter());
    const strikingId = "good:ingot-iron";
    const coreId = "good:lumber-oak";

    for (const grade of [1, 2, 3] as const) {
      const expected =
        economy.quoteBuyPrice(REGIONS[0].regionId, strikingId, grade) * (grade === 1 ? 1 : grade === 2 ? 2 : 4) +
        economy.quoteBuyPrice(REGIONS[0].regionId, coreId, grade) * (grade === 1 ? 1 : grade === 2 ? 2 : 4);
      expect(craftFee(economy, REGIONS[0].regionId, grade)).toBeCloseTo(expected, 5);
    }
  });
});

describe("Phase 6.5 gate 3 — looted gear resolves to a real instance at the correct grade distribution", () => {
  it("higher tier bands roll higher grades more often, across many sampled encounters", () => {
    const weapons = content.listWeaponArchetypes();
    const armor = content.listArmorArchetypes();
    const rng = createRng(5).substream("gate6.5-loot");

    function gradeDistribution(band: number, n: number): Record<number, number> {
      const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
      for (let i = 0; i < n; i++) {
        const instance = rollLootedGear(weapons, armor, band, rng, `loot-${band}-${i}`);
        counts[instance.grade]++;
        expect(instance.instanceId).toBe(`loot-${band}-${i}`);
        expect(instance.displayName.length).toBeGreaterThan(0);
      }
      return counts;
    }

    const lowBand = gradeDistribution(1, 500);
    const highBand = gradeDistribution(60, 500);

    expect(lowBand[1]).toBeGreaterThan(lowBand[2] + lowBand[3]);
    expect(highBand[2] + highBand[3]).toBeGreaterThan(lowBand[2] + lowBand[3]);
  });

  it("rollGrade is monotonic in band at fixed rng draws", () => {
    for (let i = 0; i < 50; i++) {
      const rngA = createRng(i).substream("gate6.5-monotone");
      const rngB = createRng(i).substream("gate6.5-monotone");
      const low = rollGrade(1, rngA);
      const high = rollGrade(80, rngB);
      expect(high).toBeGreaterThanOrEqual(low);
    }
  });
});

describe("Phase 6.5 gate 4 — slot exclusivity", () => {
  it("no double-equip of Weapon/Head/Body — equipping replaces, never stacks two items in one slot", () => {
    let loadout = EMPTY_LOADOUT;
    loadout = equipWeapon(loadout, "weapon:sword");
    loadout = equipWeapon(loadout, "weapon:bow");
    expect(loadout.weaponId).toBe("weapon:bow");

    loadout = equipHead(loadout, "armor:plate-helm");
    loadout = equipHead(loadout, "armor:hood");
    expect(loadout.headId).toBe("armor:hood");
  });

  it("modules: no double-equip of the same module, and slots are capped", () => {
    let loadout = EMPTY_LOADOUT;
    loadout = equipModule(loadout, "module:steady-grip");
    expect(() => equipModule(loadout, "module:steady-grip")).toThrow(SlotExclusivityError);

    loadout = equipModule(loadout, "module:quickstep");
    loadout = equipModule(loadout, "module:iron-will");
    expect(loadout.moduleIds).toHaveLength(3);
    expect(() => equipModule(loadout, "module:steady-grip")).toThrow(SlotExclusivityError);

    loadout = unequipModule(loadout, "module:quickstep");
    expect(loadout.moduleIds).toEqual(["module:steady-grip", "module:iron-will"]);
  });
});

describe("Phase 6.5 gate 5 — full rule-10 audit with real module content loaded", () => {
  it("every authored module passes assertModulesLegal", () => {
    expect(() => assertModulesLegal(content.listModules())).not.toThrow();
    expect(content.listModules().length).toBeGreaterThan(0);
  });

  it("a multiplicative grant on an unbounded primary stat is rejected", () => {
    expect(() =>
      assertModulesLegal([{ id: "module:illegal", name: "Illegal", grants: [{ targetVariable: "STR", operation: "multiply", magnitude: 2 }] }]),
    ).toThrow(Rule10Violation);
  });

  it("an unrecognized target variable is rejected", () => {
    expect(() =>
      assertModulesLegal([{ id: "module:bogus", name: "Bogus", grants: [{ targetVariable: "notAVariable", operation: "add", magnitude: 1 }] }]),
    ).toThrow();
  });
});
