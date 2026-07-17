#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { constructState } from "./state.js";
import { runDemoScenario } from "./demoScenario.js";
import { serializeLog, deserializeLog, replay, type Event } from "../log/index.js";

/**
 * Headless CLI for the engine — how every future gate gets exercised
 * without a UI. Phase 1 only wires generate/replay/diff against the
 * demo scenario; later phases point these at real game content.
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
  const state = constructState(parseSeed(seedArg), { tier: 1 }, { memberNames: [] });
  runDemoScenario(state);
  const json = serializeLog(state.log.toArray());
  if (outFile) {
    writeFileSync(outFile, json, "utf8");
    console.error(`wrote ${state.log.length} events to ${outFile}`);
  } else {
    console.log(json);
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
    default:
      console.error("usage: hollowmark-engine <generate|replay|diff> ...");
      process.exit(1);
  }
}

main();
