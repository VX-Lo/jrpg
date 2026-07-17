import { describe, expect, it } from "vitest";
import { createRng } from "../src/rng/index.js";

// Gate 2 — THE PERTURBATION TEST (see CLAUDE.md).
//
// This is the single most important test in the project. It proves
// substreams are derived by key-hashing, not by sequential splitting.
// If this test ever fails, adding any new feature to the game will
// silently reshuffle every existing player's save file.

const SEED = 123456789n;

function draw(rng: ReturnType<typeof createRng>, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(rng.nextUint64().toString());
  return out;
}

function runConsumers(keys: string[]): Record<string, string[]> {
  const root = createRng(SEED);
  const results: Record<string, string[]> = {};
  for (const key of keys) {
    results[key] = draw(root.substream(key), 25);
  }
  return results;
}

describe("Gate 2 — perturbation test", () => {
  it("adding a new substream consumer does not perturb any existing consumer's output", () => {
    const originalKeys = [
      "worldgen:tier:5:regions",
      "worldgen:tier:5:factions",
      "combat:encounter:3:initiative",
      "echo:roll:7:outcome",
    ];

    const before = runConsumers(originalKeys);

    // Genuinely add a new consumer with a brand-new key — not a simulation.
    // Insert it in the middle of the list to also prove that *position*
    // in the calling code doesn't matter, only the key string does.
    const perturbedKeys = [
      originalKeys[0],
      originalKeys[1],
      "worldgen:tier:5:weather",
      originalKeys[2],
      originalKeys[3],
    ];

    const after = runConsumers(perturbedKeys);

    for (const key of originalKeys) {
      expect(after[key]).toEqual(before[key]);
    }
  });

  it("the new consumer's stream is itself independent, not a coincidental echo", () => {
    const originalKeys = ["worldgen:tier:5:regions", "worldgen:tier:5:factions"];
    const before = runConsumers(originalKeys);
    const after = runConsumers([...originalKeys, "worldgen:tier:5:weather"]);

    for (const key of originalKeys) {
      expect(after["worldgen:tier:5:weather"]).not.toEqual(before[key]);
    }
  });

  it("substream results do not depend on creation order (key-hashed, not sequential split)", () => {
    const keys = ["alpha:1:x", "beta:2:y", "gamma:3:z"];
    const forward = runConsumers(keys);
    const backward = runConsumers([...keys].reverse());

    for (const key of keys) {
      expect(backward[key]).toEqual(forward[key]);
    }
  });

  it("two different keys never produce the same stream (basic independence sanity check)", () => {
    const results = runConsumers(["domain:a", "domain:b", "domain:c"]);
    const [a, b, c] = [results["domain:a"], results["domain:b"], results["domain:c"]];
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(c);
    expect(a).not.toEqual(c);
  });
});
