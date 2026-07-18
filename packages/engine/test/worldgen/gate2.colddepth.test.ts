import { describe, expect, it } from "vitest";
import { worldgen } from "../../src/worldgen/worldgen.js";
import { serializeTier } from "../../src/worldgen/serialize.js";
import { band } from "../../src/worldgen/band.js";
import { NODES_PER_TIER } from "../../src/worldgen/config.js";

// Gate 2 — THE COLD-DEPTH TEST (the signature gate of Phase 2). See
// CLAUDE.md. worldgen(seed, tierIndex) must be able to produce tier 40
// directly, with zero simulated play, and the result must not depend on
// whatever *other* tiers happened to be generated before it. If this is
// hard to write, the fence — no party/run-state parameter in worldgen's
// signature — is already broken.

const SEED = 987654321n;

describe("Gate 2 — cold-depth test", () => {
  it("tier 40 generates directly, with no simulated play, and is structurally valid", () => {
    const tier = worldgen(SEED, 40);

    expect(tier.tierIndex).toBe(40);
    expect(tier.band).toBe(band(40));

    const totalNodes = tier.regions.reduce((sum, r) => sum + r.nodes.length, 0);
    expect(totalNodes).toBe(NODES_PER_TIER);

    const bossNodes = tier.regions.flatMap((r) => r.nodes.filter((n) => n.isBoss));
    expect(bossNodes.length).toBe(1);
    expect(tier.bossNodeId).toBe(bossNodes[0].id);
  });

  it("generating tier 40 after generating unrelated tiers first is byte-identical to generating it cold", () => {
    const direct = worldgen(SEED, 40);

    // Genuinely generate a handful of unrelated tiers first — real calls
    // through the same worldgen() entry point, not a simulation of them.
    for (const n of [1, 2, 3, 7, 15, 22, 39]) {
      worldgen(SEED, n);
    }
    const afterOthers = worldgen(SEED, 40);

    expect(serializeTier(afterOthers)).toBe(serializeTier(direct));
  });

  it("worldgen's signature is exactly (seed, tierIndex) — arity tripwire against a future party/run-state param", () => {
    expect(worldgen.length).toBe(2);
  });

  it("different seeds produce different tier 40s", () => {
    const a = worldgen(SEED, 40);
    const b = worldgen(SEED + 1n, 40);
    expect(serializeTier(a)).not.toBe(serializeTier(b));
  });
});
