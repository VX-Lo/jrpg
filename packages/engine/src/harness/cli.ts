#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { constructState } from "./state.js";
import { prettyPrintTier } from "./prettyPrintTier.js";
import { worldgen } from "../worldgen/worldgen.js";
import { serializeTier } from "../worldgen/serialize.js";
import { serializeLog, deserializeLog, replay, type Event } from "../log/index.js";

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
    default:
      console.error("usage: hollowmark-engine <generate|replay|diff|gen> ...");
      process.exit(1);
  }
}

main();
