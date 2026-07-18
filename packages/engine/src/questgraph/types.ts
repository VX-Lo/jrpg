import type { AbilityId, ThreatArchetypeId } from "../content/types.js";

// ---------------------------------------------------------------------
// Deliverable 1 — the hint vocabulary. Structured, machine-checkable
// propositions Solver A reasons over. Flavor text is a rendering of a
// Hint; the Hint itself is this data. Kept small on purpose — a
// specificity level is not a new hint type.
// ---------------------------------------------------------------------

export type ItemId = string;

/** Narrows the item's location to a candidate set of regions — not always to exactly one, even at high specificity (see questgraph/hints.ts). */
export interface LocationHintFact {
  readonly kind: "location";
  readonly item: ItemId;
  readonly candidateRegions: readonly string[];
}

/** Rules a region OUT. Elimination is a legitimate deduction and a cheap way to narrow a set without ever pointing straight at the answer. Never excludes the item's true region — see questgraph/hints.ts. */
export interface ExclusionHintFact {
  readonly kind: "exclusion";
  readonly item: ItemId;
  readonly region: string;
}

/** "The Key needs the Rod and the Orb" — reveals a compound (AND) lock requirement ahead of encountering the lock itself. */
export interface DependencyHintFact {
  readonly kind: "dependency";
  readonly result: ItemId;
  readonly requires: readonly ItemId[];
}

/** "Near the Weir" — node-level, regardless of specificity (see questgraph/hints.ts). */
export interface ProximityHintFact {
  readonly kind: "proximity";
  readonly item: ItemId;
  readonly landmark: string; // NodeId
}

export type Fact = LocationHintFact | ExclusionHintFact | DependencyHintFact | ProximityHintFact;

export type Specificity = "vague" | "medium" | "precise";

export interface Hint {
  readonly id: string;
  readonly targetFact: Fact;
  readonly specificity: Specificity;
  /** Solver A only "knows" this hint after visiting this node — no god-vision. */
  readonly sourceNodeId: string;
}

// ---------------------------------------------------------------------
// Deliverable 2 — the DAG itself. A QuestFact is a prerequisite the
// generator placed somewhere already-reachable; a QuestLock gates a
// node behind one or more QuestFacts (AND). See CLAUDE.md's Phase 4
// architecture section for how "reachable" is defined here: locks gate
// a node's USABILITY (item pickup / trainer / capture / boss
// encounter), never physical traversal — Phase 2's region graphs are
// already guaranteed fully connected, so there is nothing to gate
// geometrically without graph-cut analysis this phase doesn't need.
// ---------------------------------------------------------------------

export type PrerequisiteKind = "item" | "skill" | "eliteCapture";

interface QuestFactBase {
  readonly id: string;
  readonly regionId: string;
  /** 1 node normally, 2 when multi-path redundancy fires (Deliverable 2). Any one of these nodes independently provides the fact. */
  readonly placementNodeIds: readonly string[];
  /** The gate-sequence step (0-indexed) this fact was generated to satisfy — used by hint emission to rank "how close to needed" a candidate hint-source node is. */
  readonly gateStep: number;
}

export interface ItemFact extends QuestFactBase {
  readonly kind: "item";
  readonly itemId: ItemId;
}

export interface SkillFact extends QuestFactBase {
  readonly kind: "skill";
  readonly abilityId: AbilityId;
}

export interface EliteCaptureFact extends QuestFactBase {
  readonly kind: "eliteCapture";
  readonly threatArchetypeId: ThreatArchetypeId;
}

export type QuestFact = ItemFact | SkillFact | EliteCaptureFact;

export interface QuestLock {
  readonly id: string;
  readonly lockedNodeId: string;
  /** AND — every fact here must be acquired before this lock is satisfied. 1 normally, 2 when a compound lock fires (Deliverable 2). */
  readonly requiredFactIds: readonly string[];
  readonly integrity: number;
}

/**
 * Skill trainers and elite-capture markers are placed via the same
 * reachable-pool mechanism as item facts (Deliverable 8), but they
 * never gate anything — they're optional leaf content, not golden-path
 * prerequisites, so they aren't QuestFacts feeding a QuestLock.
 */
export interface SkillTrainerPlacement {
  readonly id: string;
  readonly nodeId: string;
  readonly abilityId: AbilityId;
}

/**
 * Which Huntable ability this yields is explicitly NOT resolved here —
 * that's late-bound at capture time (run-state, party-aware), Phase 5/7
 * territory. This is an unresolved reference, on purpose.
 */
export interface EliteCaptureYield {
  readonly resolved: false;
}

export interface EliteCapturePlacement {
  readonly id: string;
  readonly nodeId: string;
  readonly threatArchetypeId: ThreatArchetypeId;
  readonly yield: EliteCaptureYield;
}

export interface RegionQuestGraph {
  readonly regionId: string;
  readonly facts: readonly QuestFact[];
  /** Ordered gate sequence — locks[0] is the first gate a player would satisfy, locks[locks.length-1] the last. In the boss region, the last lock guards the boss node itself. */
  readonly locks: readonly QuestLock[];
  readonly hints: readonly Hint[];
  readonly skillTrainers: readonly SkillTrainerPlacement[];
  readonly eliteCaptures: readonly EliteCapturePlacement[];
}

export interface TierQuestGraph {
  readonly tierIndex: number;
  readonly seed: bigint;
  readonly bossRegionId: string;
  readonly bossLockId: string;
  readonly regions: readonly RegionQuestGraph[];
}

// ---------------------------------------------------------------------
// Deliverable 4 — mercy relocation
// ---------------------------------------------------------------------

/** Caller-supplied logged player state — no live playthrough exists yet this phase, so mercy is exercised directly against contrived/test input; a future live-play phase supplies this from the real event log. */
export interface MercyPlayerStateInput {
  readonly factId: string;
  readonly ticksSinceReachable: number;
}

export interface MercyRelocationEvent {
  readonly factId: string;
  readonly regionId: string;
  readonly fromNodeIds: readonly string[];
  readonly toNodeId: string;
}

// ---------------------------------------------------------------------
// Solvers (Deliverables 5, 6)
// ---------------------------------------------------------------------

export type SolverOutcome = "success" | "failure";

export interface SolverBResult {
  readonly outcome: SolverOutcome;
}

export interface SolverAResult {
  readonly outcome: SolverOutcome;
  /** Times Solver A acted without a uniquely narrowed candidate set — a hole in the hint economy, not a failure. */
  readonly guessCount: number;
  /** guessCount / total facts resolved — the per-seed tedium metric (aggregate tedium index, per ROADMAP.md §4, is the A-vs-B completion gap across the seed corpus; this is its per-seed analogue). */
  readonly tedium: number;
  readonly trace: readonly string[];
}
