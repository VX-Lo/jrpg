/**
 * Calibration config — every tunable number in the world generator lives
 * here, named and documented. No magic numbers anywhere else in
 * src/worldgen, ever.
 *
 * Several of these are genuinely undecided. The most consequential open
 * question is intended run length: it determines band spacing, tier
 * count to the death frontier, and the XP curve. Answering it later
 * should cost an edit to this file, not a refactor of the generator.
 */

// ---------------------------------------------------------------------
// Tier shape
// ---------------------------------------------------------------------

/** Total node budget for a tier, summed across all its regions. Constant regardless of shape. */
export const NODES_PER_TIER = 24;

/**
 * [nodesPerRegion, nodesPerRegion, ...] — every shape sums to
 * NODES_PER_TIER, so region *count* varies (2/3/4) while total tier size
 * stays constant: 2 big regions, 3 medium, or 4 small carry equal weight
 * with different texture. Rolled once per tier from
 * `worldgen:tier:{n}:shape`.
 */
export const REGION_SHAPES: readonly (readonly number[])[] = [
  [12, 12],
  [8, 8, 8],
  [6, 6, 6, 6],
];

/**
 * The largest region count across all REGION_SHAPES. Kernel assignment
 * per tier is drawn without replacement (see worldgen/kernel.ts) so that
 * two regions in the same tier never share a kernel — with only a
 * handful of fixture kernels this phase, two regions sharing a kernel
 * would collide on curated name pools and produce duplicate proper
 * nouns, which Gate 1 forbids. This means the kernel pool must have at
 * least this many entries.
 */
export const MAX_REGIONS_PER_TIER = Math.max(...REGION_SHAPES.map((s) => s.length));

// ---------------------------------------------------------------------
// Difficulty band
// ---------------------------------------------------------------------

/** UNCALIBRATED: level band at tier 1. Depends on intended run length (open question — see file header). */
export const BAND_BASE = 3;

/**
 * THE difficulty exponent. band(tierIndex) = round(BAND_BASE * tierIndex^BAND_GROWTH).
 *
 * MUST stay > 1 (superlinear). The meta system works because player
 * power grows *linearly* across runs while difficulty grows
 * *superlinearly* across tiers — death depth then falls out as roughly
 * log(runs), and the curve self-limits without an explicit cap. If this
 * is ever "simplified" to 1 (linear) or below, the game silently
 * becomes an unwinnable treadmill at high run counts, and nothing else
 * in the system would catch it. See Gate 3, which fits this curve and
 * fails the build if the fitted exponent isn't > 1.
 *
 * UNCALIBRATED exact value — depends on intended run length — but the
 * constraint BAND_GROWTH > 1 is not negotiable.
 *
 * Implementation note: band() uses Math.pow/Math.round (floating point).
 * This is fine here — unlike the RNG/hash core, band() is never stored
 * and never needs cross-platform-forever bit-stability for save
 * compatibility (rule #2: derivable from the seed, recomputed every
 * time). It only needs to be a pure function of tierIndex within one
 * running process, which Math.pow trivially satisfies.
 */
export const BAND_GROWTH = 1.4;

/** UNCALIBRATED: bands this far below the party's current band give ~0 meaningful XP. Depends on run length / XP curve (Phase 5/6 own the consumption side). */
export const XP_CAP_DELTA = 5;

// ---------------------------------------------------------------------
// Region node composition
// ---------------------------------------------------------------------

export const MIN_SETTLEMENTS_PER_REGION = 1;
export const MAX_DUNGEONS_PER_REGION = 3;

/** UNCALIBRATED: fraction of a region's node budget that becomes settlements (rounded, floored at MIN_SETTLEMENTS_PER_REGION). */
export const SETTLEMENT_NODE_FRACTION = 0.25;
/** UNCALIBRATED: fraction of a region's node budget that becomes dungeon entrances (rounded, capped at MAX_DUNGEONS_PER_REGION). Remainder becomes landmarks. */
export const DUNGEON_NODE_FRACTION = 0.15;

export const MIN_FACTIONS_PER_REGION = 1;
export const MAX_FACTIONS_PER_REGION = 3;

export const MIN_NPCS_PER_REGION = 4;
export const MAX_NPCS_PER_REGION = 8;

export const DUNGEON_CLUSTER_MIN_NODES = 2;
export const DUNGEON_CLUSTER_MAX_NODES = 5;

// ---------------------------------------------------------------------
// Node graph edges
// ---------------------------------------------------------------------

/** Normal edge weight (travel time, ticks) bounds. UNCALIBRATED — ties into the global tick economy later phases build on. */
export const EDGE_WEIGHT_MIN_TICKS = 1;
export const EDGE_WEIGHT_MAX_TICKS = 12;

/**
 * Wider weight bound applied when either endpoint of an edge is a
 * landmark node — this is how remote/high-peak nodes get to be slow to
 * reach without any special-casing: it's just a wider draw range keyed
 * off node kind, same mechanism as every other edge.
 */
export const EDGE_WEIGHT_REMOTE_MAX_TICKS = 30;

/** UNCALIBRATED: fraction of extra (non-spanning-tree) edges added for cycles/texture, relative to node count. */
export const EXTRA_EDGE_FRACTION = 0.3;

// ---------------------------------------------------------------------
// Boss / threat archetype
// ---------------------------------------------------------------------

/**
 * Fixture threat archetype IDs. Phase 2 only places a reference to one
 * of these on the boss node — Phase 5 implements the mechanical guts
 * behind each ID.
 */
export const THREAT_ARCHETYPE_IDS: readonly string[] = [
  "archetype:bruiser",
  "archetype:swarm",
  "archetype:caster",
  "archetype:ambusher",
  "archetype:sentinel",
];

// ---------------------------------------------------------------------
// Phase 3 — content / combat calibration
//
// Lives here rather than a separate module because this file is the
// project's one calibration home — "add it there, don't scatter it."
// ---------------------------------------------------------------------

/**
 * Hard loadout size: how many abilities a character can have equipped at
 * once, regardless of how many they've unlocked. This is the
 * deckbuilder tension — access to abilities is generous (tag overlap,
 * see content/access.ts), but the equip cap forces a choice among them.
 * UNCALIBRATED exact value (6-8 is the suggested range) but the
 * mechanism — a hard cap all ability tiers compete for — is not
 * negotiable.
 */
export const EQUIP_CAP = 6;

/**
 * Coefficient for job_level_bonus in the ability-power formula:
 * jobLevelBonus = jobLevel * JOB_LEVEL_BONUS_PER_LEVEL, applied only
 * when the ability's primary domain tag matches the job's primary tag
 * (the mastery mechanic). Added ADDITIVELY to the relevant stat, never
 * multiplicatively — see content/formula.ts and rule 10 in CLAUDE.md.
 * UNCALIBRATED — depends on the same open run-length question as
 * BAND_GROWTH/BAND_BASE above.
 */
export const JOB_LEVEL_BONUS_PER_LEVEL = 1;

// ---------------------------------------------------------------------
// Phase 4 — quest graph calibration
//
// Same calibration home as everything else. Every number here is
// UNCALIBRATED (depends on the same open run-length question as the
// band constants above) except where a comment says otherwise — the
// *mechanisms* these numbers drive (forward generation, multi-path
// redundancy, specificity curve) are load-bearing; the exact magnitudes
// are tuning knobs for later playtesting.
// ---------------------------------------------------------------------

/** Bounds on how many locked gates a region's local quest chain has. Small on purpose — see CLAUDE.md Phase 4 architecture for why regions stay independent, shallow puzzles rather than one tier-spanning chain. */
export const QUESTGRAPH_MIN_GATES_PER_REGION = 2;
export const QUESTGRAPH_MAX_GATES_PER_REGION = 4;

/** Chance a gate's fact is placed at 2 already-reachable nodes instead of 1 — Deliverable 2's "multi-path, deliberately" bad-luck protection. Must fire often enough to matter, not as a rare edge case. */
export const QUESTGRAPH_MULTI_PATH_CHANCE = 0.4;

/** Chance a gate requires 2 facts (AND) instead of 1 — the "the Key needs the Rod and the Orb" compound-prerequisite case DependencyHint exists to narrate. */
export const QUESTGRAPH_COMPOUND_LOCK_CHANCE = 0.3;

/** Locked-node integrity, scaled by tier band. No `canPick` check exists anywhere — this is data for Phase 8's minigame to consume, not an enforced gate this phase. */
export const LOCK_INTEGRITY_BASE = 10;
export const LOCK_INTEGRITY_PER_BAND = 0.5;

/** How many hints get emitted per prerequisite fact (Deliverable 3). */
export const HINTS_PER_FACT = 3;

/**
 * Ordered vague → precise. Earlier hints on the path (nodes that
 * unlocked further back in the region's gate sequence) get the vaguer
 * end of this curve; hints from nodes closer to the point where the
 * fact becomes necessary get the precise end. Length need not match
 * HINTS_PER_FACT — hints are distributed across this curve by rank, see
 * questgraph/hints.ts.
 */
export const HINT_SPECIFICITY_CURVE: readonly ("vague" | "medium" | "precise")[] = ["vague", "medium", "precise"];

/** How many skill trainers / elite-capture markers each region places, via the same forward-generation reachable-pool mechanism as items (Deliverable 8 — not a parallel system). */
export const SKILL_TRAINERS_PER_REGION_MIN = 0;
export const SKILL_TRAINERS_PER_REGION_MAX = 2;
export const ELITE_CAPTURES_PER_REGION_MIN = 0;
export const ELITE_CAPTURES_PER_REGION_MAX = 2;

/** Mercy relocation (Deliverable 4): seeded chance an eligible (zero-live-hint) fact relocates, given logged player state crosses the ticks threshold. */
export const MERCY_ROLL_CHANCE = 0.5;
export const MERCY_TICKS_SINCE_REACHABLE_THRESHOLD = 3000;

// ---------------------------------------------------------------------
// Phase 4 — regional arcs
// ---------------------------------------------------------------------

export const ARC_MIN_BEATS = 4;
export const ARC_MAX_BEATS = 8;

/** World ticks a Beat can sit unresolved before the arc forces a transition on its own — the arc doesn't wait for the player (see CLAUDE.md Deliverable 7). UNCALIBRATED, ties into the same global tick economy as edge weights. */
export const ARC_BEAT_TICK_THRESHOLD = 2000;
