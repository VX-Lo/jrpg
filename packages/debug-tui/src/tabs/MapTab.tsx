// ---------------------------------------------------------------------
// Map tab — generate a tier, walk it, look at it. Reuses Phase 4.5's
// assembly/chunk-library/zoom logic wholesale; this file only renders
// and moves a cursor over what embedTier/embedInterior/farthestZoomView
// already produce. Nothing here writes anywhere — every screen
// constructs fresh state from (seed, tier), uses it, discards it.
// ---------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import {
  worldgen,
  embedTier,
  embedInterior,
  farthestZoomView,
  defaultChunkLibrary,
  TILE_CODE,
  isWalkableCode,
  CHUNK_SIZE,
  ROOM_CHUNK_SIZE,
  type ZoomScale,
  type EmbeddedTier,
  type InteriorSpace,
  type TileMask,
  type Tier,
} from "../engine/access.js";
import type { DebugLog } from "../debugLog.js";

export interface MapTabProps {
  readonly seed: string;
  readonly onSeedChange: (seed: string) => void;
  readonly log: DebugLog;
}

type Mode = "normal" | "regenerate" | "teleport";
const ZOOM_ORDER: readonly ZoomScale[] = ["far", "medium", "closest", "farthest"];
const GLYPH = { impassable: "▓", walkable: "·", poi: "◆" } as const;

export const MAP_TAB_LEGEND =
  "arrows/WASD move · z zoom · r regenerate · t teleport · i inspect";

function parseSeed(raw: string): bigint | string {
  return /^-?\d+$/.test(raw) ? BigInt(raw) : raw;
}

function findFirstWalkable(mask: TileMask): { x: number; y: number } {
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (isWalkableCode(mask.tiles[y * mask.width + x])) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

function renderViewport(mask: TileMask, cursor: { x: number; y: number }, viewW: number, viewH: number): string[] {
  const halfW = Math.floor(viewW / 2);
  const halfH = Math.floor(viewH / 2);
  const startX = Math.min(Math.max(0, cursor.x - halfW), Math.max(0, mask.width - viewW));
  const startY = Math.min(Math.max(0, cursor.y - halfH), Math.max(0, mask.height - viewH));
  const rows: string[] = [];
  for (let y = startY; y < Math.min(mask.height, startY + viewH); y++) {
    let row = "";
    for (let x = startX; x < Math.min(mask.width, startX + viewW); x++) {
      if (x === cursor.x && y === cursor.y) {
        row += "@";
        continue;
      }
      const code = mask.tiles[y * mask.width + x];
      row += code === TILE_CODE.impassable ? GLYPH.impassable : code === TILE_CODE.poi ? GLYPH.poi : GLYPH.walkable;
    }
    rows.push(row);
  }
  return rows;
}

export function MapTab({ seed, onSeedChange, log }: MapTabProps): React.ReactElement {
  const { stdout } = useStdout();
  const [tierIndex, setTierIndex] = useState(1);
  const [zoom, setZoom] = useState<ZoomScale>("far");
  const [targetNodeId, setTargetNodeId] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [mode, setMode] = useState<Mode>("normal");
  const [promptText, setPromptText] = useState("");
  const [inspectOpen, setInspectOpen] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const tierSeed = parseSeed(seed);

  const tier: Tier = useMemo(() => worldgen(tierSeed, tierIndex), [seed, tierIndex]);
  const effectiveNodeId = targetNodeId ?? tier.bossNodeId;

  const embedded: EmbeddedTier | null = useMemo(() => {
    if (zoom !== "far") return null;
    return embedTier(tierSeed, tierIndex);
  }, [seed, tierIndex, zoom]);

  const interior: InteriorSpace | null = useMemo(() => {
    if (zoom !== "closest") return null;
    return embedInterior(tierSeed, tierIndex, effectiveNodeId);
  }, [seed, tierIndex, zoom, effectiveNodeId]);

  const farthestTargets = useMemo(() => {
    if (zoom !== "farthest") return null;
    return farthestZoomView(tier);
  }, [zoom, tier]);

  const mask: TileMask | null = zoom === "far" ? (embedded?.spatial.mask ?? null) : zoom === "closest" ? (interior?.mask ?? null) : null;

  useEffect(() => {
    if (mask) setCursor(findFirstWalkable(mask));
  }, [mask]);

  function cycleZoom(): void {
    const idx = ZOOM_ORDER.indexOf(zoom);
    const next = ZOOM_ORDER[(idx + 1) % ZOOM_ORDER.length];
    setZoom(next);
    log.push(`map: zoom -> ${next}`);
  }

  function submitPrompt(): void {
    if (mode === "regenerate") {
      const [newSeed, newTierStr] = promptText.trim().split(/\s+/);
      const newTier = newTierStr ? Number(newTierStr) : tierIndex;
      if (!Number.isInteger(newTier) || newTier < 1) {
        setStatusMsg(`tier must be a positive integer, got "${newTierStr}"`);
      } else {
        if (newSeed) onSeedChange(newSeed);
        setTierIndex(newTier);
        setTargetNodeId(null);
        setStatusMsg(`regenerated: seed=${newSeed || seed} tier=${newTier}`);
        log.push(`map: regenerated seed=${newSeed || seed} tier=${newTier}`);
      }
    } else if (mode === "teleport") {
      const raw = promptText.trim();
      const coordMatch = raw.match(/^(-?\d+)\s*,\s*(-?\d+)$/);
      if (coordMatch && mask) {
        const x = Number(coordMatch[1]);
        const y = Number(coordMatch[2]);
        if (x >= 0 && y >= 0 && x < mask.width && y < mask.height && isWalkableCode(mask.tiles[y * mask.width + x])) {
          setCursor({ x, y });
          setStatusMsg(`teleported to (${x},${y})`);
          log.push(`map: teleported to (${x},${y})`);
        } else {
          setStatusMsg(`(${x},${y}) is out of bounds or not walkable`);
        }
      } else if (zoom === "far" && embedded) {
        const placement = embedded.spatial.placements.find((p) => p.logicalNodeId === raw);
        if (placement) {
          const tx = placement.cell.cx * CHUNK_SIZE + Math.floor(CHUNK_SIZE / 2);
          const ty = placement.cell.cy * CHUNK_SIZE + Math.floor(CHUNK_SIZE / 2);
          setCursor({ x: tx, y: ty });
          setStatusMsg(`teleported to node "${raw}"`);
          log.push(`map: teleported to node "${raw}" at (${tx},${ty})`);
        } else {
          setStatusMsg(`no logical node "${raw}" in tier ${tierIndex} (or not walkable coords)`);
        }
      } else {
        setStatusMsg(`teleport target "${raw}" not understood — use "x,y" or a logical node id`);
      }
    }
    setMode("normal");
    setPromptText("");
  }

  useInput((input, key) => {
    if (mode !== "normal") {
      if (key.escape) {
        setMode("normal");
        setPromptText("");
        return;
      }
      if (key.return) {
        submitPrompt();
        return;
      }
      if (key.backspace || key.delete) {
        setPromptText((p) => p.slice(0, -1));
        return;
      }
      if (input) setPromptText((p) => p + input);
      return;
    }

    if (input === "z") return cycleZoom();
    if (input === "r") {
      setMode("regenerate");
      setPromptText(`${seed} ${tierIndex}`);
      return;
    }
    if (input === "t") {
      setMode("teleport");
      setPromptText("");
      return;
    }
    if (input === "i") return setInspectOpen((v) => !v);

    if (!mask) return;
    let { x, y } = cursor;
    if (key.upArrow || input === "w") y -= 1;
    else if (key.downArrow || input === "s") y += 1;
    else if (key.leftArrow || input === "a") x -= 1;
    else if (key.rightArrow || input === "d") x += 1;
    else return;
    if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return;
    if (!isWalkableCode(mask.tiles[y * mask.width + x])) {
      setStatusMsg(`blocked at (${x},${y})`);
      return;
    }
    setCursor({ x, y });
    setStatusMsg(null);
  });

  const termCols = stdout?.columns ?? 80;
  const termRows = stdout?.rows ?? 24;
  const viewW = Math.max(20, termCols - (inspectOpen ? 34 : 4));
  const viewH = Math.max(10, termRows - 11);

  const chunkSize = zoom === "closest" ? ROOM_CHUNK_SIZE : CHUNK_SIZE;
  const cx = Math.floor(cursor.x / chunkSize);
  const cy = Math.floor(cursor.y / chunkSize);
  const chunks = zoom === "far" ? embedded?.spatial.chunks : zoom === "closest" ? interior?.chunks : undefined;
  const placedChunk = chunks?.find((c) => c.cell.cx === cx && c.cell.cy === cy);
  const libChunk = placedChunk ? defaultChunkLibrary().byId.get(placedChunk.chunkId) : undefined;
  const node = placedChunk?.logicalNodeId
    ? tier.regions.flatMap((r) => r.nodes).find((n) => n.id === placedChunk.logicalNodeId)
    : undefined;

  return (
    <Box flexDirection="column">
      <Text>
        tier {tierIndex} · zoom <Text bold>{zoom}</Text>
        {zoom === "closest" ? ` · interior of ${effectiveNodeId}` : ""}
        {statusMsg ? `  — ${statusMsg}` : ""}
      </Text>
      {mode !== "normal" && (
        <Text color="cyan">
          {mode === "regenerate" ? "regenerate <seed> <tier>: " : "teleport <x,y | nodeId>: "}
          {promptText}
          <Text dimColor>_</Text>
        </Text>
      )}
      <Box>
        <Box flexDirection="column" marginTop={1}>
          {zoom === "medium" && (
            <Text color="yellow">
              medium (settlement) zoom has no chunk library yet — documented deferral, see CLAUDE.md. Proven scales:
              farthest, far, closest.
            </Text>
          )}
          {zoom === "farthest" && farthestTargets && (
            <Box flexDirection="column">
              <Text dimColor>=== tier {tierIndex} — abstract region graph, no terrain ===</Text>
              {farthestTargets.map((t) => (
                <Text key={t.regionId}>
                  {t.regionId} [{t.kernelId}] entry={t.entryNodeId} -&gt;{" "}
                  {t.links.map((l) => `${l.regionId} (${l.weightTicks}t)`).join(", ") || "(none)"}
                </Text>
              ))}
            </Box>
          )}
          {mask &&
            renderViewport(mask, cursor, viewW, viewH).map((row, i) => <Text key={i}>{row}</Text>)}
        </Box>
        {inspectOpen && (
          <Box flexDirection="column" borderStyle="single" marginLeft={2} paddingX={1} width={30}>
            <Text bold>inspect ({cursor.x},{cursor.y})</Text>
            <Text>cell: {cx},{cy}</Text>
            {placedChunk ? (
              <>
                <Text>chunk: {placedChunk.chunkId}</Text>
                <Text>biome: {libChunk?.biomeTag ?? "?"}</Text>
                <Text>backbone: {placedChunk.onBackbone ? "yes" : "no"}</Text>
                {node ? (
                  <>
                    <Text>node: {node.id}</Text>
                    <Text>kind: {node.kind}</Text>
                    <Text>name: {node.name}</Text>
                    <Text>quest-relevant: {node.canHostQuestNode ? "yes" : "no"}</Text>
                    <Text>boss: {node.isBoss ? "yes" : "no"}</Text>
                  </>
                ) : (
                  <Text dimColor>no logical node here</Text>
                )}
              </>
            ) : (
              <Text dimColor>no chunk data at this cell</Text>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
