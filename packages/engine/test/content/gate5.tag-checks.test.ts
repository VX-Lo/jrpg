import { describe, expect, it } from "vitest";
import { canEquip, hasMasteryBonus } from "../../src/content/access.js";
import { computeAbilityPower } from "../../src/content/formula.js";
import type { Ability, Job } from "../../src/content/types.js";
import { loadContentFromDir } from "../../src/content/loader.js";
import { CONTENT_DIR } from "./contentDir.js";

// Gate 5 — tag checks are correct. Two distinct checks (D3), tested
// separately: overlap ACCESS and primary-match MASTERY.

function makeAbility(overrides: Partial<Ability>): Ability {
  return {
    id: "ability:test",
    name: "Test Ability",
    tags: ["holy", "fire"],
    primaryDomainTag: "holy",
    targetShape: "one",
    tickCost: 100,
    resourceCost: 0,
    effects: [],
    ...overrides,
  };
}

function makeJob(overrides: Partial<Job>): Job {
  return {
    id: "job:test",
    name: "Test Job",
    statGrowth: { STR: 0, INT: 0, VIT: 0, AGI: 0, PER: 0 },
    primaryTag: "holy",
    allowedTags: ["holy"],
    signatureAbilities: [],
    equipProficiencies: [],
    defaultRow: "front",
    ...overrides,
  };
}

describe("Gate 5 — tag checks", () => {
  it("overlap access: a {holy} job can equip a {holy, fire} ability", () => {
    const job = makeJob({ allowedTags: ["holy"] });
    const ability = makeAbility({ tags: ["holy", "fire"] });
    expect(canEquip(job, ability)).toBe(true);
  });

  it("overlap access: a {shadow} job CANNOT equip a {holy, fire} ability", () => {
    const job = makeJob({ allowedTags: ["shadow"] });
    const ability = makeAbility({ tags: ["holy", "fire"] });
    expect(canEquip(job, ability)).toBe(false);
  });

  it("overlap access is not full containment: partial tag overlap is enough", () => {
    const job = makeJob({ allowedTags: ["fire", "frost"] }); // only overlaps on "fire", not "holy"
    const ability = makeAbility({ tags: ["holy", "fire"] });
    expect(canEquip(job, ability)).toBe(true);
  });

  it("mastery: matching primary tag grants the job_level_bonus (nonzero delta vs. no-mastery)", () => {
    const job = makeJob({ primaryTag: "holy" });
    const ability = makeAbility({ primaryDomainTag: "holy" });
    expect(hasMasteryBonus(job, ability)).toBe(true);

    const withMastery = computeAbilityPower({
      relevantStatValue: 10,
      jobLevel: 5,
      hasMasteryMatch: hasMasteryBonus(job, ability),
      formula: { base: { kind: "primary_stat", stat: "INT" }, multipliers: [{ kind: "constant", value: 1 }] },
    });
    const withoutMastery = computeAbilityPower({
      relevantStatValue: 10,
      jobLevel: 5,
      hasMasteryMatch: false,
      formula: { base: { kind: "primary_stat", stat: "INT" }, multipliers: [{ kind: "constant", value: 1 }] },
    });
    expect(withMastery).toBeGreaterThan(withoutMastery);
  });

  it("mastery: non-matching primary tag grants access but ZERO bonus — equippable, just not what they're built for", () => {
    const job = makeJob({ primaryTag: "shadow", allowedTags: ["shadow", "holy"] });
    const ability = makeAbility({ tags: ["holy", "fire"], primaryDomainTag: "holy" });

    // Equippable via overlap...
    expect(canEquip(job, ability)).toBe(true);
    // ...but no mastery bonus.
    expect(hasMasteryBonus(job, ability)).toBe(false);

    const power = computeAbilityPower({
      relevantStatValue: 10,
      jobLevel: 5,
      hasMasteryMatch: hasMasteryBonus(job, ability),
      formula: { base: { kind: "primary_stat", stat: "INT" }, multipliers: [{ kind: "constant", value: 1 }] },
    });
    // No mastery match => job_level_bonus is exactly 0 => power == raw stat.
    expect(power).toBe(10);
  });

  it("signature abilities bypass the tag check entirely, even with zero tag overlap", () => {
    const job = makeJob({ allowedTags: ["shadow"], signatureAbilities: ["ability:test"] });
    const ability = makeAbility({ id: "ability:test", tags: ["holy", "fire"] });
    expect(canEquip(job, ability)).toBe(true);
  });

  it("real fixture content: Warrior <-> Cleave has both access and mastery; Mage <-> Cleave has neither", () => {
    const content = loadContentFromDir(CONTENT_DIR);
    const warrior = content.getJob("job:warrior");
    const mage = content.getJob("job:mage");
    const cleave = content.getAbility("ability:cleave");

    expect(canEquip(warrior, cleave)).toBe(true);
    expect(hasMasteryBonus(warrior, cleave)).toBe(true);

    expect(canEquip(mage, cleave)).toBe(false);
    expect(hasMasteryBonus(mage, cleave)).toBe(false);
  });
});
