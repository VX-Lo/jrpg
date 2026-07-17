import { describe, expect, it } from "vitest";
import { createRng, deriveSeed, fnv1a64 } from "../src/rng/index.js";

describe("Rng (SplitMix64)", () => {
  it("is deterministic: same seed produces the same sequence", () => {
    const a = createRng(42n);
    const b = createRng(42n);
    const seqA = Array.from({ length: 10 }, () => a.nextUint64());
    const seqB = Array.from({ length: 10 }, () => b.nextUint64());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds produce different sequences", () => {
    const a = createRng(1n).nextUint64();
    const b = createRng(2n).nextUint64();
    expect(a).not.toEqual(b);
  });

  it("nextFloat stays within [0, 1)", () => {
    const rng = createRng(7n);
    for (let i = 0; i < 1000; i++) {
      const f = rng.nextFloat();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it("nextInt stays within [0, bound) and is deterministic", () => {
    const a = createRng(9n);
    const b = createRng(9n);
    for (let i = 0; i < 500; i++) {
      const x = a.nextInt(37);
      const y = b.nextInt(37);
      expect(x).toBe(y);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(37);
    }
  });

  it("accepts bigint, number, and string seeds", () => {
    expect(() => createRng(5n)).not.toThrow();
    expect(() => createRng(5)).not.toThrow();
    expect(() => createRng("hollowmark")).not.toThrow();
    // string seeds are hashed, not coerced numerically
    expect(createRng("hollowmark").seed).not.toBe(createRng("0").seed);
  });

  it("deriveSeed / fnv1a64 are pure and deterministic", () => {
    const bytes = new TextEncoder().encode("worldgen:tier:5:regions");
    expect(fnv1a64(bytes)).toBe(fnv1a64(bytes));
    expect(deriveSeed(1n, "a")).toBe(deriveSeed(1n, "a"));
    expect(deriveSeed(1n, "a")).not.toBe(deriveSeed(1n, "b"));
    expect(deriveSeed(1n, "a")).not.toBe(deriveSeed(2n, "a"));
  });

  it("substream is independent of the parent's mutable draw cursor", () => {
    const a = createRng(100n);
    const subFresh = a.substream("k");

    const b = createRng(100n);
    b.nextUint64();
    b.nextUint64();
    b.nextUint64();
    const subAfterDraws = b.substream("k");

    expect(subFresh.nextUint64()).toBe(subAfterDraws.nextUint64());
  });
});
