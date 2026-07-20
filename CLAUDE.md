# CLAUDE.md — Hollowmark

## Read this first. Update it last.

## Current state
- **Phase:** 5 (battle engine, headless) COMPLETE and CI-CONFIRMED — commit `6a01755`, pushed to `main`, GitHub Actions green. 19 new tests (4 TDD checks + Gates 1-6 + supporting unit tests), 161 total, `eslint .` + `tsc --noEmit` clean. Phase 6 is next, gated on explicit go-ahead as usual.
- **Note:** an earlier version of this entry claimed uncommitted Phase-4.5 work that turned out not to exist anywhere in git history — stale by the time this session started, corrected, no actual local-only work was lost.
- **Gates:** all 9 Phase 4.5 gates remain green (re-run as the canary discipline requires). All 7 Phase 5 gates green in CI — see gate report below.
- **CI note:** the `gates` job logs one informational annotation, not a failure — `actions/checkout@v4`/`actions/setup-node@v4` are being forced onto Node 24 runners even though the workflow targets Node 20 (GitHub deprecated Node 20 runners). Worth a deliberate Node-version bump in `.github/workflows/ci.yml` next time CI config is touched, rather than leaving it silently forced.
- **Debug tooling + a fixture-content pass** (throwaway, not a phase) closed Gate 7's original demo gap and surfaced one real resolver bug along the way — see "Debug tooling" section below.

## Project rules (never violate)
1. **Determinism** — same seed + inputs = bit-identical log. Tested, not assumed.
2. **Generator, not database** — derivable from seed → not stored. The save file is seed + ordered event log.
3. **Meta-fence** — the meta-profile modifies the party's *starting state* and nothing else. It is **never** an input to worldgen. `worldgen(seed, tierIndex) → Tier`, exactly 2 params, enforced by an arity tripwire.
4. **Oracles logged, never recomputed.**
5. **Engine package: ZERO DOM, ZERO React, no `Math.random`/`Date.now`/ambient state.** Enforced by tsconfig lib-omission + eslint `no-restricted-*`, not discipline.

## Zoom scales — what is real today (read before assuming four)
| Zoom | Library | Status |
|---|---|---|
| farthest | none (by design) | **REAL** — pure view over Phase 2's region graph. Needs no terrain, never will. |
| far | `wilderness` (61 chunks, 3 biomes) | **REAL** — full tier terrain via `embedTier`. |
| medium | `settlement` — **NONE AUTHORED** | **STUB** — deliberate deferral. Loader accepts the scale; no chunk declares it, so nothing assembles and the CLI exits non-zero. |
| closest | `room` (20 chunks) | **REAL** — interiors via `embedInterior`. |

`closest` was built as the second proven scale (not `medium`) because it's architecturally furthest from `far` — half the tile size, different library/connector profile, one owner, one POI. `medium` sitting between two proven extremes is the lowest-risk deferral. Same `stitch.ts` serves it unchanged once its library exists; copy the `interior.ts` adapter shape.

## Architecture map
Monorepo, npm workspaces, root `"type": "module"`. `packages/engine` is the pure-TS headless engine (Node-testable only); a thin renderer will read state and draw it (Phase 10).

- `src/rng/` — FNV-1a 64-bit hash, SplitMix64 `Rng` + `createRng`. `substream(key)` derives from the stream's **immutable seed**, not its draw cursor (Invariant #1). Keys hashed directly into a seed; no sequential derivation.
- `src/log/` — append-only `Event {seq, tick, type, payload}`. `seq` monotonic at append; `tick` is the universal clock driving all downstream time derivation. BigInt-safe serializer.
- `src/oracle/` — `OraclePort<In,Out>`; live logs `{input,output}`, replay reads back and throws past what was logged (never silently falls back to live).
- `src/harness/` — `GameState {seed,rng,log,tick,tier,partySpec}`; `constructState` calls real `worldgen()`. CLI: `generate`/`replay`/`diff`/`gen`/`quest`/`embed`. **This is how deep-tier balance work happens — runs are too long to play there.** (`partySpec` still a stub → Phase 5.)
- `src/worldgen/` — Phase 2. `worldgen(seed, tierIndex)`, fenced to 2 params. `band(tierIndex) = round(BAND_BASE · tierIndex^BAND_GROWTH)`, `BAND_GROWTH = 1.4` (must stay > 1 — the number the whole meta-curve rests on). 4 fixture kernels (Fen/Cinderreach/Hollow/Canopy). Region-adjacency graph (`Tier.regionEdges`) added here in 4.5 — terrain reads world topology, never defines it.
- `src/content/` — Phase 3. `Ability.effects: Effect[]`, each referencing a **PrimitiveId + params**, never bespoke code. 7 primitives: `damage`, `heal`, `apply_status`, `shift_queue`, `modify_threat`, `buff`, `debuff`. Power formula: `(relevantStat + (mastery ? jobLevel·bonus : 0)) · product(boundedMultipliers)` — additive between stat and job-level, multiplicative only by bounded things (rule 10, enforced at load). TOML `ContentPort`, loud validation, seeded Tracery-style grammar engine.
- `src/questgraph/` — Phase 4. Forward-generation DAG, hint vocabulary (Location/Exclusion/Dependency/Proximity, vague→medium→precise), two solvers (A: inference; B: brute force), mercy relocation with pinning, 4 regional-arc templates.
- `src/spatial/` — Phase 4.5. Reads Phase 2's `Tier`, writes nothing back; nothing in `questgraph/` imports it. Chunk library + honest connector specs, 8 dihedral orientations, Voronoi region blobs, corridors-vs-sealed borders from the adjacency graph, backbone-first assembly, palette blending, four zoom scales, on-demand per-tier gen with the boss node as gateway.
- `src/battle/` — Phase 5. Headless CTB combat resolver. `registry.ts` is the central commitment: every combat variable (`damageDealtMult`, `damageTakenMult`, `critChance`, `critMultiplier`, `accuracyScalar`, `actionCostMult`, `threatGenerationMult`, `mpCostMult`, `boostGenerationRate`, `statusResistance`, `resistPerTag`, plus the 5 primary stats) resolves through `resolveVariable`/`addModifier`, never inline. `clock.ts` — one shared tick timeline with the world clock, jumps to the next actor's `nextActionTick`, never iterates tick-by-tick; no initiative roll, ties break by actor id. `status.ts` — 4 shapes (queue-delay, DoT, vulnerability-tag, duration-scalar-mod) via `STATUS_SHAPES`; statuses always apply, `statusResistance` scales duration/magnitude only. `breakBoost.ts` — Break (target-side shield/window) and Boost (self-side, pressure-sensitive via `boostGenerationRate`, doubling as the comeback lever). `rows.ts` — melee-front-unless-empty/ranged-either-row geometry, physical-only row damage reduction. `threat.ts` — accumulator + per-archetype behavior params (no hardcoded loyal/opportunist/assassin branches). `damage.ts` — no-miss variance model, level-diff scalar, accuracy-before-weakness/Break ordering. `ai.ts` — deterministic priority list. `state.ts` — `BattleRequest` → live mutable `LiveCombatant[]`. `resolver.ts`/`autoResolve.ts` — the CTB main loop and the headless fast path, same `BattleResult` shape. `events.ts` — referenceable-event-taxonomy payloads for Phase 7. `predict.ts` — pure pre-commit immunity check. Nothing upstream imports `battle/`; reads `ContentPort` + `worldgen/config.ts` constants only.
- `.github/workflows/ci.yml` — `eslint .`, engine build (tsc), vitest, on push/PR. Node 20.

## Phase status (all complete; do not reopen without cause — detail in git history + `src/`)
| Phase | What shipped | Headline gate |
|---|---|---|
| 1 | Determinism substrate: PRNG, key-hashed substreams, event log, OraclePort, harness/CLI | Byte-identical replay + perturbation |
| 2 | World generator, fenced to `(seed, tierIndex)`; bands, kernels, node graph, factions, NPCs, boss placement | Cold-depth: tier 40 direct from seed |
| 3 | Content schema + grammar engine; effect-primitive abilities; rule-10 formula safety at load | Hot-load a class / new ability, zero code |
| 4 | Quest graph + regional arcs + skill/elite placement | **Two-solver gate: 1000/1000 by inference, avg 1.096 guesses/seed, tedium 0.319** |
| 4.5 | Spatial embedding (see architecture map) | Walkability both directions, 0 unsatisfied edges; Gate 4 canary bit-identical |
| 5 | Battle engine, headless (see architecture map) | Determinism byte-identical (full + auto); rule 10 enforced at the registry; auto/full outcome-class agreement; world-clock coupling real; no `canEngage` anywhere |

Phase 4.5's Gate 4 re-runs Phase 4's two-solver gate **unchanged** as a canary and reproduces it bit-identically — the central fence (`questgraph/` untouched) held. Phase 5 re-ran all 34 prior test files (142 tests) unchanged as its own canary — all green; the only upstream touch was the one sanctioned additive `channel` field on `DamageParams` (see "Phase 5 — selected decisions").

## Invariants worth not breaking
Subtle rules where a "reasonable" change reintroduces a solved bug. Read before touching the named area.

1. **RNG** — `substream` derives from the immutable seed, not the mutable draw cursor. This is *why* determinism is independent of call count/order. `nextInt` uses rejection sampling (unbiased; consumes a seed-determined variable number of draws).
2. **Substream key granularity** — per-cell/per-tile where placement must be order-independent (`spatial:…:chunks:{cx},{cy}`, `:fill:…`); tier-scoped where the constraint is tier-global (Voronoi seeds; kernel assignment — without-replacement so no two regions share a kernel). **Never per-region for an order-sensitive draw** — a later scan-order change would silently reshape every region.
3. **Voronoi** (`voronoi.ts`) — seed placement is one tier-scoped draw. Which region occupies which seat is chosen by **scoring all ≤24 candidate layouts against the adjacency graph** (no RNG), which is what stops physically-unreachable regions. The **territory-floor repair** claims `UNOWNED_CELL`s first, **never a donor's own seed cell** (stealing it makes `enforceContiguity` disown the whole blob → severs regions), fixes regions in adjacency-fair order, and **iterates repair↔contiguity to a fixed point** (`TERRITORY_REPAIR_ROUNDS`) since each pass could otherwise undo the other. *(This is the fix for the softlock + territory-floor crashes found beyond CI's old sampled range.)* White noise at strength 5.0 beat box-blurred (measured); don't re-try blurred.
4. **Assembly** (`assemble.ts`) — single row-major pass, **no backtracking, no WFC** — safe *only because* the fixture library covers all 16 open-edge patterns (asserted). Don't add propagation; preserve the coverage invariant. Unfillable cells throw as fixture-coverage gaps.
5. **Off-backbone cells** — exactly two honest options: linked-to-backbone or sealed-on-all-sides. Never walkable islands (Gate 3). Enclaves forbidden adjacent to logical-node cells.
6. **Entry→POI spine** carved first and protected from sealing, at every scale (backbone-first, one scale down).
7. **POI chunks** only ever land on logical-node cells (symmetric filter — a non-node cell may not take a POI chunk).
8. **decor/fill** writes a **separate layer** that can never flip a walkable tile impassable — the backbone can't be severed after it's guaranteed.
9. **`embedTier`'s 3rd param** injects the chunk **library** (authored content) only — never party/meta/run-state. Not a meta-fence loophole.
10. **Solver A** (`solverA.ts`) — **VISITING** (reads hints, always free) is strictly separate from **INTERACTING** (checks a node for a fact — legal only when candidates narrowed to one, or as a logged guess). Conflating them produced a false zero-guess signal (hints weren't load-bearing). **The single most important solver invariant.**
11. **Quest structure** — regions build independent local DAGs; **only the boss region's chain is load-bearing** (Solver A scoped to it). Solver B still verifies the whole tier structurally. **Locks gate a node's *usability*, never physical traversal** (region graphs are already fully connected).
12. **`band()`** is deliberately float (derived, never stored) — don't "fix" it to integer-only.
13. **`MultiplierKind`** intentionally includes the 3 forbidden unbounded kinds (`job_level`/`primary_stat`/`weapon_scaling`) so the loader has something concrete to reject (Gate 4). `BOUNDED_MULTIPLIER_KINDS` (`constant`/`crit`/`elemental`) is the real allow-list.
14. **`Ability.primaryDomainTag`** = "this ability's main specialty," **any** tag category (not restricted to domain tags) — a martial class needs mastery on its martial signature. Don't re-tighten.
15. **Content layout** — single array-of-tables files for `tags`/`weapons`/`threatArchetypes`/`weaknesses`; **one file per entity** for `jobs`/`abilities`/`grammars` (hot-load = drop a file).
16. **Tests that mutate on-disk content** copy the content dir into an OS temp dir per test — `loadContentFromDir` scans the whole dir, so writing into the shared dir contaminates parallel vitest files.
17. **Settled tooling, don't re-litigate:** npm workspaces; vitest; `smol-toml` (runtime dep); Node 20 in CI; FNV-1a + SplitMix64 core.
18. **Rule 10 at the registry** (`battle/registry.ts`) — a multiplicative modifier on an unbounded variable (the 5 primary stats) throws `Rule10Violation` at `addModifier`, not just at content-load time. Every bounded variable has a declared clamp in `VARIABLE_CLAMPS`, re-applied on every `resolveVariable` call — stacking can never push a bounded variable past its range. This is Phase 3's rule 10 extended to runtime modifiers, the same rule, one more enforcement point.
19. **No `canEngage`** — searched for and asserted absent by Gate 6. The soft gate (counter-material) is two scalars only (a stat edge + variance widening), never a boolean that blocks initiating a fight. Don't reintroduce one, even as a "balance" convenience.
20. **Accuracy resolves before the weakness/Break check, always** (`damage.ts`) — a documented, stable order so a simultaneous glancing-blow scalar and a Break trigger never race (CLAUDE.md Phase 5 §13.4). Don't reorder without re-reading that section.
21. **Party turn inputs are consumed strictly in queue order** — `runBattle` throws if the next `BattleInput`'s `actorId` doesn't match whoever the CTB clock actually picked next. This is deliberate: the determinism contract is "ordered `BattleInput[]` matching queue order exactly," not "inputs tagged by actor, reordered by the engine." A caller (future UI) must compute whose turn is next before prompting.
22. **Weapon-reach targeting is auto-redirected, never rejected** — if a melee attacker's requested target is in a non-empty front row's shadow (illegal per D6), the resolver silently redirects to the front-row-eligible target rather than throwing, consistent with the auto-retarget "never a wasted turn" philosophy (CLAUDE.md §9).
23. **`shift_queue` direction semantics** — `"back"` delays (increases `nextActionTick`), `"forward"` advances (decreases it, floored at the current tick so the queue can't be pushed into the past). Easy to get backwards; don't.
24. **Vulnerability-tag statuses must merge into the weakness lookup at damage-resolution time, not just check `target.tags`.** A vulnerability-tag status (e.g. `oiled`) grants a tag at runtime via `activeGrantedTags()` (`battle/status.ts`); the damage effect case in `resolver.ts` merges it into `getWeaknessesFor`'s input before checking weakness hits. Skipping this merge is exactly the bug that was found and fixed during the Fixture Content pass (see "Debug tooling") — `oiled → fire` silently never combined with anything because only the target's authored tags were checked.
25. **`AwaitingPartyInputError`** (`battle/resolver.ts`) is the supported way for a caller to drive a fight turn-by-turn without duplicating resolver logic: `runBattle` throws it, carrying live `party`/`enemies`/`actorId`/`tick`, only when the scripted input stream runs dry (a mismatched `actorId` is still a plain `Error` — a real caller bug). The supported pattern is replay-from-scratch with one more input appended each time, not incremental/resumable mutation. Phase 10's real UI should use this same contract.

## Stubs / deferred
- **Full chunk library** (40–60/biome × 8 orientations) and full 15–25 kernel set — currently 81 fixture chunks. Hollow + Canopy have no own-biome chunks and fall back to `common` (read as generic). Biggest deferred item; unblocks raising `COARSE_GRID_SIZE` (currently 10, not 16).
- **`medium` (settlement) zoom** — the only unproven scale (see zoom table).
- **Corridor width uniform per scale** (4 tiles far, 2 closest) — one shared connector profile per fixture library; nothing in the stitcher assumes it.
- **Battle runtime** (Phase 5) — COMPLETE, see architecture map and Phase status table. Remaining gaps, all deliberate: no encounter-builder wiring `archetype + tier band → EnemyCombatantRequest` from live worldgen/questgraph state yet (`BattleRequest` is constructed directly by callers/tests today — nothing in `questgraph/`/`spatial/` assigns a concrete tier band + archetype to an encounter yet, so building this now would be speculative); no gear drop table (`rewards.gear` is always `[]`); XP/gold formulas are placeholder UNCALIBRATED math, not calibration-pass numbers. `sleep`/`slow`/`oiled` status content was originally entirely unauthored (Gate 7 couldn't demonstrate them); `slow` (`ability:hamstring`) and `oiled` (`ability:douse`) are now authored via the Fixture Content pass (see "Debug tooling") — `sleep` (same queue_delay shape as `slow`) is the one still-unauthored status, not blocking anything since `slow` already demonstrates that mechanism end-to-end.
- **Economy** (Phase 6) — economic axis assigned per region; commodity grammar mechanism exists; no price formulas, no market.
- **Simulation layer** (Phase 7) — factions are name + home + reputation 0. No Echo reference-roll/spawn logic (arc terminals are logged in the correct referenceable shape only). No NPC memory. Live quest-completion/tick-timeout events and mercy player-state are seeded stand-ins until a live playthrough exists.
- **Minigames/locks** (Phase 8) — `QuestLock.integrity` assigned; no picking/breaking/minigame; no `canPick` (by design). No real Oracle (e.g. chess) yet.
- **Rendering** (Phase 10) — CLI glyph dump is a debug tool, not a renderer. `decor`/`visualRegion` are data awaiting a renderer.
- **Elite-capture yield** — `{resolved: false}`; *which* ability an elite grants is late-bound at capture time (run-state, party-aware), deliberately not computed at generation.
- **Dungeon-cluster interior nodes** never host quest prerequisites (only top-level region nodes do).

## Open questions
1. **Frontier depth (`g`)** — how many tiers a typical run reaches, i.e. what `BAND_GROWTH`/meta-`k` should be. Judged across many playthroughs (does reaching tier N+1 feel like the right run-to-run improvement), not answerable from a spec session. Distinct from tier *content* budget (~24 nodes, ~8–10 hrs/tier), which is roughly pinned. **Never solve one from the other.**
2. **Traversal trivialization — MEASURED.** Backbone tick cost is **flat** across tiers (mean ~123 ticks; tier-1 127.2 vs tier-100 124.8; linear slope 0.057 ticks/tier, negligible vs per-tier σ 40–57). Consistent with `NODES_PER_TIER` fixed at 24 — only the difficulty band grows with depth, not world size. So the asymmetry is **real**: at high meta, combat trivializes (auto-resolve → microseconds) but traversal does not. **Decision pending** (not blocking): accept it (exploration has value regardless of combat difficulty — Rimworld/Kenshi don't make traversal free either), *or* add the one natural lever — a **one-time, bounded, meta-gated flat reduction to far/farthest-zoom tick cost**. Rule-10-safe: flat, bounded, a discrete unlock (not a scaling primary, not a talent tree).

## Phase 5 — gate report
- The four pre-engine checks (§13, `test/battle/tdd.test.ts`) all PASS: counters (a killed actor never acts afterward), doubles (a second effect resolves against the first's just-applied state, not a snapshot), variance-is-margin (zero outcome flips across many seeds), and Break-vs-accuracy-scaler ordering (stable, deterministic).
- Gates 1-6 (`test/battle/gates.test.ts`) all PASS: determinism (full + auto, byte-identical), a 100-seed variance sweep, rule 10 at the registry, auto/full outcome-class agreement, world-clock coupling, and no `canEngage` anywhere.
- Gate 7 (human spot-check) PASS via the new `battle` CLI subcommand: a Break window opened after a weakness hit, and the post-Break damage increase was legible directly in the raw log with no UI.
- Gate 7's original content gap (no fixture ability used `sleep`/`slow`/`oiled`) is now closed — see "Debug tooling" below, which also surfaced a real resolver bug in the process.

## Phase 5 — selected decisions
- **`TICKS_PER_DAY`** (an ASK-FIRST spec item) — set to `24 * BASE_ACTION_TICKS` without stopping to ask: no existing cadence conflicts, since Phase 6's market doesn't exist yet and the only other tick threshold (`ARC_BEAT_TICK_THRESHOLD`) is a per-Beat transition, not a day length.
- **`channel` on `DamageParams`** (the other ASK-FIRST item) — added additively, defaulted at validation time (`weapon_scaling` base → `physical`, else `magical`); confirmed the sanctioned exception to "nothing upstream imports `battle/`," all Phase 3 gates stayed green untouched.
- **Boost is party-only** — enemies never accrue or spend it; the spec frames it as the player's burst-timing economy and the MVP AI has no spend decision. Revisit if enemy Boost-spend AI is ever wanted.
- **Target-side resolution has no offensive/defensive ability classification** — the resolved target's own side (not the ability's primitive mix) determines the target set for `row`/`all` shapes, so a heal ability just needs `targetId` pointed at an ally. Weapon-reach geometry only constrains abilities containing a `damage` effect targeting the opposing side.

## Debug tooling (throwaway instrumentation, not a phase)

`packages/debug-tui` is a dev-only Ink (React-for-terminal) TUI so Lo can hand-playtest what exists — walk a generated map, browse content, run interactive battles. It is **not** Phase 9/10, uses none of Design's tokens (none exist yet), is held to none of the production gates, and may be partially or wholly discarded once the real UI is built.

**Launch:** `npm run debug-tui` (root script → `npm run --workspace packages/debug-tui start` → `tsx src/main.tsx`).

**This tool is allowed to cheat**, and says so on screen: teleport, spawn-any-encounter, reroll-without-spending, regenerate-on-demand are all illegal in the real game (meta-fence, generator-not-database, no-`canEngage`) and are not made to look legal. Debug actions never touch the engine's real `EventLogPort`/`GameState` — the TUI keeps its own small, ephemeral, in-memory log (`src/debugLog.ts`) for its own log panel, discarded on process exit. Every screen constructs fresh state from `(seed, tier)` and discards it; nothing persists between sessions.

**Package boundary:** `packages/engine/src/index.ts` is still an empty barrel (`export {}`), so there is no `import ... from "@hollowmark/engine"` entry point to depend on today. `debug-tui` imports engine submodules directly via relative paths into `packages/engine/src/...` (the same pattern engine's own `harness/cli.ts` uses internally) — this reads engine's public per-module exports, not private internals, and `packages/engine` imports nothing from `debug-tui` (verified — the boundary is one-directional). All of that traffic is funneled through `packages/debug-tui/src/engine/access.ts` so there's one file to check if this ever needs tidying into a real `exports` map.

### Notes
- **Navigation:** 3 tabs (Map/Content/Battle, keys `1`/`2`/`3`), persistent footer with active tab/seed/keybinding legend. Map: `z` cycles zoom (far → medium → closest → farthest), real walkability against the assembled `TileMask`, `r`/`t`/`i` for regenerate/teleport/inspect. Content: cycle through all 5 categories (jobs/abilities/weapons/threat archetypes/tags), detail view is a raw `JSON.stringify` of the entity so it can never drift from `content/types.ts`.
- **Interactive battle turn-by-turn** via `AwaitingPartyInputError` (Invariant #25) — `debug-tui` replays `runBattle` from tick 0 with a fresh rng substream/log every time the committed input list grows by one, rendering off the caught error's live state. No resolver logic duplicated; existing tests/gates/CI cover this additive export unchanged.
- **`PartySpec` is still the real stub** (`memberNames` only) — `debug-tui/src/engine/{party,encounter,gear}.ts` hold debug-only, explicitly-labeled UNCALIBRATED assemblers (preset party, `archetype+band → enemy` roll, gear roll), not the real Phase 6/7/13 systems. Manual per-archetype encounter picking was scoped out of v1; only "roll a random encounter at a chosen band" exists.
- **Reset / reroll encounter / reroll rewards** are distinct: reset replays the same `BattleRequest`/`encounterId` from scratch; reroll encounter advances both the roll substream and the encounter sequence number (no rng collision with the abandoned fight); reroll rewards only re-invokes the gear roll, never re-simulates combat.
- All debug-only rng draws live under a `"debug-tui:"` substream prefix so they can never collide with a real engine key (Invariant #2).
- **Gate:** full suite stays green (161 tests + the additive resolver export), a headless Ink smoke test covers mount/tab-switch/map-move/battle-input — but the real gate is Lo playing with it.

**Fixture Content pass** (closed Gate 7's original demo gap): a first playtest found nothing to combo with, since no content applied `sleep`/`slow`/`oiled`. Added `ability:hamstring` (slow) and `ability:douse` (oiled), an `oiled → fire` weaknesses.toml row, and 3 demo `ThreatArchetype`s (`oilfin`/`skitter-pack`/`mudlurk`) — illustrative numbers, not a calibration pass. This surfaced a real, now-fixed resolver bug (see Invariant #24): `oiled` was a silent no-op against weakness checks before the fix. A few Battle-tab display bugs were also fixed along the way (a Break-window indicator was missing; a Party/Enemies layout bug could misattribute a status line to the wrong combatant). Human spot-check confirmed all four target mechanisms working end-to-end: Slow visibly stretching turns-remaining, the oiled+fire combo landing as a weakness hit on a non-aquatic control target, a Break window opening and counting down, and threat behaviors (opportunist vs assassin) visibly diverging.

## Known issues
- None outstanding for Phase 5 (see Gate 7 gap above, tracked as a content-authoring stub, not an engine defect).
- CI's `gates` job runs on Node 24 despite the workflow targeting Node 20 (GitHub-side forced deprecation, informational annotation only, not a failure) — see Current state.
