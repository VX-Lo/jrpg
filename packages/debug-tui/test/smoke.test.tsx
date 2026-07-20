// ---------------------------------------------------------------------
// Sanity check, not a determinism proof (CLAUDE.md "Debug tooling" §4):
// the app mounts, tab switches don't crash, and a keypress visibly
// changes state on the Map and Battle tabs. The real gate is Lo playing
// with it.
// ---------------------------------------------------------------------

import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../src/App.js";

const UP = "[A";
const DOWN = "[B";
const LEFT = "[D";
const RIGHT = "[C";
const RETURN = "\r";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// useInput subscribes via an effect that runs after mount — give it a tick
// before the first keypress, same as a real terminal's first frame.
const SETTLE = 50;

describe("debug-tui smoke", () => {
  it("mounts without throwing", async () => {
    const { lastFrame, unmount } = render(<App />);
    await delay(SETTLE);
    expect(lastFrame()).toBeTruthy();
    expect(lastFrame()).toContain("Map");
    unmount();
  });

  it("switches tabs without crashing", async () => {
    const { lastFrame, stdin, unmount } = render(<App />);
    await delay(SETTLE);
    stdin.write("2");
    await delay(SETTLE);
    expect(lastFrame()).toContain("[Content]");
    stdin.write("3");
    await delay(SETTLE);
    expect(lastFrame()).toContain("[Battle]");
    stdin.write("1");
    await delay(SETTLE);
    expect(lastFrame()).toContain("[Map]");
    unmount();
  });

  it("Map tab: a keypress changes displayed state", async () => {
    const { lastFrame, stdin, unmount } = render(<App />);
    await delay(SETTLE);
    const before = lastFrame();
    // The starting tile's open directions depend on terrain layout, so try
    // every direction (and both key styles) rather than assume one is
    // walkable from wherever findFirstWalkable happened to land.
    let changed = false;
    for (const dir of [UP, DOWN, LEFT, RIGHT, "w", "s", "a", "d"]) {
      stdin.write(dir);
      await delay(SETTLE);
      if (lastFrame() !== before) {
        changed = true;
        break;
      }
    }
    expect(changed).toBe(true);
    unmount();
  });

  it("Battle tab: a keypress resolves an action (log panel gains an entry)", async () => {
    const { lastFrame, stdin, unmount } = render(<App />);
    await delay(SETTLE);
    stdin.write("3");
    await delay(SETTLE);
    const beforeLog = lastFrame();
    expect(beforeLog).toContain("turn");
    stdin.write(RETURN); // pick first ability-menu entry (opens target picker or self-commits)
    await delay(SETTLE);
    stdin.write(RETURN); // confirm target if one was needed
    await delay(SETTLE);
    const afterLog = lastFrame();
    expect(afterLog).not.toBe(beforeLog);
    unmount();
  });
});
