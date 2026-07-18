import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type {
  Ability,
  AbilityId,
  Job,
  JobId,
  TagDef,
  TagId,
  ThreatArchetype,
  ThreatArchetypeId,
  WeaknessEntry,
  WeaponArchetype,
  WeaponArchetypeId,
} from "./types.js";
import type { Grammar } from "./grammar/types.js";
import { validateAbility, validateJob, validateTags, validateThreatArchetype, validateWeaknesses, validateWeapons } from "./validate.js";
import { validateGrammar } from "./grammar/validate.js";

/**
 * Port interface (dependency-inversion, same pattern as OraclePort):
 * consumers depend on this, never on the TOML file layout. A concrete
 * implementation (loadContentFromDir) sits behind it.
 */
export interface ContentPort {
  getTag(id: TagId): TagDef;
  listTags(): readonly TagDef[];

  getJob(id: JobId): Job;
  listJobs(): readonly Job[];

  getAbility(id: AbilityId): Ability;
  listAbilities(): readonly Ability[];

  getWeaponArchetype(id: WeaponArchetypeId): WeaponArchetype;
  listWeaponArchetypes(): readonly WeaponArchetype[];

  getThreatArchetype(id: ThreatArchetypeId): ThreatArchetype;
  listThreatArchetypes(): readonly ThreatArchetype[];

  /** Looks up the ONE authored weakness table for a set of tags (e.g. a threat archetype's tags). Composition of tags composes weaknesses. */
  getWeaknessesFor(tags: readonly TagId[]): readonly TagId[];

  getGrammar(id: string): Grammar;
  listGrammars(): readonly Grammar[];
}

function readTomlFile(path: string): unknown {
  return parseToml(readFileSync(path, "utf8"));
}

function listTomlFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".toml"))
    .map((f) => join(dir, f))
    .sort();
}

/**
 * Loads and validates all content from a directory laid out as:
 *   tags.toml, weapons.toml, threatArchetypes.toml, weaknesses.toml
 *   jobs/*.toml        — one job per file
 *   abilities/*.toml   — one ability per file
 *   grammars/*.toml    — one grammar per file
 *
 * Hot-loadable: adding a new file under jobs/ or abilities/ and calling
 * this again picks it up with zero code changes (Gate 1). Every entity
 * is validated eagerly; a malformed one throws immediately with a
 * descriptive message (Gate 6) — never a silent skip.
 */
export function loadContentFromDir(dir: string): ContentPort {
  const tagDefs = validateTags(readTomlFile(join(dir, "tags.toml")));
  const knownTags = new Set(tagDefs.map((t) => t.id));
  const tagsById = new Map(tagDefs.map((t) => [t.id, t]));

  const weapons = validateWeapons(readTomlFile(join(dir, "weapons.toml")));
  const weaponsById = new Map(weapons.map((w) => [w.id, w]));
  const knownWeaponIds = new Set(weapons.map((w) => w.id));

  const abilities = listTomlFiles(join(dir, "abilities")).map((path) =>
    validateAbility(readTomlFile(path), knownTags, path),
  );
  const abilitiesById = new Map(abilities.map((a) => [a.id, a]));
  const knownAbilityIds = new Set(abilities.map((a) => a.id));

  const jobs = listTomlFiles(join(dir, "jobs")).map((path) =>
    validateJob(readTomlFile(path), knownTags, knownAbilityIds, knownWeaponIds, path),
  );
  const jobsById = new Map(jobs.map((j) => [j.id, j]));

  const threatArchetypesRaw = readTomlFile(join(dir, "threatArchetypes.toml")) as { archetypes: unknown[] };
  const threatArchetypes = threatArchetypesRaw.archetypes.map((raw, i) =>
    validateThreatArchetype(raw, knownTags, `threatArchetypes.toml archetypes[${i}]`),
  );
  const threatArchetypesById = new Map(threatArchetypes.map((a) => [a.id, a]));

  const weaknesses = validateWeaknesses(readTomlFile(join(dir, "weaknesses.toml")), knownTags);
  const weaknessesByTag = new Map<TagId, TagId[]>();
  for (const entry of weaknesses) {
    const list = weaknessesByTag.get(entry.tag) ?? [];
    list.push(entry.weakness);
    weaknessesByTag.set(entry.tag, list);
  }

  const grammars = listTomlFiles(join(dir, "grammars")).map((path) => validateGrammar(readTomlFile(path), path));
  const grammarsById = new Map(grammars.map((g) => [g.id, g]));

  function mustGet<T>(map: Map<string, T>, id: string, kind: string): T {
    const value = map.get(id);
    if (!value) throw new Error(`ContentPort: unknown ${kind} "${id}"`);
    return value;
  }

  return {
    getTag: (id) => mustGet(tagsById, id, "tag"),
    listTags: () => tagDefs,

    getJob: (id) => mustGet(jobsById, id, "job"),
    listJobs: () => jobs,

    getAbility: (id) => mustGet(abilitiesById, id, "ability"),
    listAbilities: () => abilities,

    getWeaponArchetype: (id) => mustGet(weaponsById, id, "weapon archetype"),
    listWeaponArchetypes: () => weapons,

    getThreatArchetype: (id) => mustGet(threatArchetypesById, id, "threat archetype"),
    listThreatArchetypes: () => threatArchetypes,

    getWeaknessesFor: (tags) => {
      const result = new Set<TagId>();
      for (const tag of tags) {
        for (const weakness of weaknessesByTag.get(tag) ?? []) result.add(weakness);
      }
      return [...result];
    },

    getGrammar: (id) => mustGet(grammarsById, id, "grammar"),
    listGrammars: () => grammars,
  };
}
