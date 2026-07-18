import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadContentFromDir } from "../../src/content/loader.js";
import { canEquip, hasMasteryBonus } from "../../src/content/access.js";
import { computeAbilityPower } from "../../src/content/formula.js";
import type { PowerFormula } from "../../src/content/types.js";
import { withTempContentDir } from "./tempContentDir.js";

// Gate 1 — hot-load a new class with zero code changes (the headline
// gate). Writes a REAL new job TOML file into an isolated copy of the
// content directory, reloads, and asserts the game picks it up:
// loadable, equippable, its abilities resolve. No .ts file touched.

const NEW_ABILITY = `
id = "ability:_gate1-signature"
name = "Gate 1 Signature Strike"
tags = ["shadow"]
primary_domain_tag = "shadow"
target_shape = "one"
tick_cost = 90
resource_cost = 2

[[effects]]
primitive = "damage"
params = { power_formula = { base = { kind = "primary_stat", stat = "AGI" }, multipliers = [ { kind = "constant", value = 1.1 } ] } }
`;

const NEW_JOB = `
id = "job:_gate1-fixture"
name = "Gate 1 Fixture Rogue"
primary_tag = "shadow"
allowed_tags = ["shadow", "martial"]
signature_abilities = ["ability:_gate1-signature"]
equip_proficiencies = ["weapon:sword"]
default_row = "back"

[stat_growth]
STR = 1
INT = 0
VIT = 1
AGI = 3
PER = 1
`;

describe("Gate 1 — hot-load a new class with zero code changes", () => {
  it("a brand-new job added only as a TOML file is loadable, equippable, and its abilities resolve", () => {
    withTempContentDir(
      (dir) => {
        writeFileSync(join(dir, "abilities", "_gate1_fixture.toml"), NEW_ABILITY, "utf8");
        writeFileSync(join(dir, "jobs", "_gate1_fixture.toml"), NEW_JOB, "utf8");
      },
      (dir) => {
        const content = loadContentFromDir(dir);

        const job = content.getJob("job:_gate1-fixture");
        expect(job.name).toBe("Gate 1 Fixture Rogue");
        expect(content.listJobs().some((j) => j.id === job.id)).toBe(true);

        const ability = content.getAbility("ability:_gate1-signature");
        expect(ability.effects[0].primitive).toBe("damage");

        // Equippable: signature ability bypasses the tag-overlap check entirely.
        expect(canEquip(job, ability)).toBe(true);
        expect(hasMasteryBonus(job, ability)).toBe(true);

        // Its abilities resolve: the power formula computes a real number.
        const formula = (ability.effects[0].params as { powerFormula: PowerFormula }).powerFormula;
        const power = computeAbilityPower({
          relevantStatValue: 15,
          jobLevel: 5,
          hasMasteryMatch: hasMasteryBonus(job, ability),
          formula,
        });
        expect(power).toBeCloseTo((15 + 5) * 1.1, 5);
      },
    );
  });
});
