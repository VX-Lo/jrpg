export type EconomicAxis = "extractive" | "refining" | "mixed";

/**
 * An authored bundle that region generation *selects* rather than
 * invents — how generated variety gets authored structure. This phase
 * ships 3-4 fixtures (see kernels/); the full 15-25 kernel set is a
 * Phase 3 design pass.
 */
export interface RegionKernel {
  readonly id: string;
  readonly displayName: string;
  /** Word-fragments used to name things in this region — curated, never runtime-concatenated. */
  readonly lexiconRoots: readonly string[];
  /** 1-2 of `lexiconRoots` also present in an adjacent kernel, so regions bleed at their edges. */
  readonly boundaryRoots: readonly string[];
  /** Assigned here; Phase 6 writes the price math that consumes it. */
  readonly economicAxis: EconomicAxis;
  /** Tag only — Phase 8 consumes this to pick a lock mechanism. */
  readonly puzzleAffinity: string;
  /** Tags only — Phase 4 consumes these to pick eligible quest arcs. */
  readonly arcPool: readonly string[];
  /** Which chunk library this kernel's terrain draws from (Phase 4.5). */
  readonly biomeTag: string;
  /** Terrain palette for seam blending (Phase 4.5, Deliverable 4). */
  readonly blend: BlendDescriptor;
  readonly settlementNamePool: readonly string[];
  readonly npcNamePool: readonly string[];
  readonly factionNamePool: readonly string[];
  readonly landmarkNamePool: readonly string[];
}

/**
 * A kernel's terrain palette, added in Phase 4.5 for Deliverable 4.
 *
 * Deliberately a SMALL, SELF-CONTAINED descriptor rather than a set of
 * per-kernel-pair transition rules. Any two kernels blend by linear
 * interpolation between their own descriptors over a strip at their shared
 * corridor, so blending stays linear in kernel count. Authoring pairwise
 * transitions would be the N² trap this project already rejected once for
 * combo techs — with the eventual 15-25 kernels that would be 100-300
 * authored transitions nobody will ever keep consistent.
 */
export interface BlendDescriptor {
  /** Dominant ground texture id. Phase 10 maps these to actual visuals. */
  readonly dominantTexture: string;
  /** Secondary texture mixed in as the strip interpolates. */
  readonly accentTexture: string;
  /**
   * Coarse palette anchor, 0-1 along a cold→hot axis. Interpolated across a
   * blend strip. NOT a climate field — it is never used to DERIVE biome
   * identity (Phase 2 already assigned that discretely); it only says how
   * to shade the seam between two already-named territories.
   */
  readonly paletteAnchor: number;
}

export type NodeKind = "settlement" | "dungeonEntrance" | "landmark";

export interface WorldNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly name: string;
  /** Phase 4 needs to know where quests *could* go; Phase 2 builds no quests. */
  readonly canHostQuestNode: boolean;
  readonly isBoss: boolean;
}

export interface WorldEdge {
  readonly from: string;
  readonly to: string;
  /** Travel time in ticks. */
  readonly weightTicks: number;
}

export interface DungeonCluster {
  readonly id: string;
  readonly parentNodeId: string;
  readonly nodes: readonly WorldNode[];
  readonly edges: readonly WorldEdge[];
  readonly entryNodeId: string;
}

/**
 * A reputation scalar. Not a polity: no territory, no diplomacy, no
 * simulation. Just a name, a home region, and a number that will later
 * go up and down (Phase 7).
 */
export interface Faction {
  readonly id: string;
  readonly name: string;
  readonly homeRegionId: string;
  readonly reputation: number;
}

/** A generated individual — a person who happens to have a job, not a class with a name attached. */
export interface Npc {
  readonly id: string;
  readonly name: string;
  readonly originRegionId: string;
  readonly trait: string;
  readonly job: string;
}

export interface Region {
  readonly id: string;
  readonly kernelId: string;
  readonly economicAxis: EconomicAxis;
  readonly nodeBudget: number;
  readonly entryNodeId: string;
  readonly nodes: readonly WorldNode[];
  readonly edges: readonly WorldEdge[];
  readonly dungeonClusters: readonly DungeonCluster[];
  readonly factions: readonly Faction[];
  readonly npcs: readonly Npc[];
}

/**
 * An edge in the tier's region-adjacency graph. Structurally identical to
 * `WorldEdge` but deliberately a distinct type: `from`/`to` are REGION ids,
 * not node ids, and confusing the two would silently produce a graph that
 * validates but means nothing.
 *
 * This is the authoritative source of inter-region passability. Phase 4.5's
 * spatial layer READS it (a region pair with an edge gets a physical
 * corridor carved at their shared blob border; a pair without one stays
 * sealed, geometric adjacency notwithstanding) and never writes it.
 */
export interface RegionEdge {
  readonly from: string;
  readonly to: string;
  /** Travel time in ticks. Drawn from the wider inter-region range — see config. */
  readonly weightTicks: number;
}

/** Reference only — Phase 5 implements the mechanical guts behind an archetype ID. */
export interface ThreatArchetypeRef {
  readonly archetypeId: string;
}

export interface Tier {
  readonly tierIndex: number;
  readonly seed: bigint;
  readonly shape: readonly number[];
  readonly band: number;
  readonly regions: readonly Region[];
  /** Region-adjacency graph: connected by construction (spanning tree + extras). */
  readonly regionEdges: readonly RegionEdge[];
  readonly bossNodeId: string;
  readonly bossRegionId: string;
  readonly bossThreatArchetype: ThreatArchetypeRef;
}
