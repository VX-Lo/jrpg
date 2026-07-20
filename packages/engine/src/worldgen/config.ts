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
// Region adjacency graph
// ---------------------------------------------------------------------

/**
 * Inter-region travel weight bounds. Deliberately wider and slower-
 * floored than intra-region node edges: crossing between two regions is
 * long-haul by nature, the same reasoning that gives landmark-endpoint
 * edges `EDGE_WEIGHT_REMOTE_MAX_TICKS`. UNCALIBRATED.
 */
export const REGION_EDGE_WEIGHT_MIN_TICKS = 8;
export const REGION_EDGE_WEIGHT_MAX_TICKS = 40;

/**
 * UNCALIBRATED: fraction of extra (non-spanning-tree) region edges, relative
 * to region count. With 2-4 regions per tier this yields 0-1 extra edges —
 * i.e. most tiers are a bare region *tree*, and some get one cycle. That is
 * the intended shape: every unbuilt region pair is a SEALED border in
 * Phase 4.5's spatial layer, so keeping the graph sparse is what gives the
 * anti-shortcut gate (Phase 4.5 Gate 2) something real to assert.
 */
export const EXTRA_REGION_EDGE_FRACTION = 0.3;

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

/**
 * No live play exists yet this phase, so arc simulation (questgraph/arcs/arcEngine.ts)
 * stands in for it with one seeded roll per Beat: below this chance,
 * the Beat's onQuestComplete transition fires; at or above, onTickTimeout
 * fires instead. UNCALIBRATED — a future live-play phase replaces this
 * roll with real quest-completion/tick-threshold events from the log.
 * Chosen slightly above 0.5 so outcome distributions don't collapse
 * toward the earliest timeout branch (see Gate 5 — no single outcome
 * tag may exceed 85% of instances).
 */
export const ARC_BEAT_QUEST_COMPLETE_CHANCE = 0.55;

// ---------------------------------------------------------------------
// Phase 4.5 — spatial embedding
// ---------------------------------------------------------------------
// Terrain constants. Kept in this module rather than a spatial-local one
// because this file is the project's single calibration home (same reason
// Phase 3's EQUIP_CAP lives here rather than in content/).

/** Tile edge length of one authored chunk at wilderness/settlement scale. */
export const CHUNK_SIZE = 16;

/** Tile edge length at the closest zoom (inn rooms, dungeon rooms) — deliberately smaller. */
export const ROOM_CHUNK_SIZE = 8;

/**
 * Edge length of a tier's coarse chunk-grid. A tier is a bounded canvas
 * (roadmap §16b) — COARSE_GRID_SIZE² cells, each holding one chunk.
 *
 * DELIBERATELY SMALLER THAN THE ROADMAP'S TARGET, and this is the honest
 * fixture-stage tradeoff rather than a calibration guess. Roadmap §16b
 * sizes regions at ~64 chunk-slots each, which is trivially satisfiable
 * against the eventual 320-480 authored variants/biome — but this phase
 * ships a FIXTURE chunk library (~2 dozen chunks), and the no-repeat rule
 * (Gate 7: never reuse a chunk+orientation within one region) is a hard
 * constraint, not a preference. At 8 a tier is 64 cells and a region is
 * 16-32, which the fixture library satisfies with real slack.
 *
 * RAISE THIS TO 16 when the full 40-60-chunks/biome authoring pass lands.
 * Nothing else needs to change — assembly reads this constant, and it
 * fails loudly rather than silently degrading if the library is ever too
 * thin for the grid (see assemble.ts).
 *
 * At 10 the outer ring is the impassable tier boundary (a tier is a
 * bounded canvas), leaving an 8x8 = 64-cell interior — 16-32 cells per
 * region depending on the tier's shape roll.
 */
export const COARSE_GRID_SIZE = 10;

/**
 * Minimum Chebyshev distance between two regions' Voronoi seed points on
 * the coarse grid. Prevents sliver regions. UNCALIBRATED — at
 * COARSE_GRID_SIZE 16 with at most 4 regions, 4 is comfortably
 * satisfiable while still allowing varied layouts.
 */
export const VORONOI_MIN_SEED_DISTANCE = 3;

/**
 * Candidates drawn per region when placing Voronoi seeds (Mitchell's
 * best-candidate). Plain rejection sampling reliably failed to place the
 * 4th seed on an 8x8 interior and fell back to a colliding position, which
 * produced regions with ZERO territory. Keeping the best of N candidates
 * spreads seeds robustly at any region count.
 */
export const VORONOI_SEED_CANDIDATES = 16;

/**
 * Spare coarse cells a region needs beyond one per logical node, so the
 * backbone has room to route between them. Territory is grown to meet this
 * floor deterministically (see voronoi.ts) rather than hoped for.
 */
export const REGION_CELL_SLACK = 2;

/**
 * Magnitude of the seeded per-cell noise added to the Voronoi distance
 * metric, in coarse-cell units. This is what makes borders wobble instead
 * of forming straight bisectors. Too high and regions fragment into
 * non-contiguous islands; the CA smoothing passes below exist to reabsorb
 * the small fragmentation this does produce.
 *
 * Tuned empirically against a border-straightness measure (fraction of
 * border segments whose neighbouring row/column breaks at the same place)
 * over 60 seeds: 2.0 → 0.536, 3.5 → 0.469, 5.0 → 0.454, 7.0 → 0.486.
 * Chosen at the 5.0 minimum. Higher values keep nudging the measure down
 * (10.0 → 0.445) but only by drowning the Voronoi structure in noise, so
 * that the territory-floor repair does the shaping instead of the metric —
 * lower score, worse generator.
 *
 * A LOW-FREQUENCY (box-blurred) noise field was tried here first, on the
 * theory that CA smoothing would erase high-frequency wobble. It measured
 * WORSE (0.531 vs 0.469 at equal strength) and the mechanism was removed
 * rather than left in at zero passes: on an 8-cell interior a blurred
 * field is effectively a global gradient, which translates a border rather
 * than bending it. Recorded so the idea isn't re-tried blind.
 */
export const VORONOI_NOISE_STRENGTH = 5.0;

/**
 * Cellular-automata majority-vote passes that round wobble into organic
 * blobs. Roadmap §16b specifies 2-3; 2 is used because 3 passes of
 * 8-neighbour majority visibly over-smoothed the borders back into
 * straight lines.
 */
export const VORONOI_SMOOTHING_PASSES = 2;

/**
 * Blend strip width in tiles at a region seam (roadmap §16b: 3-5).
 * Kernels with a declared shared boundaryRoot get the WIDE value (softer,
 * because narrative closeness earns physical closeness); kernels without
 * get the NARROW one. No per-kernel-pair authoring — the N² trap.
 */
export const BLEND_STRIP_NARROW_TILES = 3;
export const BLEND_STRIP_WIDE_TILES = 5;

/**
 * Ticks per step at each zoom. The closest zoom is the 1-tick baseline;
 * coarser zooms cost more because one step covers proportionally more
 * ground — the ratio is justified by the scale, not picked arbitrarily
 * (roadmap §16b). UNCALIBRATED in absolute terms; the RATIOS are the
 * meaningful part.
 */
export const ZOOM_TICKS_PER_STEP = {
  closest: 1,
  medium: 2,
  far: 8,
  /** Farthest zoom is pure abstraction over the logical graph — traversal there uses the region-adjacency edge's own weightTicks, not a per-step cost. */
  farthest: 0,
} as const;

/**
 * Movement-gets-cheaper-with-familiarity (roadmap §16b): the first crossing
 * of a coarse cell costs full ticks; any later crossing costs this flat
 * fraction of it. Generalizes Phase 2's hub-inn fast-travel discount one
 * scale down. A found vehicle is the same mechanism with a different
 * modifier — the mechanism is defined here, no vehicles are wired.
 * UNCALIBRATED.
 */
export const REVISIT_TICK_MULTIPLIER = 0.25;

/**
 * Soft without-replacement weighting for chunk selection across a tier.
 * A chunk+orientation already used elsewhere in the TIER has its selection
 * weight multiplied by this each time it is reused, so repetition is
 * discouraged tier-wide but never impossible. Reuse within a SINGLE region
 * is forbidden outright, not weighted — see Gate 7. UNCALIBRATED.
 */
export const CHUNK_REUSE_WEIGHT_PENALTY = 0.15;

/**
 * How many cosmetic decoration variants the parametric fill may scatter on
 * a walkable tile. Purely visual — the decor layer is separate from the
 * walkability mask and can never change it (see embed.ts). UNCALIBRATED;
 * Phase 10 decides what these actually look like.
 */
export const DECOR_VARIANT_COUNT = 4;

/**
 * Chance an off-backbone coarse cell becomes an ENCLAVE — terrain sealed
 * on all four sides, holding solid rock or an enclosed decorative pocket
 * rather than walkable ground.
 *
 * Every non-enclave cell is linked back to the backbone instead, because a
 * cell that is neither reachable nor sealed is a walkable island (Gate 3).
 * Higher values give craggier, more closed-in regions; 0 gives terrain
 * with no solid interior at all. UNCALIBRATED.
 */
export const ENCLAVE_CHANCE = 0.18;

/**
 * Selection weight multiplier for a chunk whose biome matches the region's
 * kernel, relative to a fallback `common` chunk.
 *
 * A kernel's own pool is UNIONED with common rather than replacing it, so
 * that a biome with a thin fixture set is still buildable. Without a
 * preference the union would drown the biome: `common` has far more chunks,
 * so a Fen region would place mostly generic terrain and the Fen would not
 * look like the Fen. This tilts selection strongly toward the kernel's own
 * chunks while keeping common as a genuine fallback rather than a tie.
 * UNCALIBRATED.
 */
export const BIOME_MATCH_WEIGHT_BONUS = 12;

/**
 * Edge length of an interior's room grid at the closest zoom. 4 gives a
 * 4x4 = 16-room inn or dungeon floor at ROOM_CHUNK_SIZE, i.e. 32x32 tiles.
 * UNCALIBRATED — the right number depends on how long a dungeon floor
 * should take to clear, which is Phase 5's question.
 */
export const INTERIOR_GRID_SIZE = 4;

/**
 * Chance a room inside an interior is sealed solid, giving the floor plan
 * walls and irregularity rather than a full open lattice. Never applied to
 * the entry or POI rooms, and any room the spanning tree cannot reach is
 * sealed too — the same "linked or sealed, never an island" rule the far
 * zoom uses. UNCALIBRATED.
 */
export const INTERIOR_SEALED_CELL_CHANCE = 0.22;

// ---------------------------------------------------------------------
// Phase 5 — battle engine
//
// Same calibration home as everything else. Every number here is
// UNCALIBRATED — this phase builds a correct engine, not a balanced one
// (see CLAUDE.md Phase 5 spec). The mechanisms (one shared tick clock,
// floored action cost, pressure-sensitive Boost) are load-bearing; the
// magnitudes are placeholders for later harness-driven tuning.
// ---------------------------------------------------------------------

/** Baseline action cost in ticks before actionCostMult/actionWeight scale it. UNCALIBRATED. */
export const BASE_ACTION_TICKS = 1000;

/**
 * Floor on resolvedActionCost so a large Haste (actionCostMult toward 0)
 * can't drive an actor toward infinite actions per unit time (the AGI-floor
 * concern, CLAUDE.md §3/§4). Non-negotiable mechanism; UNCALIBRATED exact
 * value.
 */
export const MIN_ACTION_TICKS = 50;

/**
 * Ticks in one in-fiction day, for the overworld dawn/midday/dusk/night
 * phase mapping (engine exposes absolute tick position only; the phase
 * mapping is Design's — CLAUDE.md §4). DECISION (not an ASK-FIRST block):
 * no market exists yet (Phase 6 is a stub with no price formulas) and the
 * only other tick-consuming cadence today is ARC_BEAT_TICK_THRESHOLD =
 * 2000 (arc Beats can force-transition unresolved) — that's a per-Beat
 * threshold, not a day length, so there is no existing cadence this value
 * could conflict with. Chosen as 24 * BASE_ACTION_TICKS (four phases of
 * 6000 ticks each) so a day comfortably contains multiple arc Beats and
 * several combat turns without being so long a single long fight can't
 * plausibly burn a meaningful fraction of one. UNCALIBRATED.
 */
export const TICKS_PER_DAY = 24 * BASE_ACTION_TICKS;

/**
 * powerRatio(party, encounter) above this triggers auto-resolve instead of
 * full CTB simulation (CLAUDE.md §11). UNCALIBRATED — exact powerRatio
 * formula lives in battle/autoResolve.ts.
 */
export const AUTO_RESOLVE_THRESHOLD = 3.0;

/** Boost (BP) accumulator gained per actor turn, absent any pressure modifier. UNCALIBRATED. */
export const BOOST_PER_TURN = 1;

/** Boost accumulator cap. UNCALIBRATED. */
export const BOOST_CAP = 5;

/** Max Boost that can be spent amplifying a single action. UNCALIBRATED. */
export const BOOST_SPEND_MAX = 3;

/**
 * Multiplier applied to boostGenerationRate while a party member is
 * wounded (has an unhealed Wound) or currently downed — the pressure-
 * sensitive comeback lever that stands in for a separate limit-break
 * system (CLAUDE.md §6). UNCALIBRATED.
 */
export const BOOST_PRESSURE_MULTIPLIER = 2.0;

/** Level-difference damage scalar at attacker-3-below-defender, per CLAUDE.md §8 (~0.88 example). Smooth, monotonic, never zero — see battle/damage.ts. UNCALIBRATED. */
export const LEVEL_DIFF_SCALAR_AT_MINUS3 = 0.88;

/** Variance band half-width (±%) on damage rolls under normal (countered or unopposed) conditions. UNCALIBRATED. */
export const DAMAGE_VARIANCE_NORMAL = 0.1;

/** Variance band half-width (±%) when the soft-gate's "uncountered" widening applies (CLAUDE.md §8). UNCALIBRATED. */
export const DAMAGE_VARIANCE_UNCOUNTERED = 0.35;

/** Flat effective-stat edge granted to an uncountered threat's counter-material bonus (CLAUDE.md §8). UNCALIBRATED. */
export const UNCOUNTERED_STAT_EDGE = 0.15;
