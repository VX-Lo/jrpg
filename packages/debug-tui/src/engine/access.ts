// ---------------------------------------------------------------------
// The only place debug-tui touches packages/engine. Everything here is a
// thin pass-through to real engine functions — no reimplementation of
// worldgen/spatial/battle logic lives in this file or anywhere else in
// this package (see CLAUDE.md "Debug tooling"). Imports go straight at
// engine's src modules (the same pattern engine's own CLI uses) since
// packages/engine's package.json has no usable entry point today —
// this is a read of engine's public module surface, not a reach into
// private internals.
// ---------------------------------------------------------------------

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContentFromDir, type ContentPort } from "../../../engine/src/content/loader.js";
import { worldgen } from "../../../engine/src/worldgen/worldgen.js";
import { embedTier } from "../../../engine/src/spatial/embed.js";
import { embedInterior } from "../../../engine/src/spatial/interior.js";
import { farthestZoomView } from "../../../engine/src/spatial/zoom.js";
import { defaultChunkLibrary } from "../../../engine/src/spatial/chunks/defaultLibrary.js";
import { createRng } from "../../../engine/src/rng/index.js";
import { CHUNK_SIZE, ROOM_CHUNK_SIZE, EQUIP_CAP, BASE_ACTION_TICKS } from "../../../engine/src/worldgen/config.js";
import { runBattle, AwaitingPartyInputError } from "../../../engine/src/battle/resolver.js";
import { eligibleTargets } from "../../../engine/src/battle/rows.js";
import { remainingTurnsForStatus } from "../../../engine/src/battle/status.js";
import { resolvedActionCost } from "../../../engine/src/battle/clock.js";
import { isBroken } from "../../../engine/src/battle/breakBoost.js";
import { EventLogWriter } from "../../../engine/src/log/writer.js";

export {
  loadContentFromDir,
  worldgen,
  embedTier,
  embedInterior,
  farthestZoomView,
  defaultChunkLibrary,
  createRng,
  CHUNK_SIZE,
  ROOM_CHUNK_SIZE,
  EQUIP_CAP,
  BASE_ACTION_TICKS,
  runBattle,
  AwaitingPartyInputError,
  eligibleTargets,
  remainingTurnsForStatus,
  resolvedActionCost,
  isBroken,
  EventLogWriter,
};
export type { Event } from "../../../engine/src/log/types.js";
export type {
  BattleRequest,
  BattleInput,
  AbilityInput,
  DefendInput,
  ScanInput,
  BattleResult,
  PartyMemberRequest,
  EnemyCombatantRequest,
  LiveCombatant,
} from "../../../engine/src/battle/types.js";
export type { BattleContext } from "../../../engine/src/battle/resolver.js";
export type { Ability } from "../../../engine/src/content/types.js";
export type { ContentPort };
export type { Tier, WorldNode, Region, RegionEdge } from "../../../engine/src/worldgen/types.js";
export type {
  EmbeddedTier,
  SpatialTier,
  ZoomScale,
  TileMask,
  PlacedChunk,
  NodePlacement,
  ChunkLibrary,
  Chunk,
} from "../../../engine/src/spatial/types.js";
export type { InteriorSpace } from "../../../engine/src/spatial/interior.js";
export type { FarthestZoomTarget } from "../../../engine/src/spatial/zoom.js";
export { TILE_CODE, isWalkableCode } from "../../../engine/src/spatial/types.js";
export type { Rng } from "../../../engine/src/rng/index.js";

const ENGINE_CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "engine", "content");

let cachedContent: ContentPort | null = null;

/** The real, on-disk content — same directory the engine's own CLI/tests load. Memoized. */
export function loadEngineContent(): ContentPort {
  if (!cachedContent) cachedContent = loadContentFromDir(ENGINE_CONTENT_DIR);
  return cachedContent;
}

export function parseSeed(raw: string): bigint | string {
  return /^-?\d+$/.test(raw) ? BigInt(raw) : raw;
}

/**
 * Root RNG for one debug-tui session, keyed off whatever seed the user
 * typed in. Substream everything under "debug-tui:" so a debug-only roll
 * (encounter pick, gear roll) can never collide with a real engine
 * substream key (CLAUDE.md invariant #2 — key granularity matters, and
 * this tool is not exempt from using substreams correctly even though
 * none of its own draws are ever logged to a real save).
 */
export function debugRootRng(seed: bigint | number | string) {
  return createRng(seed).substream("debug-tui");
}
