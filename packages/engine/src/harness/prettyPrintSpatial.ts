import type { EmbeddedTier, ZoomScale } from "../spatial/types.js";
import { TILE_CODE, UNOWNED_CELL, coarseKey } from "../spatial/types.js";
import { ZOOM_TICKS_PER_STEP } from "../worldgen/config.js";

/**
 * Deliverable 8 — the ASCII/glyph dump.
 *
 * A DEBUG TOOL, not a renderer. Phase 10 owns pixels; this exists for the
 * same reason Phase 2's `gen --print` does: runs are far too long to walk
 * to deep tiers by hand, so all spatial balance work and the Gate 8
 * human spot-check happen through this.
 */

const TILE_GLYPH: Record<number, string> = {
  [TILE_CODE.impassable]: "#",
  [TILE_CODE.walkable]: ".",
  [TILE_CODE.poi]: "P",
};

const REGION_GLYPHS = "ABCDEFGH";

/** The coarse-cell view: region blobs, borders, backbone, node placements. */
export function prettyPrintCoarse(embedded: EmbeddedTier): string {
  const { tier, spatial } = embedded;
  const { blobs, borders, backbone, placements } = spatial;
  const lines: string[] = [];

  const nodeCells = new Map(placements.map((p) => [coarseKey(p.cell.cx, p.cell.cy), p]));

  lines.push(`=== TIER ${tier.tierIndex} (seed ${tier.seed}) — coarse grid ${blobs.gridSize}x${blobs.gridSize} ===`);
  lines.push("");
  lines.push("Regions:");
  tier.regions.forEach((region, i) => {
    const cells = [...spatial.blobs.owner].filter((o) => o === i).length;
    lines.push(`  ${REGION_GLYPHS[i]} = ${region.id} (${region.kernelId}) — ${cells} cells, ${region.nodes.length} nodes`);
  });
  lines.push("");
  lines.push(`Region graph: ${tier.regionEdges.map((e) => `${e.from}<->${e.to} (${e.weightTicks}t)`).join(", ") || "(none)"}`);
  lines.push(`Corridors carved: ${borders.connectedPairs.size}   SEALED borders: ${borders.sealedPairs.size}`);
  lines.push(`Exit node (boss / gateway to tier ${tier.tierIndex + 1}): ${spatial.exitNodeId}`);
  lines.push("");
  lines.push("  legend: UPPERCASE = logical node cell, lowercase = backbone, '-' = plain terrain, ' ' = tier boundary");
  lines.push("");

  for (let cy = 0; cy < blobs.gridSize; cy++) {
    let line = "  ";
    for (let cx = 0; cx < blobs.gridSize; cx++) {
      const owner = blobs.owner[cy * blobs.gridSize + cx];
      if (owner === UNOWNED_CELL) {
        line += "  ";
        continue;
      }
      const key = coarseKey(cx, cy);
      const glyph = REGION_GLYPHS[owner];
      if (nodeCells.has(key)) line += ` ${glyph}`;
      else if (backbone.has(key)) line += ` ${glyph.toLowerCase()}`;
      else line += " -";
    }
    lines.push(line);
  }

  lines.push("");
  lines.push("Logical node placements:");
  for (const p of placements) {
    const node = tier.regions[p.regionIndex].nodes.find((n) => n.id === p.logicalNodeId);
    lines.push(
      `  (${p.cell.cx},${p.cell.cy}) ${REGION_GLYPHS[p.regionIndex]}  ${node?.name ?? p.logicalNodeId}` +
        ` [${node?.kind ?? "?"}]${p.isExit ? "  << EXIT / boss gateway" : ""}`,
    );
  }

  return lines.join("\n");
}

/** The tile view: the actual walkable mask the player moves through. */
export function prettyPrintTiles(embedded: EmbeddedTier, zoom: ZoomScale = "far"): string {
  const { tier, spatial } = embedded;
  const { mask } = spatial;
  const lines: string[] = [];

  lines.push(
    `=== TIER ${tier.tierIndex} (seed ${tier.seed}) — ${zoom} zoom, ${mask.width}x${mask.height} tiles, ` +
      `${ZOOM_TICKS_PER_STEP[zoom]} tick(s)/step ===`,
  );
  lines.push("  legend: '.' walkable, '#' impassable, 'P' logical node");
  lines.push("");

  for (let y = 0; y < mask.height; y++) {
    let line = "";
    for (let x = 0; x < mask.width; x++) {
      line += TILE_GLYPH[mask.tiles[y * mask.width + x]] ?? "?";
    }
    lines.push(line);
  }

  const walkable = [...mask.tiles].filter((t) => t !== TILE_CODE.impassable).length;
  lines.push("");
  lines.push(`walkable tiles: ${walkable} / ${mask.tiles.length} (${((walkable / mask.tiles.length) * 100).toFixed(1)}%)`);

  return lines.join("\n");
}
