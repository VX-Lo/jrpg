# CLAUDE.md — Hollowmark

## Read this before any action. Update it after any action.

## Current state
- **Phase:** 1 — determinism substrate
- **Status:** Phase 1 complete — all gates passing locally AND confirmed green in CI (GitHub Actions run 29621644363, conclusion: success, on push to main at commit aa4ac84).
- **Last action:** Pushed 4 `phase1:` commits to `origin/main`. Confirmed the CI workflow run for that push completed with `conclusion: success` via the GitHub Actions API.
- **Next action:** Awaiting user direction to begin Phase 2 (worldgen/regions/tiers/settlements) per the scope fence — nothing in Phase 2+ should start without explicit go-ahead.

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
- `GameState` stub shape: `{ seed, rng, log, tick, tier, partySpec }`. `constructState(seed, tier, partySpec)` builds it fresh — no persisted world, only seed + empty log.
- CLI (`packages/engine` → `npm run cli -- <command>` or `npx tsx src/harness/cli.ts <command>`):
  - `generate <seed> [outFile]` — constructs state, runs the Phase-1 demo scenario, writes/prints the serialized log
  - `replay <logFile>` — deserializes a log and folds it into a trivial `{eventCount, lastTick}` summary via `replay()`
  - `diff <fileA> <fileB>` — byte-compares two serialized logs, reports first differing offset, exit code 0/1

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

## Stubs / deferred
- `tier: TierSpec` and `partySpec: PartySpec` (`src/harness/types.ts`) are near-empty stubs (Phase 2 fills world/tier meaning, Phase 5 fills party/stats).
- No real Oracle implementation (e.g. chess engine) exists yet — only `createCountingOracleSource` used to prove the port in tests.
- `demoScenario.ts` / CLI's `generate` command produce fixture data only (region/initiative-shaped rolls from named substreams) — not real worldgen or combat, which are out of scope per the Phase 1 scope fence.

## Known issues
- (none — CI confirmed green on GitHub's hosted runners, run 29621644363)
