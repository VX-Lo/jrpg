# CLAUDE.md — Hollowmark

## Read this before any action. Update it after any action.

## Current state
- **Phase:** 3 — content schema and grammar engine
- **Status:** core schema, loader, and grammar engine built. All 6 gates passing (73/73 tests total, tsc/eslint clean). Not yet committed/pushed this session.
- **Last action:** Wrote and passed all 6 Phase 3 gates (hot-load, new-ability composition, grammar determinism, formula safety, tag checks, validation-fails-loud). Fixed a real cross-test-file contamination bug: writing fixture files into the shared `content/` directory let concurrently-running test files see each other's temp files, since `loadContentFromDir` scans the whole directory — fixed with `test/content/tempContentDir.ts`, which copies content into an isolated OS temp dir per test.
- **Next action:** Update CLAUDE.md's full architecture/decisions/stubs sections, commit, push, confirm CI green.

## Phase 3 summary (complete, do not reopen without cause)
Content schema and grammar engine: effect-primitive/Ability/Job/Tag/WeaponArchetype/ThreatArchetype schemas, a `ContentPort` TOML loader with loud validation, and a seeded Tracery-style grammar engine (weighted rules + kernel-aware `#kernelRoot#` expansion). Ability power is additive-then-bounded-multiply (rule 10), enforced at load. 4 fixture jobs, 8 fixture abilities (one per primitive, one composing two), 4 weapons, 5 threat archetypes (ids matching Phase 2's boss-placement fixture list), a 3-entry weakness table, 14 fixture tags, 5 fixture grammars (4 kernels + 1 commodity demo). All 6 gates green (23 content tests + 50 Phase 1/2 tests = 73 total). See `packages/engine/src/content/` and `packages/engine/content/`.

## Phase 2 summary (complete, do not reopen without cause)
World generator: `worldgen(seed, tierIndex) → Tier`, fenced to exactly those 2 parameters. Config module, band curve (superlinear, Gate 3), 4 fixture region kernels, node-graph generation with guaranteed reachability, dungeon clusters, factions (bare reputation scalar), generated NPCs, boss placement with a ThreatArchetype reference. CLI pretty-printer for balance work at depth. All 6 gates green locally and in CI (GitHub Actions run 29630367237, commit afe4bb6). See `packages/engine/src/worldgen/` and git history for detail.

## Phase 1 summary (complete, do not reopen without cause)
Determinism substrate: SplitMix64 PRNG + FNV-1a key-hashed substreams, append-only event log, OraclePort, dev harness/CLI. All 5 gates green locally and in CI (GitHub Actions run 29621644363, commit aa4ac84). See `packages/engine/src/{rng,log,oracle,harness}` and git history for detail — not re-documented here to keep this file current-focused.

## Project rules (never violate)
1. Determinism: same seed + inputs = bit-identical log. Tested, not assumed.
2. Generator, not database: derivable from seed → not stored.
3. Oracles logged, never recomputed.
4. Engine package: ZERO DOM, ZERO React. Enforced by lint/boundary.
5. No Math.random(), no Date.now(), no ambient state in the engine. Ever.

## Architecture
- Monorepo root uses npm workspaces (no extra tooling needed at this size). Root `package.json` has `"type": "module"`.
- `packages/engine` — pure TypeScript engine package. No DOM lib, no React. Node-testable only.
  - `src/rng/` — `fnv1a.ts` (FNV-1a 64-bit hash), `splitmix64.ts` (`Rng` class + `createRng`), `index.ts` (barrel)
  - `src/log/` — `types.ts` (`Event`), `writer.ts` (`EventLogWriter`), `reader.ts` (`EventLogReader`), `replayer.ts` (`replay`), `serializer.ts` (`serializeLog`/`deserializeLog`, BigInt-safe), `index.ts`
  - `src/oracle/` — `types.ts` (`OraclePort`), `liveOracle.ts`, `replayOracle.ts`, `mockOracle.ts` (`createCountingOracleSource`), `index.ts`
  - `src/harness/` — `types.ts` (`GameState`/`TierSpec`/`PartySpec` stubs), `state.ts` (`constructState`), `demoScenario.ts` (Phase-1-only fixture, NOT game content), `cli.ts` (generate/replay/diff), `index.ts`
  - `test/` — vitest suites: `rng.test.ts`, `log.test.ts`, `gate1.replay.test.ts`, `gate2.perturbation.test.ts`, `gate3.oracle.test.ts`, `gate5.boundary.test.ts` (Gate 4 covered inside `log.test.ts`'s round-trip tests)
- `.github/workflows/ci.yml` — runs `eslint .`, `npm run build --workspace packages/engine` (tsc), `npm run test --workspace packages/engine` (vitest) on push to main and on PRs. Uses Node 20 (local dev used Node 18.20.8 — works, but some devDependency engines warn below 20; CI pins 20 to be clean).
- Substream key convention: `domain:scope:id:purpose`, e.g. `worldgen:tier:5:regions`. Keys are hashed directly (via FNV-1a 64-bit) into a SplitMix64 seed — no sequential derivation, ever.
- Hash function: FNV-1a, 64-bit, integer-only (BigInt), operating on UTF-8 bytes. A few lines of pure integer arithmetic with a fixed, documented spec — no platform-dependent float or crypto-library behavior. `deriveSeed(parentSeed, key)` hashes `u64ToBytes(parentSeed) || utf8(key)`.
- PRNG core: SplitMix64 (BigInt arithmetic only, masked to 64 bits throughout). Each `Rng` instance stores its own immutable `seed` separately from its mutable advancing `state` — `substream(key)` derives the child from `this.seed` (never from wherever the draw cursor happens to be), which is *why* Gate 2 holds: independent of call count and call order.
- `createRng(seed)` accepts `bigint | number | string` — numbers/bigints seed directly (masked to 64 bits), strings are hashed via `deriveSeed(0n, seed)`.
- `nextInt(bound)` uses rejection sampling against 2^64 (not modulo) for unbiased output — still fully deterministic, just consumes a variable, seed-determined number of draws.
- Event log shape: `{ seq: number, tick: number, type: string, payload: unknown }`. `seq` assigned monotonically at append time by `EventLogWriter`; `tick` is the universal game clock — drives all downstream time-based derivation (faction updates, market drift, event rolls) starting Phase 2+. Log is append-only; nothing is ever mutated or removed post-append.
- Serializer tags BigInt values as `{ __bigint__: "123" }` via a JSON replacer/reviver, since payloads legitimately contain BigInts (seeds, 64-bit draws) and plain `JSON.stringify` throws on them.
- Ports defined so far: `OraclePort<In, Out>` with `query(input): Out`. `LiveOracle` invokes the source and appends `{input, output}` under a caller-chosen event `type`; `ReplayOracle` reads events of that same type back in order and throws (does not silently fall back to live) if queried past what was logged.
- `GameState` shape: `{ seed, rng, log, tick, tier, partySpec }`. `tier` is now the REAL generated `Tier` (Phase 2's worldgen output), not a stub — `constructState(seed, tierSpec, partySpec)` calls `worldgen(seed, tierSpec.tierIndex)` internally. `TierSpec` is now just the input `{ tierIndex: number }`.
- CLI (`packages/engine` → `npm run cli -- <command>` or `npx tsx src/harness/cli.ts <command>`):
  - `generate <seed> [outFile]` — constructs state (tier 1), draws from a named substream, writes/prints the serialized log (Phase 1's demo scenario was deleted and replaced with an inline substream draw once real worldgen existed — see Decisions)
  - `replay <logFile>` — deserializes a log and folds it into a trivial `{eventCount, lastTick}` summary via `replay()`
  - `diff <fileA> <fileB>` — byte-compares two serialized logs, reports first differing offset, exit code 0/1
  - `gen --seed X --tier N [--print]` — Phase 2. Calls `worldgen(seed, tierIndex)` directly; `--print` renders `prettyPrintTier()` (human-readable), otherwise dumps `serializeTier()` JSON. This is how Gate 6 and all future balance work get done — runs are too long to play to deep tiers.

## Phase 2 architecture — world generator (`packages/engine/src/worldgen/`)
- **THE FENCE:** `worldgen(seed: bigint|number|string, tierIndex: number): Tier` — exactly 2 parameters, enforced structurally (nothing downstream receives party/meta/run-state) and by an arity tripwire test (`worldgen.length === 2`) in `test/worldgen/gate2.colddepth.test.ts`.
- `config.ts` — every tunable constant, documented, several marked UNCALIBRATED. `BAND_GROWTH = 1.4` (must stay > 1, see its doc comment — this is the single number the whole meta-progression system rests on).
- `types.ts` — `Tier`, `Region`, `WorldNode`, `WorldEdge`, `DungeonCluster`, `Faction`, `Npc`, `RegionKernel`, `ThreatArchetypeRef`, `EconomicAxis`.
- `band.ts` — `band(tierIndex) = round(BAND_BASE * tierIndex^BAND_GROWTH)`. Pure function of tierIndex only. Uses `Math.pow`/`Math.round` (float) deliberately — unlike the RNG/hash core, band() is never stored (rule #2: derivable from seed, recomputed every time) so it doesn't need cross-platform-forever bit-stability, only purity within one process. Documented in the code.
- `kernels/` — 4 fixture `RegionKernel`s (Fen, Cinderreach, Hollow, Canopy), each with lexicon roots, 1-2 boundary roots shared with a ring-adjacent neighbor, an economic axis, a puzzle-affinity tag, an arc-pool tag, and curated (hand-written, not grammar-concatenated) name pools of ~12 entries each for settlements/npcs/factions/landmarks. Full 15-25 kernel set is Phase 3.
- `kernelAssignment.ts` — **deviates from the suggested per-region substream key.** Kernel exclusivity (no two regions in one tier share a kernel — needed since only 4 fixture kernels exist and a collision would produce duplicate proper nouns, which Gate 1 forbids) is a tier-scoped fact, so it's one coordinating draw at `worldgen:tier:{n}:regions:kernels` (a shuffle-and-take, without replacement) rather than independent per-region draws. Documented in the code; flagged to the user as a judgment call, not blocked on.
- `nodes.ts` — node-kind budget per region (`computeNodeKindCounts`, fractions from config, settlement count floored at 1), node 0 always forced to be a settlement (the region's entry point), names drawn without replacement from the kernel's curated pools.
- `edges.ts` — weighted region graph: random spanning tree (guarantees full reachability from node 0) + extra edges for cycles/texture. Landmark-endpoint edges draw from a wider weight range (`EDGE_WEIGHT_REMOTE_MAX_TICKS`) — this is the whole mechanism for "high peaks are slow," no special-casing beyond node-kind-keyed range selection.
- `dungeon.ts` — multi-level node clusters hanging off `dungeonEntrance` nodes. NOT counted toward the region's 24-node-tier budget (an appendage, not part of the region's own graph). Depth-node names derive from the (already tier-unique) parent name, so no separate curated pool is needed.
- `factions.ts` / `npcs.ts` — factions are name + home region + `reputation: 0`, nothing else (no territory/diplomacy/simulation — that's Phase 7's fence too). NPCs: curated name + origin region + one trait + one job, drawn from small generic fixture trait/job pools (not proper nouns, no uniqueness requirement).
- `boss.ts` — exactly one boss per tier: picks a region, then a landmark node within it (never a settlement — every region always has ≥1 landmark by construction), marks `isBoss: true`, attaches a `ThreatArchetypeRef` (an ID string from a 5-entry fixture list in config — Phase 5 implements the mechanical guts). No quest chain built to it (Phase 4's job).
- `worldgen.ts` — orchestrator. Builds one root `Rng` from `seed`, threads it through `rollShape` → `assignKernels` → `generateRegion` (×N) → `placeBoss`/`applyBoss`. A fresh root is constructed every call — nothing cached across calls, which is what makes Gate 2 hold.
- `serialize.ts` — `serializeTier(tier)`, a BigInt-safe `JSON.stringify` for byte-identical comparisons in gates.
- Substream keys actually used (deviates from the prompt's suggested list only in `regions:kernels`, see above): `worldgen:tier:{n}:shape`, `worldgen:tier:{n}:regions:kernels`, `worldgen:tier:{n}:region:{i}:nodes`, `worldgen:tier:{n}:region:{i}:edges`, `worldgen:tier:{n}:region:{i}:dungeon:{entranceNodeId}:cluster`, `worldgen:tier:{n}:region:{i}:factions`, `worldgen:tier:{n}:region:{i}:npcs`, `worldgen:tier:{n}:boss`. No `worldgen:tier:{n}:band` key — band is a pure formula, nothing to draw.

## Phase 3 architecture — content schema and grammar engine (`packages/engine/src/content/`, content in `packages/engine/content/`)
- **THE CENTRAL COMMITMENT:** `Ability.effects: Effect[]`, each `Effect` referencing a `PrimitiveId` + `params`, never bespoke code. 7 primitives implemented (`damage`, `heal`, `apply_status`, `shift_queue`, `modify_threat`, `buff`, `debuff`) — the full candidate list from the design doc, nothing more, all earned by a fixture ability. See `src/content/primitives.ts`.
- `types.ts` — `Ability`, `Job`, `WeaponArchetype`, `ThreatArchetype`, `TagDef`, `PowerFormula`/`StatSource`/`PowerMultiplier`, all `Effect`-params interfaces. Deliberately NO `reach` field on `Ability` — reach is derived from the equipped weapon at resolution time (D6), never stored.
- `primitives.ts` — `KNOWN_PRIMITIVES` (7), `KNOWN_STATUSES` (sleep/slow/poison/oiled, small hardcoded fixture, same scope tier as Phase 2's NPC trait/job lists — not TOML this phase), `BOUNDED_MULTIPLIER_KINDS` (constant/crit/elemental — legal) vs `UNBOUNDED_MULTIPLIER_KINDS` (job_level/primary_stat/weapon_scaling — exist in the `MultiplierKind` type ONLY so an ability can attempt one and the loader has something concrete to reject; see Gate 4).
- `formula.ts` — `computeAbilityPower({relevantStatValue, jobLevel, hasMasteryMatch, formula})`: `(relevantStat + (hasMasteryMatch ? jobLevel * JOB_LEVEL_BONUS_PER_LEVEL : 0)) * product(boundedMultipliers)`. Additive between stat and job-level; multiplicative only by bounded things — rule 10, executable.
- `access.ts` — `canEquip(job, ability)`: signature abilities bypass the tag check entirely; otherwise OVERLAP between `ability.tags` and `job.allowedTags` (never full containment). `hasMasteryBonus(job, ability)`: exact match between `ability.primaryDomainTag` and `job.primaryTag`. Two distinct checks, never conflated.
- `validate.ts` — one validator per entity type, every violation throws a descriptive `Error` (context + field + what was wrong). This is where rule 10 is actually enforced (`validatePowerFormula` rejects any multiplier not in `BOUNDED_MULTIPLIER_KINDS`).
- `loader.ts` — `ContentPort` interface (dependency-inversion, same pattern as `OraclePort`) + `loadContentFromDir(dir)`. Reads `tags.toml`/`weapons.toml`/`threatArchetypes.toml`/`weaknesses.toml` (single files, array-of-tables) and `jobs/*.toml`/`abilities/*.toml`/`grammars/*.toml` (one file per entity — this is what makes hot-load "add a file" instead of "edit a file"). `getWeaknessesFor(tags)` composes the one authored weakness table over however many tags an archetype carries (the obfuscation mechanism — see threatArchetypes.toml's `ambusher`, tagged both `undead` and `ashborn`, drawing two weaknesses from one flat table).
- `grammar/` — `types.ts` (`Grammar`, `RuleExpansion` — string or `{text, weight}`), `engine.ts` (`expandGrammar(grammar, rootSymbol, rng)`: Tracery-model symbol expansion, own implementation against `Rng`, no library — weighted pick via `rng.nextInt`/`nextFloat`; reserved `#kernelRoot#` symbol pulls from Phase 2's `KERNELS[].lexiconRoots` by `grammar.kernelId`; `pickFromPool(pool, rng)`: uniform pick for curated proper nouns, the OTHER consumer), `validate.ts` (checks every `#symbol#` reference resolves to a declared rule or `#kernelRoot#` at load time — fail loud, not at first expansion).
- Fixture content: `tags.toml` (14: martial/defense/support/control roles; fire/frost/holy/shadow/poison/physical/undead/aquatic/ashborn/silver domains), `weapons.toml` (4: sword/mace/staff/bow), `threatArchetypes.toml` (5, ids matching `worldgen/config.ts`'s `THREAT_ARCHETYPE_IDS` so Phase 2's boss placement now resolves to real content), `weaknesses.toml` (3: undead→holy, ashborn→frost, aquatic→fire), `jobs/` (warrior/mage/sentinel/warden — martial front-liner, caster, tank w/ threat profile, hybrid), `abilities/` (8, one per primitive plus one composing two), `grammars/` (4 kernel flavor-text grammars + 1 commodity-grammar demo for Phase 6).
- Config additions (`worldgen/config.ts`, kept in the one calibration home per instruction): `EQUIP_CAP = 6` (hard loadout size, UNCALIBRATED exact value; nothing enforces it yet — no loadout system exists to constrain, that's Phase 5's job), `JOB_LEVEL_BONUS_PER_LEVEL = 1` (UNCALIBRATED coefficient for the mastery bonus).
- Weapon geometry rule (D6, documented here since nothing enforces it yet — Phase 5's job): melee targets the enemy front row unless it's empty, then reaches back; ranged targets either row. Reuses the row system — no separate "no melee from the back" rule needed.
- Substream keys used: `grammar:{grammarId}:{contextKey}` (caller derives via `root.substream(...)` before calling `expandGrammar`/`pickFromPool` — the grammar engine itself never constructs its own keys, matching the pattern established in worldgen where sub-generators receive an already-substreamed `Rng`).
- Test isolation fix: `test/content/tempContentDir.ts`'s `withTempContentDir()` copies the real content directory into an OS temp dir per test before mutating it. Writing fixture files directly into the shared `content/` dir (mirroring Phase 1/2's boundary-fixture pattern) caused real cross-test-file contamination under vitest's parallel file execution, since `loadContentFromDir` scans the whole directory — one test's temp file was visible to every other concurrently-running test file's load call. Fixed once, documented so nobody reintroduces it.

## Phase 3 — full candidate tag list (documented, not implemented — the later content pass trims/extends this)
Domains (~30 candidates; 10 implemented as fixtures: fire, frost, holy, shadow, poison, physical, undead, aquatic, ashborn, silver): lightning, earth, wind, arcane, nature, blood, crystal, void, verdant, molten, frozen, spectral, feral, mechanical, corrupted, radiant, glacial, volcanic, toxic, primal.
Roles (~10 candidates; 4 implemented as fixtures: martial, defense, support, control): offense, utility, mobility, healing, summon, ranged.

## Phase 1 deliverables
- [x] Splittable PRNG, key-hashed substreams (NOT sequential splitting)
- [x] Event log: writer, reader, replayer, serializer
- [x] OraclePort + mock oracle
- [x] Dev harness: constructState(seed, tier, partySpec) + CLI

## Gates (Phase 1 is not done until all pass in CI)
- [x] Gate 1: byte-identical replay across many seeds — `test/gate1.replay.test.ts`, 9 seeds incl. edge cases (negative, >2^53, 2^64-1)
- [x] Gate 2: PERTURBATION TEST — new substream consumer does not perturb existing output — `test/gate2.perturbation.test.ts`, 4 sub-tests incl. order-independence
- [x] Gate 3: oracle replay never invokes the source — `test/gate3.oracle.test.ts`, asserts a `vi.fn()` spy call count stays flat across replay, plus a hard-error test for over-querying
- [x] Gate 4: log serialize round-trip — covered in `test/log.test.ts` (BigInt payloads included)
- [x] Gate 5: boundary lint fails on DOM/React import — `test/gate5.boundary.test.ts`, writes a real violating fixture, shells to `eslint`/`tsc`, asserts nonzero exit, deletes fixture in `finally`
- Verified locally (31 tests passing, `tsc --noEmit` clean, `eslint .` clean) AND in CI: `.github/workflows/ci.yml` ran on push to main and completed with `conclusion: success` (run 29621644363).

## Phase 2 deliverables
- [x] Calibration config module
- [x] Tier generation (shape, band, exactly one boss node placed)
- [x] Regions and kernels (4 fixtures incl. the Fen, boundary roots, economic axis assigned)
- [x] Node graph (settlements/dungeon entrances/landmarks, weighted edges, reachability)
- [x] Factions and NPCs (reputation scalar only; curated-pool names)
- [x] Dev harness extension: `TierSpec`/`constructState` wired to real `worldgen()`, CLI pretty-printer (`gen --seed --tier --print`)

## Phase 2 gates (not done until all pass in CI)
- [x] Gate 1: volume — `test/worldgen/gate1.volume.test.ts`, 1000 seeds × varied tier indices (1-80), `validateTier()` (src/worldgen/validate.ts) checks reachability, settlement/faction minimums, node-budget match, exactly-one-boss, dungeon-cluster-parent linkage, and tier-wide duplicate proper nouns
- [x] Gate 2: COLD-DEPTH TEST — tier 40 generates directly, byte-identical regardless of other tiers generated in between (`test/worldgen/gate2.colddepth.test.ts`)
- [x] Gate 3: band monotonicity + superlinear growth — fitted exponent via log-log regression across 50 tiers, asserted > 1 (`test/worldgen/gate3.band.test.ts`)
- [x] Gate 4: determinism — `test/worldgen/gate4.determinism.test.ts`, 9 seed/tier combos incl. deep (tier 1000) and edge-case seeds (0, 2^64-1)
- [x] Gate 5: perturbation (real consumer) — `test/worldgen/gate5.perturbation.test.ts`, reimplements worldgen's call sequence with two genuinely new substream keys spliced in (`region:{i}:weather`, `tier:{n}:omen`), asserts byte-identical output vs. real `worldgen()`
- [x] Gate 6: spot-check — pretty-print 5 seeds, human read, verdict recorded below (not automated)

## Gate 6 spot-check verdict (human judgment, recorded 2026-07-17)
Ran `gen --seed X --tier N --print` on 5 seed/tier combos spanning shallow to deep: (1, tier 1), (42, tier 1), (999, tier 10), (123456789, tier 25), (7, tier 40), plus (55555, tier 8) for a 6th look. **Verdict: yes, this reads as a place — with caveats appropriate to a 4-kernel fixture set.**

What worked:
- Each kernel's lexicon is internally consistent and reads as a coherent place: the Fen (Saltmere, Weirhaven, The Drowned Orchard, Marrow Reef) feels like a wetland; Cinderreach (Sootgate, Slagfall Terrace, The Great Kiln) feels like a forge-town; the effect the design doc wants from curated (not concatenated) pools is visible.
- Faction and NPC names land as plausible, not formulaic — "Tideford Trading Co." and "Delia Brand — trapper, quick to anger" read like a name and a person, not `[adjective][noun][role]`.
- Band scaled exactly as expected across the sample: tier 1 → 3, tier 8 → 55, tier 10 → 75, tier 25 → 272, tier 40 → 525 — visibly superlinear, matches Gate 3's automated check.
- Structure held at every depth sampled, including tier 40 (no crash, no degenerate shape) — consistent with Gate 1/2's automated results, now confirmed by eye.
- Boss placement always landed on a landmark (never a settlement), varied region and archetype across samples (sentinel/caster/ambusher/bruiser) — reads as "a specific dangerous place," not a generic marker.

Caveats (expected, not blocking, flagged so nobody mistakes them for bugs later):
- With only 4 kernels, a tier's "world" is always some subset of the same 4 places — no cross-tier surprise yet. This is explicitly a Phase 3 concern (full 15-25 kernel set); noted in Stubs/deferred.
- Boundary-root "bleed" (kernels sharing 1-2 lexicon roots with a neighbor) is declared in the kernel data but nothing yet *uses* it to blend names at region edges — correct scope for this phase (only asked to declare it), but worth flagging so it isn't forgotten when kernel-adjacency logic gets built.
- Edge weights (travel ticks) have no visible narrative texture yet (a 1-tick and a 30-tick edge look the same in the printout beyond the number) — fine for Phase 2, will matter once Phase 5+ makes tick cost legible to the player.

Net: kernels are not wrong, the pipeline produces coherent, readable output at every depth tested. Recommend proceeding; if the user disagrees on the "place I'd want to be" call after reviewing themselves, that's a design conversation, not a bug fix.

## Phase 3 deliverables
- [x] TOML content loader (`ContentPort`), hot-loadable, validates on load, fails loud
- [x] Job/class schema (stat_growth, primary_tag, allowed_tags, signature_abilities, equip_proficiencies, default_row, optional threat_profile) + equip cap in config
- [x] Tag system (one flat vocabulary, overlap access vs. primary-match mastery, both tested)
- [x] Seeded grammar engine (Tracery model against Rng, weighted rules, kernel-aware `#kernelRoot#` expansion) + curated-pool pick
- [x] Threat archetype schema (tagged not counted, one authored weakness table, world/regional scope)
- [x] Weapon archetype schema (reach + scaling stat live on the weapon, not the ability/class)

## Phase 3 gates (not done until all pass in CI)
- [x] Gate 1: hot-load a new class with zero code changes — `test/content/gate1.hotload.test.ts`, writes a real new job+ability TOML pair into an isolated content-dir copy, asserts loadable/equippable/resolves
- [x] Gate 2: new ability from existing primitives, zero engine changes — `test/content/gate2.new-ability.test.ts`, a new `damage`+`apply_status` composition, asserts correct power computation
- [x] Gate 3: grammar determinism — `test/content/gate3.grammar-determinism.test.ts`, same substream key ⇒ byte-identical expansion, across grammar/kernel-root/pool-pick/commodity-grammar consumers
- [x] Gate 4: formula safety (rule 10) — `test/content/gate4.formula-safety.test.ts`, feeds the loader 3 unbounded-multiplier cases (job_level/primary_stat/weapon_scaling) + 1 positive control, all correct
- [x] Gate 5: tag checks — `test/content/gate5.tag-checks.test.ts`, overlap access and primary-match mastery asserted separately (both the boolean and the numeric power delta), plus signature-bypass and real-fixture (Warrior/Mage vs. Cleave) cases
- [x] Gate 6: validation fails loud — `test/content/gate6.validation.test.ts`, 5 cases: missing required field, unknown primitive, unknown tag, unknown weapon scaling stat, unknown ability reference in signature_abilities
- Verified locally: 73 tests total (23 new + 50 from Phase 1/2), `tsc --noEmit` clean, `eslint .` clean. Not yet confirmed in CI this session.

## Decisions made
- 2026-07-17 — Repo was essentially empty (only README + .gitignore). Starting Phase 1 from scratch per prompt.
- 2026-07-17 — Using npm workspaces (already have npm 10.8.2 / node 18.20.8 available) rather than pnpm/yarn, to minimize new tooling surface. `packages/engine` is the only package created this phase.
- 2026-07-17 — Boundary enforcement via `tsconfig.json` `"lib": ["ES2022"]` (no `"dom"`) on the engine package, PLUS an ESLint `no-restricted-imports`/`no-restricted-globals`/`no-restricted-syntax` rule blocking `react`/`react-dom`, DOM globals (`window`/`document`/`navigator`/`localStorage`/`sessionStorage`), and `Math.random()`/`Date.now()`/`new Date()`. Belt and suspenders: TS lib omission catches DOM *type* usage, ESLint catches imports and nondeterminism calls that don't require DOM types to fail (e.g. `Math.random()` is valid under any lib).
- 2026-07-17 — Hash function: FNV-1a 64-bit over UTF-8 bytes, BigInt arithmetic, no crypto module. Simple, stable, integer-only, platform-independent forever.
- 2026-07-17 — Test runner: vitest (fast, ESM-native, works headlessly in Node — fits "pure TS, no browser" constraint).
- 2026-07-17 — Root `package.json` has `"type": "module"` so the ESLint flat config (`eslint.config.js`) loads as ESM under Node 18. Boundary rule proven live twice: once manually via a throwaway probe file (deleted after confirming failure), and again automatically in `test/gate5.boundary.test.ts` (writes fixture → asserts eslint/tsc both fail → deletes fixture, every CI run).
- 2026-07-17 — `Rng.substream(key)` derives from the stream's own immutable `seed` field, not its mutable `state` cursor — the specific design choice that makes Gate 2 hold (independent of draw count/order).
- 2026-07-17 — `nextInt` uses rejection sampling (not modulo) for unbiased results; still deterministic, since the number of extra draws consumed is itself a pure function of the seed.
- 2026-07-17 — CLI implemented with Node's `node:fs`/`node:child_process` etc. This is I/O at the harness boundary (reading seed args, writing/reading log files), not part of the pure simulation core (`state.ts`/`demoScenario.ts` remain pure) — consistent with "purity in the core, I/O at the edges."
- 2026-07-17 — `demoScenario.ts` is explicitly a Phase-1-only fixture to give the CLI/gates something to generate against, since no real worldgen/combat exists yet. It is not game content and should be deleted/replaced once Phase 2+ lands.
- 2026-07-17 — CI pinned to Node 20 (vs. locally-available Node 18.20.8) because one ESLint transitive devDependency (`eslint-visitor-keys@5`) warns below Node 20; everything still worked on 18 locally, but CI uses the cleaner version.
- 2026-07-17 — Phase 2: kernel assignment per tier is a single without-replacement draw at `worldgen:tier:{n}:regions:kernels`, not independent per-region draws. Reasoning: only 4 fixture kernels exist this phase, and MAX_REGIONS_PER_TIER is also 4 — independent per-region draws would let two regions in the same tier land on the same kernel, colliding their curated name pools and producing duplicate proper nouns, which Gate 1 explicitly forbids. Flagged as a deviation from the prompt's suggested key list rather than blocking to ask, since the prompt itself both requires no-duplicate-proper-nouns and acknowledges the kernel pool is fixture-sized this phase — the without-replacement approach is the only one consistent with both constraints at this pool size. Once Phase 3 ships 15-25 kernels, independent per-region draws become safe again and this can revert if desired.
- 2026-07-17 — `band()` uses floating-point (`Math.pow`/`Math.round`) rather than integer-only arithmetic, unlike the RNG/hash core. Reasoning: band is derived data (rule #2: never stored, always recomputed from tierIndex), so it doesn't need the RNG/hash's cross-platform-forever bit-stability guarantee (that guarantee exists specifically because save files must replay identically on potentially different machines/engine versions years later) — it only needs to be a pure function of tierIndex within one running process, which floating-point trivially satisfies. Documented in `band.ts` and `config.ts` so this isn't mistaken for an oversight later.
- 2026-07-17 — Dungeon cluster nodes are NOT counted toward a region's 24-node-tier budget. Reasoning: the design doc describes dungeon entrances as "hanging" a cluster off a local node — read as an appendage to the region graph, not part of it, so Gate 1's "node count matches budget exactly" check is about the top-level 24 only. Cluster nodes get their own internal reachability check instead (dungeon cluster connected to its parent).
- 2026-07-17 — Node 0 in every region is deterministically forced to be a settlement (the region's entry point / main town), rather than letting node-kind shuffle place the entry point on a landmark or dungeon entrance. Not specified in the prompt; chosen because it reads more like a place (you always arrive in a town) and costs nothing (settlements are always ≥1 per region already).
- 2026-07-17 — Deleted `harness/demoScenario.ts` (it was explicitly marked "delete or replace once Phase 2+ systems exist" in its own doc comment) now that real `worldgen()` exists. `TierSpec` changed from `{ tier: number }` to `{ tierIndex: number }`, and `GameState.tier` changed from that stub to the real `Tier` type — `constructState` now calls `worldgen(seed, tierSpec.tierIndex)` internally. Phase 1's `gate1.replay.test.ts` and the CLI's `generate` command, which both depended on the demo scenario purely to produce *some* deterministic log content to byte-diff, were updated to draw directly from a named substream inline instead — this keeps testing exactly what they always tested (EventLogWriter/serializeLog determinism), decoupled from any harness fixture module.
- 2026-07-18 — TOML library: `smol-toml` (runtime dependency of `packages/engine`, not devDependency — `ContentPort` loads at actual runtime). Chosen for zero dependencies, TOML 1.0 compliance, and ESM-native — no boundary concern since it touches neither DOM nor Math.random/Date.now internally, and our eslint boundary rule only scans `packages/engine/src/**`, not `node_modules`.
- 2026-07-18 — `MultiplierKind` includes the three forbidden unbounded kinds (`job_level`, `primary_stat`, `weapon_scaling`) alongside the three legal bounded ones (`constant`, `crit`, `elemental`). This looks backwards (why put a forbidden option in the type?) but is deliberate: Gate 4 needs an ability that can *attempt* an illegal formula for the loader to reject, and a closed enum that never allowed the illegal value at the type level would make the gate untestable. `BOUNDED_MULTIPLIER_KINDS` is the actual allow-list enforced at load; the other three exist to be rejected.
- 2026-07-18 — `Ability.primaryDomainTag` is NOT restricted to domain-category tags despite its name, contrary to my first draft. Caught while authoring fixtures: the Warrior job's `primary_tag` is `"martial"` (a role tag), and Cleave's mastery match requires `ability.primaryDomainTag === job.primaryTag` to equal `"martial"` too — if `primaryDomainTag` were restricted to domain-category tags only, a martial class could never get a mastery bonus on its own signature ability, which is clearly wrong. Relaxed the constraint to "must be one of the ability's own tags, any category" — "domain" in the field name means "this ability's main specialty," not a `TagCategory` restriction. Documented in `types.ts` so it isn't re-tightened by mistake later.
- 2026-07-18 — Content directory layout: `packages/engine/content/` with `tags.toml`/`weapons.toml`/`threatArchetypes.toml`/`weaknesses.toml` as single array-of-tables files, but `jobs/*.toml`/`abilities/*.toml`/`grammars/*.toml` as one file per entity. Deliberate: Gate 1's "add a new class with zero code changes" story is literally "drop a new file in `jobs/`," which only works cleanly when each job is its own file rather than an array entry in one shared file (adding an entry to a shared array isn't as clean a "hot-load" demonstration and risks merge-style edits to existing content).
- 2026-07-18 — Threat archetype ids in `threatArchetypes.toml` deliberately reuse the exact strings from `worldgen/config.ts`'s `THREAT_ARCHETYPE_IDS` fixture list (`archetype:bruiser`, `:swarm`, `:caster`, `:ambusher`, `:sentinel`). Not required for any gate, but means Phase 2's boss placement (which only ever carried an opaque ID string) now resolves to real Phase 3 content with zero migration.
- 2026-07-18 — Test isolation: writing fixture TOML files directly into the shared `packages/engine/content/` directory (as Phase 1/2's boundary-fixture tests do to `src/`) broke under vitest's default parallel-file execution — `loadContentFromDir` scans its whole target directory, so one test file's temporary fixture was visible to every other concurrently-running test file's load call, causing nondeterministic cross-contamination failures. Fixed with `test/content/tempContentDir.ts`: each test copies the real content directory into a fresh OS temp dir, mutates only the copy, and the loader only ever sees that isolated copy. This is the correct general pattern for any future test that needs to mutate shared on-disk content; the Phase 1/2 pattern (write into the real dir, delete in `finally`) only ever worked because exactly one test at a time touched `src/`.
- 2026-07-18 — `KNOWN_STATUSES` (sleep/slow/poison/oiled) is a small hardcoded TS fixture array, not TOML-authored this phase — same scope tier as Phase 2's NPC trait/job fixture lists (small, fixed, not proper nouns, no hot-load story needed for a 4-entry vocabulary yet).

## Stubs / deferred
- `partySpec: PartySpec` (`src/harness/types.ts`) is still a near-empty stub — Phase 5 fills in real party members. (`TierSpec`/`GameState.tier` are no longer stubs — wired to real `worldgen()` as of Phase 2.)
- No real Oracle implementation (e.g. chess engine) exists yet — only `createCountingOracleSource` used to prove the port in tests.
- Quest graphs/DAGs/hints/item placement (Phase 4) — boss node placed, no chain built to it.
- Full kernel set of 15-25 (Phase 3 world content) — still only the same 4 fixture kernels from Phase 2; Phase 3 built the schema/loader/grammar machinery, not the big content pass.
- Price math (Phase 6) — economic axis assigned per region, no formulas. Commodity grammar mechanism now exists (`grammars/commodity-demo.toml`) but generates no prices and is wired to no economy.
- Battle runtime (Phase 5) — primitives are validated data + a pure `computeAbilityPower`, but nothing executes an effect against live combat state; no CTB queue exists yet for `shift_queue` to actually manipulate.
- Threat archetype mechanics (Phase 5) — `threatBehavior` enum (loyal/opportunist/assassin) and `counterMaterial` tag are stubs; nothing implements the actual behavior or the variance-widening soft gate yet.
- Equip cap (`EQUIP_CAP = 6` in config) — defined but unenforced; no loadout/equip-selection system exists yet to constrain (Phase 5).
- Weapon geometry rule (melee front-row-unless-empty, ranged either row) — documented in CLAUDE.md's Phase 3 architecture section, not enforced anywhere; Phase 5 wires it into actual combat targeting.
- Full `/names` tree and full ~30 tag list — fixture subsets only this phase (14 tags, a handful of curated pools already existing from Phase 2, no new curated-pool TOML authored — `pickFromPool` proven generically in tests instead). Full candidate tag list documented above for the later content pass.
- Faction simulation / NPC memory / Echoes / arcs / resonant-tag runtime effects (Phase 7) — factions are name + home region + reputation 0, nothing else; no `resonant_tags` field added to kernels (not asked for this phase).
- Puzzle/lock mechanics (Phase 8) — kernel carries a puzzle-affinity tag only; weapon/ability schemas carry no lock-related fields.

## Known issues
- (none — CI confirmed green on GitHub's hosted runners, run 29621644363)
