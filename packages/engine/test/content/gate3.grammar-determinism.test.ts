import { describe, expect, it } from "vitest";
import { createRng } from "../../src/rng/index.js";
import { expandGrammar, pickFromPool } from "../../src/content/grammar/engine.js";
import { loadContentFromDir } from "../../src/content/loader.js";
import { CONTENT_DIR } from "./contentDir.js";

// Gate 3 — grammar determinism. A grammar expanded from a given
// substream key produces identical output across runs. Same seed = same
// name, same flavor text. Byte-identical.

const content = loadContentFromDir(CONTENT_DIR);

describe("Gate 3 — grammar determinism", () => {
  it("expanding the same grammar from the same substream key is byte-identical across independent runs", () => {
    const grammar = content.getGrammar("grammar:fen:flavor");

    for (const seed of [1n, 42n, 999n]) {
      const rootA = createRng(seed);
      const rngA = rootA.substream(`grammar:${grammar.id}:test-context`);
      const outputA = expandGrammar(grammar, "origin", rngA);

      const rootB = createRng(seed);
      const rngB = rootB.substream(`grammar:${grammar.id}:test-context`);
      const outputB = expandGrammar(grammar, "origin", rngB);

      expect(outputB).toBe(outputA);
    }
  });

  it("different substream keys (a different context) can diverge", () => {
    const grammar = content.getGrammar("grammar:fen:flavor");
    const root = createRng(7n);
    const outputs = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const rng = root.substream(`grammar:${grammar.id}:context-${i}`);
      outputs.add(expandGrammar(grammar, "origin", rng));
    }
    // Not every context need produce a unique string, but with 10 draws
    // over a nontrivial grammar we should see more than one distinct result.
    expect(outputs.size).toBeGreaterThan(1);
  });

  it("kernel-aware expansion (#kernelRoot#) is itself deterministic per substream key", () => {
    const grammar = content.getGrammar("grammar:cinderreach:flavor");
    const seed = 12345n;
    const a = expandGrammar(grammar, "origin", createRng(seed).substream("grammar:test:a"));
    const b = expandGrammar(grammar, "origin", createRng(seed).substream("grammar:test:a"));
    expect(b).toBe(a);
  });

  it("pickFromPool (the curated-pool /names consumer) is deterministic per substream key", () => {
    const pool = ["Saltmere", "Weirhaven", "Tideford", "Marshgate"];
    const seed = 55n;
    const a = pickFromPool(pool, createRng(seed).substream("names:fen:settlement"));
    const b = pickFromPool(pool, createRng(seed).substream("names:fen:settlement"));
    expect(b).toBe(a);
  });

  it("the commodity grammar (the deliberate concatenation exception) is deterministic too", () => {
    const grammar = content.getGrammar("grammar:commodity:demo");
    const seed = 8080n;
    const a = expandGrammar(grammar, "origin", createRng(seed).substream("grammar:test:commodity"));
    const b = expandGrammar(grammar, "origin", createRng(seed).substream("grammar:test:commodity"));
    expect(b).toBe(a);
  });
});
