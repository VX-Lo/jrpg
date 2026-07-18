import type { Rng } from "../../rng/index.js";
import type { Grammar, RuleExpansion } from "./types.js";
import { KERNELS } from "../../worldgen/kernels/index.js";

const SYMBOL_PATTERN = /#([a-zA-Z_][a-zA-Z0-9_]*)#/g;
const MAX_EXPANSION_DEPTH = 20;
const RESERVED_KERNEL_ROOT_SYMBOL = "kernelRoot";

function textOf(expansion: RuleExpansion): string {
  return typeof expansion === "string" ? expansion : expansion.text;
}
function weightOf(expansion: RuleExpansion): number {
  return typeof expansion === "string" ? 1 : expansion.weight;
}

/** Weighted selection from a named substream (D4 — every random selection draws from one). Integer weights use exact rejection-sampled draws; non-integer weights fall back to a float-scaled draw. */
function pickWeighted(rng: Rng, options: readonly RuleExpansion[]): string {
  if (options.length === 0) throw new Error("pickWeighted: options must be non-empty");
  const weights = options.map(weightOf);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) throw new Error("pickWeighted: total weight must be positive");

  const allIntegerWeights = weights.every((w) => Number.isInteger(w));
  const roll = allIntegerWeights ? rng.nextInt(total) : rng.nextFloat() * total;

  let cumulative = 0;
  for (let i = 0; i < options.length; i++) {
    cumulative += weights[i];
    if (roll < cumulative) return textOf(options[i]);
  }
  return textOf(options[options.length - 1]);
}

function kernelRootOptions(kernelId: string): RuleExpansion[] {
  const kernel = KERNELS.find((k) => k.id === kernelId);
  if (!kernel) throw new Error(`expandGrammar: unknown kernel "${kernelId}"`);
  return kernel.lexiconRoots.map((root) => ({ text: root, weight: 1 }));
}

/**
 * Symbol-expansion model (Tracery's core), reimplemented against Rng —
 * no off-the-shelf grammar library, since every one of those uses
 * Math.random(). Same grammar + same rng draws = same output, always
 * (Gate 3). `rng` must already be derived from a named substream by the
 * caller (see the `grammar:{grammarId}:{contextKey}` convention).
 */
export function expandGrammar(grammar: Grammar, rootSymbol: string, rng: Rng): string {
  function expandSymbol(symbol: string, depth: number): string {
    if (depth > MAX_EXPANSION_DEPTH) {
      throw new Error(
        `expandGrammar: max expansion depth exceeded at symbol "#${symbol}#" — grammar "${grammar.id}" likely has a reference cycle`,
      );
    }
    let options: readonly RuleExpansion[];
    if (symbol === RESERVED_KERNEL_ROOT_SYMBOL) {
      if (!grammar.kernelId) {
        throw new Error(`expandGrammar: grammar "${grammar.id}" uses #kernelRoot# but has no kernelId`);
      }
      options = kernelRootOptions(grammar.kernelId);
    } else {
      const rule = grammar.rules[symbol];
      if (!rule) throw new Error(`expandGrammar: grammar "${grammar.id}" has no rule for symbol "#${symbol}#"`);
      options = rule;
    }
    const chosen = pickWeighted(rng, options);
    return expandText(chosen, depth + 1);
  }

  function expandText(text: string, depth: number): string {
    return text.replace(SYMBOL_PATTERN, (_match, symbol: string) => expandSymbol(symbol, depth));
  }

  return expandSymbol(rootSymbol, 0);
}

/**
 * Uniform pick from a curated proper-noun pool — the OTHER consumer of
 * the substream convention this phase. No grammar, no concatenation:
 * proper nouns come from curated pools, keyed by region (D4's /names
 * distinction). `rng` must already be derived from a named substream.
 */
export function pickFromPool(pool: readonly string[], rng: Rng): string {
  if (pool.length === 0) throw new Error("pickFromPool: pool must be non-empty");
  return pool[rng.nextInt(pool.length)];
}
