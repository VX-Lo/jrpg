// ---------------------------------------------------------------------
// Tags — one flat shared vocabulary (Deliverable 3). Same tags serve
// ability domain/role, weakness mapping (Phase 5), and puzzle-keying by
// region (already carried on Phase 2's kernels). Never a second
// namespace.
// ---------------------------------------------------------------------

export type TagId = string;
export type TagCategory = "domain" | "role";

export interface TagDef {
  readonly id: TagId;
  readonly category: TagCategory;
}

// ---------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------

export type PrimaryStat = "STR" | "INT" | "VIT" | "AGI" | "PER";

export const PRIMARY_STATS: readonly PrimaryStat[] = ["STR", "INT", "VIT", "AGI", "PER"];

// ---------------------------------------------------------------------
// Ability power formula (rule 10) — additive between stat and job-level,
// multiplicative only by bounded things. The shape below makes the
// illegal case (multiplying two unbounded factors) representable ONLY
// inside `multipliers`, so validation has exactly one place to check
// (see content/primitives.ts's BOUNDED_MULTIPLIER_KINDS and Gate 4).
// ---------------------------------------------------------------------

/** Where the formula's base value comes from. Never a product of two of these — the shape only allows one. */
export type StatSource =
  | { readonly kind: "primary_stat"; readonly stat: PrimaryStat }
  | { readonly kind: "weapon_scaling" }; // resolved from the equipped weapon at resolution time (Phase 5) — see D6

/**
 * Multiplier kinds. BOUNDED kinds (constant, crit, elemental) are legal.
 * UNBOUNDED kinds (job_level, primary_stat, weapon_scaling) are part of
 * this type ONLY so the loader has something concrete to reject — an
 * ability that lists one here is exactly rule 10's forbidden case
 * (stat/level used as a multiplicative factor instead of additive).
 * See Gate 4.
 */
export type MultiplierKind = "constant" | "crit" | "elemental" | "job_level" | "primary_stat" | "weapon_scaling";

export interface PowerMultiplier {
  readonly kind: MultiplierKind;
  /** Required for "constant"; a documented bounded value for "crit"/"elemental" (e.g. a fixed crit multiplier). Ignored/absent for the forbidden unbounded kinds. */
  readonly value?: number;
}

export interface PowerFormula {
  readonly base: StatSource;
  readonly multipliers: readonly PowerMultiplier[];
}

// ---------------------------------------------------------------------
// Effect primitives (THE CENTRAL COMMITMENT) — abilities compose these,
// never bespoke code. Keep the set small; a primitive enters only when a
// fixture ability actually needs it.
// ---------------------------------------------------------------------

export type PrimitiveId = "damage" | "heal" | "apply_status" | "shift_queue" | "modify_threat" | "buff" | "debuff";

export type StatusId = "sleep" | "slow" | "poison" | "oiled";

/** Separate axis from element tags: rows reduce `physical` specifically, some resists are channel-based. */
export type DamageChannel = "physical" | "magical" | "true";

export interface DamageParams {
  readonly powerFormula: PowerFormula;
  /**
   * Optional, defaulted (Phase 5, additive schema change — see CLAUDE.md
   * Phase 5 fence): "physical" for weapon-scaled damage, "magical"
   * otherwise. Untouched Phase 3 content omits this and still validates.
   */
  readonly channel?: DamageChannel;
}

export interface HealParams {
  readonly powerFormula: PowerFormula;
}

/** Status always applies; duration/magnitude scale against resist at runtime (Phase 5) — never a hit/miss roll. */
export interface ApplyStatusParams {
  readonly status: StatusId;
  readonly baseDuration: number;
  readonly baseMagnitude: number;
}

/** CTB queue manipulation. Phase 5 wires the actual queue; the primitive and its params are defined here. */
export interface ShiftQueueParams {
  readonly direction: "forward" | "back";
  readonly amount: number;
}

export interface ModifyThreatParams {
  readonly amount: number;
}

export type BuffableStat = PrimaryStat | "threat";

export interface BuffDebuffParams {
  readonly stat: BuffableStat;
  readonly magnitude: number;
  readonly durationTicks: number;
}

export type EffectParams =
  | DamageParams
  | HealParams
  | ApplyStatusParams
  | ShiftQueueParams
  | ModifyThreatParams
  | BuffDebuffParams;

export interface Effect {
  readonly primitive: PrimitiveId;
  readonly params: EffectParams;
}

// ---------------------------------------------------------------------
// Ability
// ---------------------------------------------------------------------

export type AbilityId = string;
export type TargetShape = "self" | "one" | "row" | "all";

export interface Ability {
  readonly id: AbilityId;
  readonly name: string;
  /** Domain and/or role tags — shared vocabulary (D3). Determines access via overlap with a job's allowed_tags. */
  readonly tags: readonly TagId[];
  /**
   * Must be one of `tags`. Drives the mastery bonus — see
   * content/access.ts. NOT restricted to domain-category tags: a
   * martial job's primary specialty is the role tag "martial" (e.g.
   * Warrior/Cleave), while a caster's is a domain tag like "fire"
   * (e.g. Mage/Fireball). "Domain" in the name means "the ability's
   * main specialty," not a TagCategory restriction.
   */
  readonly primaryDomainTag: TagId;
  readonly targetShape: TargetShape;
  /** CTB cost — Phase 5 consumes, defined here. */
  readonly tickCost: number;
  /** MP etc. */
  readonly resourceCost: number;
  readonly effects: readonly Effect[];
  // NOTE: deliberately no `reach` field — reach is derived from the
  // equipped weapon at resolution time, never stored on the ability. See D6.
}

// ---------------------------------------------------------------------
// Job / class
// ---------------------------------------------------------------------

export type JobId = string;
export type Row = "front" | "back";

export type StatGrowth = Readonly<Record<PrimaryStat, number>>;

export interface Job {
  readonly id: JobId;
  readonly name: string;
  readonly statGrowth: StatGrowth;
  /** Drives the mastery bonus — must match an ability's primaryDomainTag for job_level_bonus to apply. */
  readonly primaryTag: TagId;
  /** Access via OVERLAP with an ability's tags — never full containment. */
  readonly allowedTags: readonly TagId[];
  /** Locked to this job, no tag check. */
  readonly signatureAbilities: readonly AbilityId[];
  readonly equipProficiencies: readonly WeaponArchetypeId[];
  readonly defaultRow: Row;
  /** Optional; stub the shape only — Phase 5 fills behavior. */
  readonly threatProfile?: JobThreatProfile;
}

/** Stub shape only — Phase 5 fills the actual behavior this drives. */
export interface JobThreatProfile {
  readonly baseThreatMultiplier: number;
}

// ---------------------------------------------------------------------
// Weapon archetype (D6) — reach and scaling stat live on the weapon, not
// the ability or the class. Equipping a different weapon reshapes what
// an ability does.
// ---------------------------------------------------------------------

export type WeaponArchetypeId = string;
export type Reach = "melee" | "ranged";

/** "edge"/"tang" style display labels per the (not-yet-built) crafting system — carried as plain labels this phase, no runtime logic. */
export interface SlotDisplay {
  readonly striking: string;
  readonly core: string;
}

export interface WeaponArchetype {
  readonly id: WeaponArchetypeId;
  readonly name: string;
  readonly slotDisplay: SlotDisplay;
  readonly reach: Reach;
  readonly scalingStat: PrimaryStat;
}

// ---------------------------------------------------------------------
// Threat archetype (D5)
// ---------------------------------------------------------------------

export type ThreatArchetypeId = string;
export type ThreatScope = "world" | "regional";
export type ThreatBehavior = "loyal" | "opportunist" | "assassin";

export interface ThreatArchetype {
  readonly id: ThreatArchetypeId;
  readonly name: string;
  /** e.g. aquatic, undead, ashborn — weakness comes from the ONE authored weakness table, keyed by these. */
  readonly tags: readonly TagId[];
  readonly powerTier: number;
  readonly scope: ThreatScope;
  readonly rowLine: Row;
  /** Enemy row-targeting — ONLY true on flagged archetypes, never player-manipulable. */
  readonly rowAttack?: boolean;
  /** Stub enum — Phase 5 wires actual behavior. */
  readonly threatBehavior: ThreatBehavior;
  /** The soft-gate tag; Phase 5 wires the variance widening. */
  readonly counterMaterial?: TagId;
}

/** The ONE authored table mapping a tag to its weakness tag. Obfuscation is unexpected tag composition, never a hidden field. */
export interface WeaknessEntry {
  readonly tag: TagId;
  readonly weakness: TagId;
}
