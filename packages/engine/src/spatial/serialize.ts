import type { SpatialTier } from "./types.js";

/**
 * BigInt-safe, byte-comparable serialisation of an embedded tier — the
 * same role `worldgen/serialize.ts` plays for a Tier, and what the
 * determinism and cold-depth gates diff.
 *
 * Typed arrays are emitted as plain number arrays because JSON.stringify
 * renders a Uint8Array as an object keyed by index, which compares equal
 * for equal contents but is enormous and unreadable in a failure diff.
 */
export function serializeSpatialTier(spatial: SpatialTier): string {
  return JSON.stringify(
    {
      tierIndex: spatial.tierIndex,
      seed: spatial.seed,
      gridSize: spatial.blobs.gridSize,
      owner: Array.from(spatial.blobs.owner),
      seeds: spatial.blobs.seeds,
      connectedPairs: [...spatial.borders.connectedPairs].sort(),
      sealedPairs: [...spatial.borders.sealedPairs].sort(),
      corridorEdges: [...spatial.borders.corridorEdges].sort(),
      placements: spatial.placements,
      backbone: [...spatial.backbone].sort(),
      chunks: spatial.chunks,
      exitNodeId: spatial.exitNodeId,
      mask: Array.from(spatial.mask.tiles),
      decor: Array.from(spatial.decor),
      visualRegion: Array.from(spatial.visualRegion),
    },
    (_key, value) => (typeof value === "bigint" ? { __bigint__: value.toString() } : value),
  );
}
