import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadContentFromDir } from "../../src/content/loader.js";
import { computeAbilityPower } from "../../src/content/formula.js";
import type { DamageParams, ApplyStatusParams } from "../../src/content/types.js";
import { withTempContentDir } from "./tempContentDir.js";

// Gate 2 — a new ability composing only already-implemented primitives,
// zero engine changes. This ability combines `damage` and
// `apply_status` — a genuinely new composition, not a new primitive.
// It must load, validate, and compute correct power.

const NEW_ABILITY = `
id = "ability:_gate2-venom-strike"
name = "Venom Strike"
tags = ["poison", "martial"]
primary_domain_tag = "poison"
target_shape = "one"
tick_cost = 100
resource_cost = 6

[[effects]]
primitive = "damage"
params = { power_formula = { base = { kind = "primary_stat", stat = "STR" }, multipliers = [ { kind = "constant", value = 1.0 } ] } }

[[effects]]
primitive = "apply_status"
params = { status = "poison", base_duration = 2, base_magnitude = 3 }
`;

describe("Gate 2 — new ability from existing primitives", () => {
  it("a new ability combining damage + apply_status loads, validates, and computes correct power", () => {
    withTempContentDir(
      (dir) => writeFileSync(join(dir, "abilities", "_gate2_fixture.toml"), NEW_ABILITY, "utf8"),
      (dir) => {
        const content = loadContentFromDir(dir);
        const ability = content.getAbility("ability:_gate2-venom-strike");

        expect(ability.effects).toHaveLength(2);
        expect(ability.effects[0].primitive).toBe("damage");
        expect(ability.effects[1].primitive).toBe("apply_status");

        const damageParams = ability.effects[0].params as DamageParams;
        const power = computeAbilityPower({
          relevantStatValue: 12,
          jobLevel: 4,
          hasMasteryMatch: true,
          formula: damageParams.powerFormula,
        });
        // additive: (12 + 4*JOB_LEVEL_BONUS_PER_LEVEL) * 1.0
        expect(power).toBeCloseTo(16, 5);

        const statusParams = ability.effects[1].params as ApplyStatusParams;
        expect(statusParams.status).toBe("poison");
        expect(statusParams.baseDuration).toBe(2);
        expect(statusParams.baseMagnitude).toBe(3);
      },
    );
  });
});
