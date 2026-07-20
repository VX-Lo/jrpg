import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { Good, GoodCategory, GoodId, GoodKind } from "./types.js";

// ---------------------------------------------------------------------
// Small structural helpers, same discipline as content/validate.ts:
// validate on load, fail loud, never a silent skip (Invariant #1/D1).
// Not exported from content/validate.ts, so duplicated here rather than
// reaching into another module's private helpers.
// ---------------------------------------------------------------------

function fail(context: string, message: string): never {
  throw new Error(`${context}: ${message}`);
}

function requireString(value: unknown, context: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(context, `field "${field}" must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireNumber(value: unknown, context: string, field: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    fail(context, `field "${field}" must be a number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireOneOf<T extends string>(value: unknown, options: readonly T[], context: string, field: string): T {
  if (typeof value !== "string" || !(options as readonly string[]).includes(value)) {
    fail(context, `field "${field}" must be one of ${JSON.stringify(options)}, got ${JSON.stringify(value)}`);
  }
  return value as T;
}

function validateGood(raw: unknown, index: number): Good {
  const c = `goods.toml goods[${index}]`;
  const r = raw as Record<string, unknown>;
  const id = requireString(r?.id, c, "id") as GoodId;
  const name = requireString(r?.name, c, "name");
  const category = requireString(r?.category, c, "category") as GoodCategory;
  const kind = requireOneOf<GoodKind>(r?.kind, ["raw", "processed"], c, "kind");
  const basePrice = requireNumber(r?.base_price, c, "base_price");
  if (basePrice <= 0) fail(c, `field "base_price" must be positive, got ${basePrice}`);
  return { id, name, category, kind, basePrice };
}

/**
 * Port interface (same dependency-inversion pattern as ContentPort):
 * consumers depend on this, never on goods.toml's layout directly.
 */
export interface EconomyContentPort {
  getGood(id: GoodId): Good;
  listGoods(): readonly Good[];
  listGoodsByCategory(category: GoodCategory): readonly Good[];
  listCategories(): readonly GoodCategory[];
}

/**
 * Loads and validates `goods.toml` — a single array-of-tables file
 * (invariant #15's convention for flat, simple entity kinds, same as
 * weapons.toml/tags.toml/threatArchetypes.toml). Fixture-scale content
 * (see CLAUDE.md Decisions log), not the full ~200-good catalog the
 * design doc specifies — same "prove the mechanism, defer full
 * authoring" precedent as Phase 2's 4 kernels / Phase 4.5's 81 chunks.
 */
export function loadEconomyContentFromDir(dir: string): EconomyContentPort {
  const raw = parseToml(readFileSync(join(dir, "goods.toml"), "utf8")) as { goods: unknown[] };
  if (!Array.isArray(raw.goods)) fail("goods.toml", `top-level "goods" must be an array of tables`);
  const goods = raw.goods.map((g, i) => validateGood(g, i));

  const byId = new Map(goods.map((g) => [g.id, g]));
  const byCategory = new Map<GoodCategory, Good[]>();
  for (const good of goods) {
    const list = byCategory.get(good.category) ?? [];
    list.push(good);
    byCategory.set(good.category, list);
  }

  return {
    getGood: (id) => {
      const good = byId.get(id);
      if (!good) throw new Error(`EconomyContentPort: unknown good "${id}"`);
      return good;
    },
    listGoods: () => goods,
    listGoodsByCategory: (category) => byCategory.get(category) ?? [],
    listCategories: () => [...byCategory.keys()],
  };
}
