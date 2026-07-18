import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadContentFromDir } from "../../src/content/loader.js";
import { withTempContentDir } from "./tempContentDir.js";

// Gate 4 — formula safety (rule 10), enforced at load. Writes a REAL
// malformed ability TOML file into an isolated copy of the content
// directory — an ability whose power formula multiplies an unbounded
// factor (job_level, or the equipped weapon's scaling stat) into the
// base — and proves the loader rejects it.

const UNBOUNDED_MULTIPLIER_CASES = [
  { label: "job_level as a multiplier", multiplier: `{ kind = "job_level" }` },
  { label: "primary_stat as a multiplier", multiplier: `{ kind = "primary_stat" }` },
  { label: "weapon_scaling as a multiplier", multiplier: `{ kind = "weapon_scaling" }` },
];

function abilityWithMultiplier(multiplier: string): string {
  return `
id = "ability:_gate4-fixture"
name = "Gate 4 Fixture"
tags = ["martial"]
primary_domain_tag = "martial"
target_shape = "one"
tick_cost = 100
resource_cost = 0

[[effects]]
primitive = "damage"
params = { power_formula = { base = { kind = "primary_stat", stat = "STR" }, multipliers = [ ${multiplier} ] } }
`;
}

describe("Gate 4 — formula safety", () => {
  it.each(UNBOUNDED_MULTIPLIER_CASES)("rejects a formula that uses $label", ({ multiplier }) => {
    withTempContentDir(
      (dir) => writeFileSync(join(dir, "abilities", "_gate4_fixture.toml"), abilityWithMultiplier(multiplier), "utf8"),
      (dir) => {
        expect(() => loadContentFromDir(dir)).toThrow(/rule 10|not bounded|Additive-only/i);
      },
    );
  });

  it("accepts a formula using only bounded multipliers (positive control, proves the gate isn't vacuous)", () => {
    withTempContentDir(
      (dir) => writeFileSync(join(dir, "abilities", "_gate4_fixture.toml"), abilityWithMultiplier(`{ kind = "constant", value = 1.5 }`), "utf8"),
      (dir) => {
        expect(() => loadContentFromDir(dir)).not.toThrow();
      },
    );
  });
});
