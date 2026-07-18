import { describe, expect, it } from "vitest";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContentFromDir } from "../../src/content/loader.js";
import { withTempContentDir } from "./tempContentDir.js";

// Gate 6 — validation fails loud. Each case writes a REAL malformed
// fixture into an isolated copy of the content directory and asserts
// loadContentFromDir throws a clear, specific error. Never a silent skip.

describe("Gate 6 — validation fails loud", () => {
  it("rejects a malformed ability (missing required field)", () => {
    const malformed = `
id = "ability:_gate6-malformed"
name = "Malformed"
tags = ["martial"]
primary_domain_tag = "martial"
tick_cost = 100
resource_cost = 0

[[effects]]
primitive = "damage"
params = { power_formula = { base = { kind = "primary_stat", stat = "STR" }, multipliers = [] } }
`;
    // Missing target_shape entirely.
    withTempContentDir(
      (dir) => writeFileSync(join(dir, "abilities", "_gate6_malformed.toml"), malformed, "utf8"),
      (dir) => {
        expect(() => loadContentFromDir(dir)).toThrow(/target_shape/);
      },
    );
  });

  it("rejects an ability referencing an unknown primitive", () => {
    const malformed = `
id = "ability:_gate6-unknown-primitive"
name = "Unknown Primitive"
tags = ["martial"]
primary_domain_tag = "martial"
target_shape = "one"
tick_cost = 100
resource_cost = 0

[[effects]]
primitive = "teleport_swap"
params = { amount = 1 }
`;
    withTempContentDir(
      (dir) => writeFileSync(join(dir, "abilities", "_gate6_unknown_primitive.toml"), malformed, "utf8"),
      (dir) => {
        expect(() => loadContentFromDir(dir)).toThrow(/unknown primitive "teleport_swap"/);
      },
    );
  });

  it("rejects an ability referencing an unknown tag", () => {
    const malformed = `
id = "ability:_gate6-unknown-tag"
name = "Unknown Tag"
tags = ["nonexistent-tag"]
primary_domain_tag = "nonexistent-tag"
target_shape = "one"
tick_cost = 100
resource_cost = 0

[[effects]]
primitive = "modify_threat"
params = { amount = 1 }
`;
    withTempContentDir(
      (dir) => writeFileSync(join(dir, "abilities", "_gate6_unknown_tag.toml"), malformed, "utf8"),
      (dir) => {
        expect(() => loadContentFromDir(dir)).toThrow(/unknown tag "nonexistent-tag"/);
      },
    );
  });

  it("rejects a weapon referencing an unknown scaling stat", () => {
    withTempContentDir(
      (dir) => {
        const weaponsPath = join(dir, "weapons.toml");
        const original = readFileSync(weaponsPath, "utf8");
        const appended =
          original +
          `\n[[weapons]]\nid = "weapon:_gate6-bad"\nname = "Bad Weapon"\nreach = "melee"\nscaling_stat = "LUK"\nslot_display = { striking = "edge", core = "tang" }\n`;
        writeFileSync(weaponsPath, appended, "utf8");
      },
      (dir) => {
        expect(() => loadContentFromDir(dir)).toThrow(/scaling_stat/);
      },
    );
  });

  it('rejects a job referencing an unknown ability in signature_abilities', () => {
    const malformed = `
id = "job:_gate6-bad"
name = "Bad Job"
primary_tag = "martial"
allowed_tags = ["martial"]
signature_abilities = ["ability:does-not-exist"]
equip_proficiencies = ["weapon:sword"]
default_row = "front"

[stat_growth]
STR = 1
INT = 1
VIT = 1
AGI = 1
PER = 1
`;
    withTempContentDir(
      (dir) => writeFileSync(join(dir, "jobs", "_gate6_bad_job.toml"), malformed, "utf8"),
      (dir) => {
        expect(() => loadContentFromDir(dir)).toThrow(/unknown ability "ability:does-not-exist"/);
      },
    );
  });
});
