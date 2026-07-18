import type { TierQuestGraph } from "./types.js";

/** BigInt-safe JSON serialization of a generated TierQuestGraph, for byte-identical comparisons (Gates 7, 8). */
export function serializeQuestGraph(graph: TierQuestGraph): string {
  return JSON.stringify(graph, (_key, value) => (typeof value === "bigint" ? { __bigint__: value.toString() } : value));
}
