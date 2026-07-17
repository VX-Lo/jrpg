import { MASK64, deriveSeed } from "./fnv1a.js";

const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n;
const MIX_MULT_1 = 0xbf58476d1ce4e5b9n;
const MIX_MULT_2 = 0x94d049bb133111ebn;

/**
 * SplitMix64: a fast, deterministic, integer-only PRNG.
 *
 * `seed` is the value this stream was constructed from — it is preserved
 * separately from the mutable advancing `state`, because `substream(key)`
 * must derive from *this stream's own seed*, not from wherever its cursor
 * happens to be after N calls to next*(). That's what makes substreams
 * independent of call order and call count.
 */
export class Rng {
  readonly seed: bigint;
  private state: bigint;

  constructor(seed: bigint) {
    this.seed = seed & MASK64;
    this.state = this.seed;
  }

  /** Next raw 64-bit unsigned integer. */
  nextUint64(): bigint {
    this.state = (this.state + GOLDEN_GAMMA) & MASK64;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * MIX_MULT_1) & MASK64;
    z = ((z ^ (z >> 27n)) * MIX_MULT_2) & MASK64;
    z = z ^ (z >> 31n);
    return z & MASK64;
  }

  /** Next 32-bit unsigned integer (top bits of a 64-bit draw). */
  nextUint32(): number {
    return Number(this.nextUint64() >> 32n);
  }

  /**
   * Next float in [0, 1). Derived from the top 53 bits of a 64-bit draw
   * divided by 2^53 — a fixed, documented, integer-based method so this
   * is identical across platforms (no reliance on float parsing quirks).
   */
  nextFloat(): number {
    const bits = this.nextUint64() >> 11n; // top 53 bits
    return Number(bits) / 9007199254740992; // 2^53
  }

  /**
   * Next unbiased integer in [0, bound). Uses rejection sampling against
   * 2^64 so the result is uniform even when `bound` doesn't divide 2^64 —
   * still fully deterministic, it just consumes a variable (but seed-
   * determined) number of draws from this stream.
   */
  nextInt(bound: number): number {
    if (!Number.isInteger(bound) || bound <= 0) {
      throw new Error(`nextInt bound must be a positive integer, got ${bound}`);
    }
    const boundBig = BigInt(bound);
    const limit = MASK64 + 1n; // 2^64
    const threshold = limit - (limit % boundBig);
    let r: bigint;
    do {
      r = this.nextUint64();
    } while (r >= threshold);
    return Number(r % boundBig);
  }

  /**
   * Derives an independent child stream from a namespaced key. Key-hashed,
   * NOT sequentially split: the child's seed depends only on this stream's
   * own seed and the key string, never on how many times next*() was
   * called or in what order sibling substreams were created. See Gate 2
   * and the substream key convention in CLAUDE.md.
   */
  substream(key: string): Rng {
    return new Rng(deriveSeed(this.seed, key));
  }
}

/** Root constructor. `seed` may be a bigint, a number, or a string (hashed via FNV-1a). */
export function createRng(seed: bigint | number | string): Rng {
  if (typeof seed === "bigint") return new Rng(seed);
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) throw new Error(`numeric seed must be an integer, got ${seed}`);
    return new Rng(BigInt(seed) & MASK64);
  }
  return new Rng(deriveSeed(0n, seed));
}
