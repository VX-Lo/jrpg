// ---------------------------------------------------------------------
// Rule-10-at-load for module content (CLAUDE.md §6.5.2): a module's
// grants follow the EXACT same rule as Phase 5's combat modifiers.
// Reuses `assertModifierLegal`/`BOUNDED_VARIABLES` directly — no
// parallel validator.
// ---------------------------------------------------------------------

import { PRIMARY_STATS, type Module } from "../content/types.js";
import { assertModifierLegal, BOUNDED_VARIABLES } from "../battle/registry.js";
import type { ModifierOperation, ModifierVariable } from "../battle/types.js";

const KNOWN_VARIABLES: ReadonlySet<string> = new Set([...BOUNDED_VARIABLES, ...PRIMARY_STATS]);

/**
 * Validates every module's grants against the real registry variable
 * set. Throws (loud, at load — same discipline as content/validate.ts)
 * if a grant targets an unrecognized variable, or if a multiplicative
 * grant targets an unbounded one (the same `Rule10Violation` Phase 5's
 * `addModifier` throws at application time — checked here too, at load,
 * so a broken module fails immediately rather than only when equipped).
 */
export function assertModulesLegal(modules: readonly Module[]): void {
  for (const module of modules) {
    for (const grant of module.grants) {
      if (!KNOWN_VARIABLES.has(grant.targetVariable)) {
        throw new Error(
          `module "${module.id}": grant targets unrecognized variable "${grant.targetVariable}" — ` +
            `known variables: ${[...KNOWN_VARIABLES].join(", ")}`,
        );
      }
      assertModifierLegal(grant.targetVariable as ModifierVariable, grant.operation as ModifierOperation);
    }
  }
}
