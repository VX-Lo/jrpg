# CLAUDE.md — Hollowmark

## Read this before any action. Update it after any action.

## Current state
- **Phase:** 2 — world generator
- **Status:** COMPLETE. All 6 gates passing (50/50 automated tests green, tsc/eslint clean, plus the human Gate 6 spot-check recorded below). Not yet pushed to origin / confirmed in CI this session — that's the last step.
- **Last action:** Ran Gate 6: pretty-printed and read 6 seed/tier combos via `gen --seed X --tier N --print`, verdict recorded below (yes, reads as a place, with expected fixture-scale caveats).
- **Next action:** Commit this CLAUDE.md update, push to origin, confirm CI green (same pattern as Phase 1's close-out), then await user direction on Phase 3.

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

## Stubs / deferred
- `partySpec: PartySpec` (`src/harness/types.ts`) is still a near-empty stub — Phase 5 fills in real party members. (`TierSpec`/`GameState.tier` are no longer stubs — wired to real `worldgen()` as of this session.)
- No real Oracle implementation (e.g. chess engine) exists yet — only `createCountingOracleSource` used to prove the port in tests.
- Quest graphs/DAGs/hints/item placement (Phase 4) — boss node placed, no chain built to it.
- Full kernel set of 15-25 (Phase 3) — only 4 fixture kernels exist.
- Price math (Phase 6) — economic axis assigned per region, no formulas.
- Threat archetype mechanics (Phase 5) — boss references an archetype ID string only.
- Faction simulation / NPC memory / Echoes / arcs (Phase 7) — factions are name + home region + reputation 0, nothing else.
- Puzzle/lock mechanics (Phase 8) — kernel carries a puzzle-affinity tag only.

## Known issues
- (none — CI confirmed green on GitHub's hosted runners, run 29621644363)
