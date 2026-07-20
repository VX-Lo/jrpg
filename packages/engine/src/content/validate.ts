import {
  PRIMARY_STATS,
  type Ability,
  type AbilityId,
  type BuffableStat,
  type DamageChannel,
  type Effect,
  type EffectParams,
  type Job,
  type JobId,
  type PowerFormula,
  type PrimaryStat,
  type Reach,
  type Row,
  type StatGrowth,
  type StatSource,
  type TagCategory,
  type TagDef,
  type TagId,
  type TargetShape,
  type ThreatArchetype,
  type ThreatBehavior,
  type ThreatScope,
  type WeaknessEntry,
  type WeaponArchetype,
  type WeaponArchetypeId,
} from "./types.js";
import { BOUNDED_MULTIPLIER_KINDS, KNOWN_PRIMITIVES, KNOWN_STATUSES } from "./primitives.js";

// ---------------------------------------------------------------------
// Small structural helpers — every check throws a descriptive Error.
// Validate on load, fail loud (D1). Never a silent skip.
// ---------------------------------------------------------------------

function fail(context: string, message: string): never {
  throw new Error(`${context}: ${message}`);
}

function requireString(value: unknown, context: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(context, `field "${field}" must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value as string;
}

function requireNumber(value: unknown, context: string, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(context, `field "${field}" must be a finite number, got ${JSON.stringify(value)}`);
  }
  return value as number;
}

function requireArray(value: unknown, context: string, field: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(context, `field "${field}" must be an array, got ${JSON.stringify(value)}`);
  }
  return value as unknown[];
}

function requireOneOf<T extends string>(value: unknown, options: readonly T[], context: string, field: string): T {
  if (typeof value !== "string" || !(options as readonly string[]).includes(value)) {
    fail(context, `field "${field}" must be one of ${JSON.stringify(options)}, got ${JSON.stringify(value)}`);
  }
  return value as T;
}

// ---------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------

export function validateTags(raw: unknown): TagDef[] {
  const context = "tags.toml";
  const list = requireArray((raw as { tags?: unknown })?.tags, context, "tags");
  const seen = new Set<TagId>();
  return list.map((entry, i) => {
    const c = `${context} tags[${i}]`;
    const id = requireString((entry as Record<string, unknown>)?.id, c, "id");
    const category = requireOneOf<TagCategory>((entry as Record<string, unknown>)?.category, ["domain", "role"], c, "category");
    if (seen.has(id)) fail(c, `duplicate tag id "${id}"`);
    seen.add(id);
    return { id, category };
  });
}

// ---------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------

export function validateWeapons(raw: unknown): WeaponArchetype[] {
  const context = "weapons.toml";
  const list = requireArray((raw as { weapons?: unknown })?.weapons, context, "weapons");
  const seen = new Set<WeaponArchetypeId>();
  return list.map((entry, i) => {
    const c = `${context} weapons[${i}]`;
    const e = entry as Record<string, unknown>;
    const id = requireString(e?.id, c, "id");
    if (seen.has(id)) fail(c, `duplicate weapon id "${id}"`);
    seen.add(id);
    const name = requireString(e?.name, c, "name");
    const reach = requireOneOf<Reach>(e?.reach, ["melee", "ranged"], c, "reach");
    const scalingStat = requireOneOf<PrimaryStat>(e?.scaling_stat, PRIMARY_STATS, c, "scaling_stat");
    const slotDisplayRaw = e?.slot_display as Record<string, unknown> | undefined;
    if (!slotDisplayRaw || typeof slotDisplayRaw !== "object") {
      fail(c, `field "slot_display" must be a table with "striking" and "core" string fields`);
    }
    const striking = requireString(slotDisplayRaw.striking, c, "slot_display.striking");
    const core = requireString(slotDisplayRaw.core, c, "slot_display.core");
    return { id, name, reach, scalingStat, slotDisplay: { striking, core } };
  });
}

// ---------------------------------------------------------------------
// Power formula (rule 10 — Gate 4)
// ---------------------------------------------------------------------

export function validatePowerFormula(raw: unknown, context: string): PowerFormula {
  const c = `${context} power_formula`;
  const r = raw as Record<string, unknown>;
  if (!r || typeof r !== "object") fail(context, `"power_formula" must be a table`);

  const baseRaw = r.base as Record<string, unknown>;
  if (!baseRaw || typeof baseRaw !== "object") fail(c, `field "base" must be a table`);
  const baseKind = requireOneOf(baseRaw.kind, ["primary_stat", "weapon_scaling"] as const, c, "base.kind");
  let base: StatSource;
  if (baseKind === "primary_stat") {
    const stat = requireOneOf<PrimaryStat>(baseRaw.stat, PRIMARY_STATS, c, "base.stat");
    base = { kind: "primary_stat", stat };
  } else {
    base = { kind: "weapon_scaling" };
  }

  const multipliersRaw = requireArray(r.multipliers, c, "multipliers");
  const multipliers = multipliersRaw.map((m, i) => {
    const mc = `${c} multipliers[${i}]`;
    const mr = m as Record<string, unknown>;
    const kind = requireString(mr?.kind, mc, "kind");
    if (!(BOUNDED_MULTIPLIER_KINDS as readonly string[]).includes(kind)) {
      fail(
        mc,
        `multiplier kind "${kind}" is not bounded — rule 10 forbids multiplying an unbounded factor ` +
          `(job_level, primary_stat, weapon_scaling) into a power formula. Only ${JSON.stringify(BOUNDED_MULTIPLIER_KINDS)} are legal here. ` +
          `Additive-only for stat/job-level; multiplicative only by bounded things.`,
      );
    }
    const value = requireNumber(mr?.value, mc, "value");
    return { kind: kind as (typeof BOUNDED_MULTIPLIER_KINDS)[number], value };
  });

  return { base, multipliers };
}

// ---------------------------------------------------------------------
// Effects / abilities
// ---------------------------------------------------------------------

function validateEffect(raw: unknown, context: string, index: number): Effect {
  const c = `${context} effects[${index}]`;
  const r = raw as Record<string, unknown>;
  const primitive = requireString(r?.primitive, c, "primitive");
  if (!(KNOWN_PRIMITIVES as readonly string[]).includes(primitive)) {
    fail(c, `unknown primitive "${primitive}" — known primitives: ${JSON.stringify(KNOWN_PRIMITIVES)}`);
  }
  const params = r?.params as Record<string, unknown>;
  if (!params || typeof params !== "object") fail(c, `"params" must be a table`);

  const pc = `${c} params`;
  let validatedParams: EffectParams;
  switch (primitive) {
    case "damage": {
      const powerFormula = validatePowerFormula(params.power_formula, pc);
      let channel: DamageChannel | undefined;
      if (params.channel !== undefined) {
        channel = requireOneOf<DamageChannel>(params.channel, ["physical", "magical", "true"] as const, pc, "channel");
      } else {
        channel = powerFormula.base.kind === "weapon_scaling" ? "physical" : "magical";
      }
      validatedParams = { powerFormula, channel };
      break;
    }
    case "heal": {
      const powerFormula = validatePowerFormula(params.power_formula, pc);
      validatedParams = { powerFormula };
      break;
    }
    case "apply_status": {
      const status = requireOneOf(params.status, KNOWN_STATUSES, pc, "status");
      const baseDuration = requireNumber(params.base_duration, pc, "base_duration");
      const baseMagnitude = requireNumber(params.base_magnitude, pc, "base_magnitude");
      validatedParams = { status, baseDuration, baseMagnitude };
      break;
    }
    case "shift_queue": {
      const direction = requireOneOf(params.direction, ["forward", "back"] as const, pc, "direction");
      const amount = requireNumber(params.amount, pc, "amount");
      validatedParams = { direction, amount };
      break;
    }
    case "modify_threat": {
      const amount = requireNumber(params.amount, pc, "amount");
      validatedParams = { amount };
      break;
    }
    case "buff":
    case "debuff": {
      const stat = requireOneOf<BuffableStat>(params.stat, [...PRIMARY_STATS, "threat"], pc, "stat");
      const magnitude = requireNumber(params.magnitude, pc, "magnitude");
      const durationTicks = requireNumber(params.duration_ticks, pc, "duration_ticks");
      validatedParams = { stat, magnitude, durationTicks };
      break;
    }
    default:
      // Unreachable: primitive was checked against KNOWN_PRIMITIVES above.
      fail(c, `unhandled primitive "${primitive}"`);
  }

  return { primitive: primitive as Effect["primitive"], params: validatedParams };
}

export function validateAbility(raw: unknown, knownTags: ReadonlySet<TagId>, context: string): Ability {
  const r = raw as Record<string, unknown>;
  const id = requireString(r?.id, context, "id") as AbilityId;
  const c = `ability "${id}" (${context})`;
  const name = requireString(r?.name, c, "name");

  const tagsRaw = requireArray(r?.tags, c, "tags");
  const tags = tagsRaw.map((t, i) => {
    const tag = requireString(t, c, `tags[${i}]`);
    if (!knownTags.has(tag)) fail(c, `unknown tag "${tag}" — not declared in tags.toml`);
    return tag;
  });

  const primaryDomainTag = requireString(r?.primary_domain_tag, c, "primary_domain_tag");
  if (!knownTags.has(primaryDomainTag)) fail(c, `unknown tag "${primaryDomainTag}" in primary_domain_tag`);
  if (!tags.includes(primaryDomainTag)) fail(c, `primary_domain_tag "${primaryDomainTag}" must be one of this ability's own tags`);

  const targetShape = requireOneOf<TargetShape>(r?.target_shape, ["self", "one", "row", "all"], c, "target_shape");
  const tickCost = requireNumber(r?.tick_cost, c, "tick_cost");
  const resourceCost = requireNumber(r?.resource_cost, c, "resource_cost");

  const effectsRaw = requireArray(r?.effects, c, "effects");
  if (effectsRaw.length === 0) fail(c, `"effects" must contain at least one effect`);
  const effects = effectsRaw.map((e, i) => validateEffect(e, c, i));

  return { id, name, tags, primaryDomainTag, targetShape, tickCost, resourceCost, effects };
}

// ---------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------

export function validateJob(
  raw: unknown,
  knownTags: ReadonlySet<TagId>,
  knownAbilityIds: ReadonlySet<AbilityId>,
  knownWeaponIds: ReadonlySet<WeaponArchetypeId>,
  context: string,
): Job {
  const r = raw as Record<string, unknown>;
  const id = requireString(r?.id, context, "id") as JobId;
  const c = `job "${id}" (${context})`;
  const name = requireString(r?.name, c, "name");

  const statGrowthRaw = r?.stat_growth as Record<string, unknown>;
  if (!statGrowthRaw || typeof statGrowthRaw !== "object") fail(c, `"stat_growth" must be a table`);
  const statGrowth = {} as Record<PrimaryStat, number>;
  for (const stat of PRIMARY_STATS) {
    statGrowth[stat] = requireNumber(statGrowthRaw[stat], c, `stat_growth.${stat}`);
  }

  const primaryTag = requireString(r?.primary_tag, c, "primary_tag");
  if (!knownTags.has(primaryTag)) fail(c, `unknown tag "${primaryTag}" in primary_tag`);

  const allowedTagsRaw = requireArray(r?.allowed_tags, c, "allowed_tags");
  const allowedTags = allowedTagsRaw.map((t, i) => {
    const tag = requireString(t, c, `allowed_tags[${i}]`);
    if (!knownTags.has(tag)) fail(c, `unknown tag "${tag}" in allowed_tags`);
    return tag;
  });

  const signatureRaw = requireArray(r?.signature_abilities, c, "signature_abilities");
  const signatureAbilities = signatureRaw.map((a, i) => {
    const abilityId = requireString(a, c, `signature_abilities[${i}]`);
    if (!knownAbilityIds.has(abilityId)) fail(c, `unknown ability "${abilityId}" in signature_abilities`);
    return abilityId;
  });

  const equipRaw = requireArray(r?.equip_proficiencies, c, "equip_proficiencies");
  const equipProficiencies = equipRaw.map((w, i) => {
    const weaponId = requireString(w, c, `equip_proficiencies[${i}]`);
    if (!knownWeaponIds.has(weaponId)) fail(c, `unknown weapon "${weaponId}" in equip_proficiencies`);
    return weaponId;
  });

  const defaultRow = requireOneOf<Row>(r?.default_row, ["front", "back"], c, "default_row");

  let threatProfile: Job["threatProfile"];
  if (r?.threat_profile !== undefined) {
    const tp = r.threat_profile as Record<string, unknown>;
    const baseThreatMultiplier = requireNumber(tp?.base_threat_multiplier, c, "threat_profile.base_threat_multiplier");
    threatProfile = { baseThreatMultiplier };
  }

  return {
    id,
    name,
    statGrowth: statGrowth as StatGrowth,
    primaryTag,
    allowedTags,
    signatureAbilities,
    equipProficiencies,
    defaultRow,
    threatProfile,
  };
}

// ---------------------------------------------------------------------
// Threat archetypes
// ---------------------------------------------------------------------

export function validateThreatArchetype(raw: unknown, knownTags: ReadonlySet<TagId>, context: string): ThreatArchetype {
  const r = raw as Record<string, unknown>;
  const id = requireString(r?.id, context, "id");
  const c = `threat archetype "${id}" (${context})`;
  const name = requireString(r?.name, c, "name");

  const tagsRaw = requireArray(r?.tags, c, "tags");
  const tags = tagsRaw.map((t, i) => {
    const tag = requireString(t, c, `tags[${i}]`);
    if (!knownTags.has(tag)) fail(c, `unknown tag "${tag}"`);
    return tag;
  });

  const powerTier = requireNumber(r?.power_tier, c, "power_tier");
  const scope = requireOneOf<ThreatScope>(r?.scope, ["world", "regional"], c, "scope");
  const rowLine = requireOneOf<Row>(r?.row_line, ["front", "back"], c, "row_line");
  const rowAttack = r?.row_attack === undefined ? undefined : Boolean(r.row_attack);
  const threatBehavior = requireOneOf<ThreatBehavior>(r?.threat_behavior, ["loyal", "opportunist", "assassin"], c, "threat_behavior");

  let counterMaterial: TagId | undefined;
  if (r?.counter_material !== undefined) {
    counterMaterial = requireString(r.counter_material, c, "counter_material");
    if (!knownTags.has(counterMaterial)) fail(c, `unknown tag "${counterMaterial}" in counter_material`);
  }

  return { id, name, tags, powerTier, scope, rowLine, rowAttack, threatBehavior, counterMaterial };
}

// ---------------------------------------------------------------------
// Weakness table
// ---------------------------------------------------------------------

export function validateWeaknesses(raw: unknown, knownTags: ReadonlySet<TagId>): WeaknessEntry[] {
  const context = "weaknesses.toml";
  const list = requireArray((raw as { weaknesses?: unknown })?.weaknesses, context, "weaknesses");
  return list.map((entry, i) => {
    const c = `${context} weaknesses[${i}]`;
    const e = entry as Record<string, unknown>;
    const tag = requireString(e?.tag, c, "tag");
    const weakness = requireString(e?.weakness, c, "weakness");
    if (!knownTags.has(tag)) fail(c, `unknown tag "${tag}"`);
    if (!knownTags.has(weakness)) fail(c, `unknown tag "${weakness}" in weakness`);
    return { tag, weakness };
  });
}
