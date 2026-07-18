import type { Grammar, RuleExpansion } from "./types.js";
import { KERNELS } from "../../worldgen/kernels/index.js";

const SYMBOL_PATTERN = /#([a-zA-Z_][a-zA-Z0-9_]*)#/g;

function textOf(expansion: RuleExpansion): string {
  return typeof expansion === "string" ? expansion : expansion.text;
}

function fail(context: string, message: string): never {
  throw new Error(`${context}: ${message}`);
}

/** Validates a grammar at load time: every `#symbol#` reference must resolve to a declared rule or the reserved `#kernelRoot#`. Fail loud, never a silent skip. */
export function validateGrammar(raw: unknown, context: string): Grammar {
  const r = raw as Record<string, unknown>;
  if (typeof r?.id !== "string" || r.id.length === 0) {
    fail(context, `field "id" must be a non-empty string`);
  }
  const id = r.id;
  const c = `grammar "${id}" (${context})`;

  const kernelId = r.kernel_id !== undefined ? String(r.kernel_id) : undefined;
  if (kernelId && !KERNELS.some((k) => k.id === kernelId)) {
    fail(c, `unknown kernel_id "${kernelId}"`);
  }

  const rulesRaw = r.rules as Record<string, unknown>;
  if (!rulesRaw || typeof rulesRaw !== "object") {
    fail(c, `"rules" must be a table mapping symbol -> array of expansions`);
  }

  const rules: Record<string, RuleExpansion[]> = {};
  for (const [symbol, value] of Object.entries(rulesRaw)) {
    if (!Array.isArray(value) || value.length === 0) {
      fail(c, `rule "${symbol}" must be a non-empty array`);
    }
    rules[symbol] = value.map((entry, i) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).text === "string") {
        const weight = (entry as Record<string, unknown>).weight;
        if (typeof weight !== "number" || weight <= 0) {
          fail(c, `rule "${symbol}"[${i}] weight must be a positive number`);
        }
        return { text: (entry as Record<string, unknown>).text as string, weight: weight as number };
      }
      fail(c, `rule "${symbol}"[${i}] must be a string or a { text, weight } table`);
    });
  }

  for (const [symbol, expansions] of Object.entries(rules)) {
    for (const expansion of expansions) {
      for (const match of textOf(expansion).matchAll(SYMBOL_PATTERN)) {
        const referenced = match[1];
        if (referenced === "kernelRoot") {
          if (!kernelId) fail(c, `rule "${symbol}" references #kernelRoot# but this grammar has no kernel_id`);
          continue;
        }
        if (!(referenced in rules)) {
          fail(c, `rule "${symbol}" references unknown symbol "#${referenced}#"`);
        }
      }
    }
  }

  return { id, kernelId, rules };
}
