// ---------------------------------------------------------------------
// Phase 5 — battle engine. Pure data shapes. See CLAUDE.md Phase 5 spec
// for the determinism contract and the four project-rule invariants
// this module must respect (no Math.random/Date.now, meta-fence, etc).
// ---------------------------------------------------------------------

import type {
  Ability,
  AbilityId,
  JobId,
  PrimaryStat,
  Row,
  TagId,
  ThreatArchetypeId,
  ThreatBehavior,
  WeaponArchetypeId,
} from "../content/types.js";

export type CombatantId = string;
export type StatBlock = Readonly<Record<PrimaryStat, number>>;

// ---------------------------------------------------------------------
// BattleRequest — the pure-function input (CLAUDE.md §2). Enemy stat
// blocks/break shields are derived from archetype+band upstream by the
// encounter builder (battle/encounterBuilder.ts), never by the resolver.
// ---------------------------------------------------------------------

export interface PartyMemberRequest {
  readonly id: CombatantId;
  readonly name: string;
  readonly level: number;
  readonly jobId: JobId;
  readonly jobLevel: number;
  readonly stats: StatBlock;
  readonly maxHp: number;
  readonly hp: number;
  readonly maxMp: number;
  readonly mp: number;
  readonly weaponArchetypeId: WeaponArchetypeId;
  /** Ids resolved via ContentPort at request-build time; caller enforces EQUIP_CAP, resolver does not re-check it (not a combat-legality concern). */
  readonly abilityLoadout: readonly AbilityId[];
  readonly row: Row;
  readonly boost: number;
  /** Existing unhealed wounds carried in from a prior fight (rest-gated recovery — CLAUDE.md §9). */
  readonly wounds: number;
}

export interface EnemyCombatantRequest {
  readonly id: CombatantId;
  readonly name: string;
  readonly archetypeId: ThreatArchetypeId;
  readonly level: number;
  readonly stats: StatBlock;
  readonly maxHp: number;
  readonly hp: number;
  readonly maxMp: number;
  readonly mp: number;
  readonly row: Row;
  readonly tags: readonly TagId[];
  readonly rowAttack: boolean;
  readonly threatBehavior: ThreatBehavior;
  readonly threatThreshold: number;
  readonly counterMaterial?: TagId;
  /** Concrete ability objects — engine executes uniformly whether authored or generated (CLAUDE.md §1). */
  readonly abilities: readonly Ability[];
  readonly breakShieldMax: number;
}

export interface BattleRequest {
  readonly party: readonly PartyMemberRequest[];
  readonly encounter: readonly EnemyCombatantRequest[];
  /** Stable encounter identity used to key the battle's rng substream (CLAUDE.md §2) — e.g. "battle:tier:{n}:node:{id}:{encounterSeq}". */
  readonly encounterId: string;
  /** Whether the party has the tag equipped/known that matches an enemy's counterMaterial (soft gate, CLAUDE.md §8). Resolved by the caller, not the resolver — the resolver never inspects loadouts to derive it. */
  readonly counteredArchetypeIds: ReadonlySet<ThreatArchetypeId>;
}

// ---------------------------------------------------------------------
// BattleInput — the scripted command stream (party actions only; enemies
// always act via battle/ai.ts). Consumed strictly in order; a party
// member's input must be supplied when it becomes that actor's turn.
// ---------------------------------------------------------------------

export interface AbilityInput {
  readonly kind: "ability";
  readonly actorId: CombatantId;
  readonly abilityId: AbilityId;
  readonly targetId?: CombatantId;
  readonly boostSpend?: number;
}

export interface DefendInput {
  readonly kind: "defend";
  readonly actorId: CombatantId;
}

export interface ScanInput {
  readonly kind: "scan";
  readonly actorId: CombatantId;
  readonly targetId: CombatantId;
}

export type BattleInput = AbilityInput | DefendInput | ScanInput;

// ---------------------------------------------------------------------
// BattleResult (CLAUDE.md §2)
// ---------------------------------------------------------------------

export type BattleOutcome = "party_win" | "tpk";

export interface PartyMemberDelta {
  readonly id: CombatantId;
  readonly hp: number;
  readonly mp: number;
  readonly woundsGained: number;
  readonly koed: boolean;
  readonly xpEarned: number;
  readonly finalBoost: number;
}

export interface BattleRewards {
  readonly gold: number;
  readonly gear: readonly string[];
}

export interface BestiaryObservation {
  readonly archetypeId: ThreatArchetypeId;
  readonly tagsRevealed: readonly TagId[];
  readonly weaknessesRevealed: readonly TagId[];
}

export interface BattleResult {
  readonly outcome: BattleOutcome;
  readonly partyDeltas: readonly PartyMemberDelta[];
  readonly rewards: BattleRewards;
  /** Total world-time this fight spent, on both the full-resolver and auto-resolve paths (CLAUDE.md §4/§11). */
  readonly tickCost: number;
  readonly log: readonly unknown[];
  readonly bestiaryObservations: readonly BestiaryObservation[];
}

// ---------------------------------------------------------------------
// Live combat state
// ---------------------------------------------------------------------

export type ModifierVariable =
  | "damageDealtMult"
  | "damageTakenMult"
  | "critChance"
  | "critMultiplier"
  | "accuracyScalar"
  | "actionCostMult"
  | "threatGenerationMult"
  | "mpCostMult"
  | "boostGenerationRate"
  | "statusResistance"
  | "resistPerTag"
  | PrimaryStat;

export type ModifierOperation = "add" | "multiply";

export interface ActiveModifier {
  readonly id: string;
  readonly targetVariable: ModifierVariable;
  readonly operation: ModifierOperation;
  readonly magnitude: number;
  /** Absolute tick this modifier expires at. `null` = until explicitly removed (e.g. Break window handled separately). */
  readonly expiresAtTick: number | null;
  /** Stack-rule identity: same source + same targetVariable (+ tag) refreshes duration instead of stacking magnitude (CLAUDE.md §3). */
  readonly source: string;
  /** Only meaningful when targetVariable === "resistPerTag" — which tag this modifier reduces/amplifies. */
  readonly tag?: TagId;
}

export type StatusShape = "queue_delay" | "dot" | "vulnerability_tag" | "duration_scalar_mod";

export interface LiveStatus {
  readonly id: string;
  readonly statusId: string;
  readonly shape: StatusShape;
  readonly magnitude: number;
  readonly appliedAtTick: number;
  readonly expiresAtTick: number;
  readonly source: string;
  /** vulnerability_tag shape only — the tag this status grants the target while active. */
  readonly grantsTag?: TagId;
}

export interface LiveCombatant {
  readonly id: CombatantId;
  readonly side: "party" | "enemy";
  readonly name: string;
  readonly level: number;
  readonly tags: readonly TagId[];
  readonly stats: StatBlock;
  maxHp: number;
  hp: number;
  maxMp: number;
  mp: number;
  row: Row;
  nextActionTick: number;
  threat: number;
  boost: number;
  wounds: number;
  koed: boolean;
  defending: boolean;
  statuses: LiveStatus[];
  modifiers: ActiveModifier[];
  readonly abilities: readonly Ability[];
  readonly weaponArchetypeId?: WeaponArchetypeId;
  readonly reach?: "melee" | "ranged";
  readonly rowAttack?: boolean;
  readonly threatBehavior?: ThreatBehavior;
  readonly threatThreshold?: number;
  readonly counterMaterial?: TagId;
  readonly countered?: boolean;
  breakShieldMax: number;
  breakShieldCurrent: number;
  breakWindowUntilTick: number | null;
  scanned: boolean;
}
