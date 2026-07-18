import type { Tier } from "./types.js";

/** BigInt-safe JSON serialization of a generated Tier, for byte-identical comparisons (Gates 2, 4, 5). */
export function serializeTier(tier: Tier): string {
  return JSON.stringify(tier, (_key, value) =>
    typeof value === "bigint" ? { __bigint__: value.toString() } : value,
  );
}
