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
  readonly settlementNamePool: readonly string[];
  readonly npcNamePool: readonly string[];
  readonly factionNamePool: readonly string[];
  readonly landmarkNamePool: readonly string[];
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
  readonly bossNodeId: string;
  readonly bossRegionId: string;
  readonly bossThreatArchetype: ThreatArchetypeRef;
}
