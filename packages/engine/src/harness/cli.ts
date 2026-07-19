#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { constructState } from "./state.js";
import { prettyPrintTier } from "./prettyPrintTier.js";
import { prettyPrintQuestGraph, prettyPrintSolverResults, prettyPrintArcs } from "./prettyPrintQuestGraph.js";
import { embedTier } from "../spatial/embed.js";
import { farthestZoomView } from "../spatial/zoom.js";
import type { ZoomScale } from "../spatial/types.js";
import { prettyPrintCoarse, prettyPrintTiles, prettyPrintInterior } from "./prettyPrintSpatial.js";
import { embedInterior } from "../spatial/interior.js";
import { worldgen } from "../worldgen/worldgen.js";
import { serializeTier } from "../worldgen/serialize.js";
import { serializeLog, deserializeLog, replay, EventLogWriter, type Event } from "../log/index.js";
import { loadContentFromDir } from "../content/loader.js";
import { buildTierQuestGraph } from "../questgraph/questgraph.js";
import { serializeQuestGraph } from "../questgraph/serialize.js";
import { solveA } from "../questgraph/solverA.js";
import { solveB } from "../questgraph/solverB.js";
import { buildTierArcs } from "../questgraph/arcs/tierArcs.js";

/**
 * Headless CLI for the engine — how every future gate gets exercised
 * without a UI, and (via `gen --print`) how the Gate 6 human spot-check
 * and all future balance work actually get done, since runs are too
 * long to play to deep tiers.
 */

function parseSeed(raw: string): bigint | string {
  return /^-?\d+$/.test(raw) ? BigInt(raw) : raw;
}

function cmdGenerate(args: string[]): void {
  const [seedArg, outFile] = args;
  if (!seedArg) {
    console.error("usage: generate <seed> [outFile]");
    process.exit(1);
  }
  // Builds real game state (worldgen-backed tier 1) and logs a couple of
  // named-substream draws, to exercise the log pipeline headlessly.
  const state = constructState(parseSeed(seedArg), { tierIndex: 1 }, { memberNames: [] });
  const rng = state.rng.substream("cli:generate:demo-rolls");
  for (let i = 0; i < 10; i++) {
    state.tick += 1;
    state.log.append(state.tick, "cli:roll", { value: rng.nextUint64().toString() });
  }
  const json = serializeLog(state.log.toArray());
  if (outFile) {
    writeFileSync(outFile, json, "utf8");
    console.error(`wrote ${state.log.length} events to ${outFile}`);
  } else {
    console.log(json);
  }
}

function parseFlags(args: string[]): Record<string, string | true> {
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function cmdGen(args: string[]): void {
  const flags = parseFlags(args);
  const seedArg = flags.seed;
  const tierArg = flags.tier;
  if (typeof seedArg !== "string" || typeof tierArg !== "string") {
    console.error("usage: gen --seed <seed> --tier <n> [--print]");
    process.exit(1);
  }
  const tierIndex = Number(tierArg);
  if (!Number.isInteger(tierIndex) || tierIndex < 1) {
    console.error(`--tier must be a positive integer, got "${tierArg}"`);
    process.exit(1);
  }
  const tier = worldgen(parseSeed(seedArg), tierIndex);
  if (flags.print) {
    console.log(prettyPrintTier(tier));
  } else {
    console.log(serializeTier(tier));
  }
}

const DEFAULT_CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "content");

function cmdQuest(args: string[]): void {
  const flags = parseFlags(args);
  const seedArg = flags.seed;
  const tierArg = flags.tier;
  if (typeof seedArg !== "string" || typeof tierArg !== "string") {
    console.error("usage: quest --seed <seed> --tier <n> [--print] [--content <dir>]");
    process.exit(1);
  }
  const tierIndex = Number(tierArg);
  if (!Number.isInteger(tierIndex) || tierIndex < 1) {
    console.error(`--tier must be a positive integer, got "${tierArg}"`);
    process.exit(1);
  }
  const contentDir = typeof flags.content === "string" ? flags.content : DEFAULT_CONTENT_DIR;

  const content = loadContentFromDir(contentDir);
  const tier = worldgen(parseSeed(seedArg), tierIndex);
  const graph = buildTierQuestGraph(tier, content);
  const resultA = solveA(tier, graph);
  const resultB = solveB(tier, graph);
  const log = new EventLogWriter();
  const arcs = buildTierArcs(tier, log, 0);

  if (flags.print) {
    console.log(prettyPrintQuestGraph(graph));
    console.log(prettyPrintSolverResults(resultA, resultB));
    console.log("");
    console.log(prettyPrintArcs(arcs));
  } else {
    console.log(
      JSON.stringify({
        questGraph: JSON.parse(serializeQuestGraph(graph)),
        solverA: resultA,
        solverB: resultB,
        arcs,
      }),
    );
  }
}

function cmdReplay(args: string[]): void {
  const [logFile] = args;
  if (!logFile) {
    console.error("usage: replay <logFile>");
    process.exit(1);
  }
  const events = deserializeLog(readFileSync(logFile, "utf8"));
  const summary = replay(
    { eventCount: 0, lastTick: 0 },
    events,
    (state: { eventCount: number; lastTick: number }, event: Event) => ({
      eventCount: state.eventCount + 1,
      lastTick: event.tick,
    }),
  );
  console.log(JSON.stringify(summary));
}

function cmdDiff(args: string[]): void {
  const [fileA, fileB] = args;
  if (!fileA || !fileB) {
    console.error("usage: diff <logFileA> <logFileB>");
    process.exit(1);
  }
  const a = readFileSync(fileA, "utf8");
  const b = readFileSync(fileB, "utf8");
  if (a === b) {
    console.log("IDENTICAL");
    process.exit(0);
  }
  let firstDiff = 0;
  while (firstDiff < a.length && firstDiff < b.length && a[firstDiff] === b[firstDiff]) {
    firstDiff++;
  }
  console.error(`DIFFERS at byte offset ${firstDiff}`);
  process.exit(1);
}


/**
 * Deliverable 8 — `embed --seed X --tier N [--tiles] [--zoom far]`.
 *
 * The spatial equivalent of `gen --print`, and the tool all spatial
 * balance work goes through: runs are far too long to walk to deep tiers
 * by hand, so terrain at depth is only ever inspected this way. Also how
 * Gate 8's human spot-check is performed.
 */
function cmdEmbed(args: string[]): void {
  const flags = parseFlags(args);
  const seedArg = flags.seed;
  const tierArg = flags.tier;
  if (typeof seedArg !== "string" || typeof tierArg !== "string") {
    console.error("usage: embed --seed <seed> --tier <n> [--tiles] [--zoom farthest|far|closest] [--node <id>]");
    process.exit(1);
  }
  const tierIndex = Number(tierArg);
  if (!Number.isInteger(tierIndex) || tierIndex < 1) {
    console.error(`--tier must be a positive integer, got "${tierArg}"`);
    process.exit(1);
  }

  const embedded = embedTier(parseSeed(seedArg), tierIndex);
  const zoom = (typeof flags.zoom === "string" ? flags.zoom : "far") as ZoomScale;

  if (zoom === "farthest") {
    // No terrain to dump — the farthest zoom IS the logical region graph.
    console.log(`=== TIER ${tierIndex} — farthest zoom (abstract region graph, no terrain) ===`);
    for (const target of farthestZoomView(embedded.tier)) {
      const links = target.links.map((l) => `${l.regionId} (${l.weightTicks}t)`).join(", ") || "(none)";
      console.log(`  ${target.regionId} [${target.kernelId}] entry=${target.entryNodeId} -> ${links}`);
    }
    return;
  }

  if (zoom === "closest") {
    // The closest zoom is a genuinely different space, not a caption on the
    // far-zoom map: pick the node (default: the tier's exit/boss) and build
    // its interior with the room-scale library.
    const nodeId = typeof flags.node === "string" ? flags.node : embedded.spatial.exitNodeId;
    const node = embedded.tier.regions.flatMap((r) => r.nodes).find((n) => n.id === nodeId);
    if (!node) {
      console.error(`--node "${nodeId}" is not a logical node in tier ${tierIndex}`);
      process.exit(1);
    }
    console.log(prettyPrintInterior(embedInterior(parseSeed(seedArg), tierIndex, node.id), node.name));
    return;
  }

  if (zoom === "medium") {
    // Stated plainly rather than silently falling back to far-zoom terrain.
    console.error(
      "medium zoom has no chunk library yet (documented deferral — see CLAUDE.md). " +
        "Proven scales today: farthest, far, closest.",
    );
    process.exit(1);
  }

  console.log(prettyPrintCoarse(embedded));
  if (flags.tiles === true || typeof flags.tiles === "string") {
    console.log("");
    console.log(prettyPrintTiles(embedded));
  }
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "generate":
      return cmdGenerate(rest);
    case "replay":
      return cmdReplay(rest);
    case "diff":
      return cmdDiff(rest);
    case "gen":
      return cmdGen(rest);
    case "quest":
      return cmdQuest(rest);
    case "embed":
      return cmdEmbed(rest);
    default:
      console.error("usage: hollowmark-engine <generate|replay|diff|gen|quest|embed> ...");
      process.exit(1);
  }
}

main();
