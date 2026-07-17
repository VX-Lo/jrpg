# CLAUDE.md — Hollowmark

## Read this before any action. Update it after any action.

## Current state
- **Phase:** 1 — determinism substrate
- **Status:** in progress
- **Last action:** Scaffolded npm workspace + `packages/engine`. Boundary enforced two ways: ESLint flat config (`eslint.config.js`, `no-restricted-imports`/`no-restricted-globals`/`no-restricted-syntax` blocking react/react-dom, window/document/etc, Math.random(), Date.now()) and `tsconfig.json` `lib: ["ES2022"]` (no DOM lib, so DOM globals are unresolvable types too). Proved both fail on a deliberate probe file importing react + using document/window/Math.random/Date.now, then deleted the probe.
- **Next action:** Write Gate 2 (perturbation test) against the not-yet-built PRNG API, then implement SplitMix64 + FNV-1a substreams to make it pass.

## Project rules (never violate)
1. Determinism: same seed + inputs = bit-identical log. Tested, not assumed.
2. Generator, not database: derivable from seed → not stored.
3. Oracles logged, never recomputed.
4. Engine package: ZERO DOM, ZERO React. Enforced by lint/boundary.
5. No Math.random(), no Date.now(), no ambient state in the engine. Ever.

## Architecture
- Monorepo root uses npm workspaces (no extra tooling needed at this size).
- `packages/engine` — pure TypeScript engine package. No DOM lib, no React. Node-testable only.
  - `src/rng/` — SplitMix64 PRNG + key-hashed substreams
  - `src/log/` — event log writer/reader/replayer/serializer
  - `src/oracle/` — OraclePort interface + mock oracle
  - `src/harness/` — constructState + CLI entry point
  - `test/` — vitest test suites, including the Phase 1 gates
- Substream key convention: `domain:scope:id:purpose`, e.g. `worldgen:tier:5:regions`. Keys are hashed directly (via FNV-1a 64-bit, see below) into a SplitMix64 seed — no sequential derivation, ever. See `packages/engine/src/rng/substream.ts`.
- Hash function: FNV-1a, 64-bit, integer-only (BigInt), operating on UTF-8 bytes of the key string. Chosen because it's a few lines of pure integer arithmetic with a fixed, documented spec — no platform-dependent float or crypto-library behavior, and its output is unambiguous forever.
- PRNG core: SplitMix64 (integer/BigInt arithmetic only). `masterSeed: bigint`. `rng.substream(key: string): PRNG` derives a new SplitMix64 state via `fnv1a64(masterSeed_bytes || key_bytes)` — the child stream's seed depends on both master seed and key, independent of call order or sibling substreams.
- Event log shape: `{ seq: number, tick: number, type: string, payload: unknown }`. `seq` monotonic per-log. `tick` is the universal game clock — drives all downstream time-based derivation (faction updates, market drift, event rolls) starting Phase 2+.
- Ports defined so far: `OraclePort<In, Out>` with `query(input): Out`. Live mode invokes source + logs an `oracle` event; replay mode reads the same event and never invokes source.

## Phase 1 deliverables
- [ ] Splittable PRNG, key-hashed substreams (NOT sequential splitting)
- [ ] Event log: writer, reader, replayer, serializer
- [ ] OraclePort + mock oracle
- [ ] Dev harness: constructState(seed, tier, partySpec) + CLI

## Gates (Phase 1 is not done until all pass in CI)
- [ ] Gate 1: byte-identical replay across many seeds
- [ ] Gate 2: PERTURBATION TEST — new substream consumer does not perturb existing output
- [ ] Gate 3: oracle replay never invokes the source
- [ ] Gate 4: log serialize round-trip
- [ ] Gate 5: boundary lint fails on DOM/React import

## Decisions made
- 2026-07-17 — Repo was essentially empty (only README + .gitignore). Starting Phase 1 from scratch per prompt.
- 2026-07-17 — Using npm workspaces (already have npm 10.8.2 / node 18.20.8 available) rather than pnpm/yarn, to minimize new tooling surface. `packages/engine` is the only package created this phase.
- 2026-07-17 — Boundary enforcement via `tsconfig.json` `"lib": ["ES2022"]` (no `"DOM"`) on the engine package, PLUS an ESLint `no-restricted-imports`/`import/no-nodejs-modules`-style rule blocking `react`, `react-dom`, and any DOM global usage. Belt and suspenders: TS lib omission catches DOM *type* usage (e.g. `document.foo`), ESLint catches `import`/`require` of react packages.
- 2026-07-17 — Hash function: FNV-1a 64-bit over UTF-8 bytes, BigInt arithmetic, no crypto module. Simple, stable, integer-only, platform-independent forever.
- 2026-07-17 — Test runner: vitest (fast, ESM-native, works headlessly in Node — fits "pure TS, no browser" constraint).
- 2026-07-17 — Root `package.json` has `"type": "module"` so the ESLint flat config (`eslint.config.js`) loads as ESM under Node 18. Boundary rule proven live: a throwaway `packages/engine/src/_boundary_probe.ts` importing `react` and using `document`/`window`/`Math.random()`/`Date.now()` failed both `eslint` (5 errors) and `tsc --noEmit` (DOM globals unresolvable since `lib` has no `"dom"`), then was deleted. Belt-and-suspenders confirmed working before any real code was written.

## Stubs / deferred
- `tier` and `partySpec` params to `constructState` are near-empty stubs (Phase 2 fills world/tier meaning, Phase 5 fills party/stats).
- No real Oracle implementation (e.g. chess engine) exists yet — only the mock used to prove the port.

## Known issues
- (none yet)
