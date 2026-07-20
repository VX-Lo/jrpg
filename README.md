# Hollowmark

*Working title — bottom-up naming, see `docs/handoff.md` for why.*

A turn-based party RPG that stores a seed and a generator, never a world. FF1's skeleton, Elite's storage philosophy: everything — the world, the quests, the market, the terrain — is derived from a seed on demand, not authored or saved. Full design canon lives in `docs/`; this file is about one thing only: **how to actually run it and see what's real.**

There is no playable game yet — no UI exists before Phase 9-10. Everything below is CLI tooling: ways to generate, inspect, and verify what the engine produces headlessly. This is deliberate (see `docs/roadmap.md` §1, rule 4) and it's also the honest current state — if you want to know whether the game is any good yet, these commands are how you check, not a substitute for playing it.

---

## Status

**Current phase:** see `docs/roadmap.md` for the authoritative phase table and gate results — not duplicated here, to avoid two copies drifting apart. As of this writing: Phases 0-4.5 complete, Phase 5 (battle engine) next.

**How a phase gets marked done:** every gate is an automated test or a diffable CLI artifact, never a review. `CLAUDE.md` in the repo root records a gate-by-gate table (pass/fail, test file, CI run link) for every completed phase — that table, not this README and not a chat summary, is the source of truth for "did this actually pass."

---

## Try it yourself — what you can inspect today

> **Note for whoever is maintaining this section:** the exact commands below need to be verified against the real CLI as built, not assumed from the design prompts. See the maintenance protocol at the bottom of this file — this section must stay accurate or it's worse than useless.

### Phase 1 — determinism substrate

Verify the foundational guarantee everything else rests on: same seed, same output, always.

```
<VERIFY: exact command to run the determinism/replay CLI, e.g. `npm run dev:replay -- --seed <n>` >
```

Expect: byte-identical output across repeated runs of the same seed.

### Phase 2 — world generator

Print a full tier: regions, settlements, factions, NPCs, level band, boss placement.

```
<VERIFY: exact command, e.g. `npm run dev:gen -- --seed <n> --tier <n> --print` >
```

Expect: a readable dump of the tier's shape. This is the closest thing to "seeing the game world" that exists pre-UI — if a printed tier doesn't look like a place worth exploring, that's a real signal, not a nitpick.

### Phase 3 — content schema

Add a new class or ability in TOML and confirm the engine picks it up with zero code changes — this is the headline guarantee of the whole phase.

```
<VERIFY: where fixture content lives, e.g. `packages/engine/content/jobs/`, and the command that loads/validates it>
```

### Phase 4 — quest graph

Run the two-solver gate against a seed and see the actual inferred solution path — the hint chain a player would follow, and where the solver had to guess.

```
<VERIFY: exact command, e.g. `npm run dev:solve -- --seed <n> --tier <n>` >
```

Expect: a step-by-step trace of what Solver A deduced, from what hint, at what node.

### Phase 4.5 — spatial embedding

Dump the tile terrain for a tier as ASCII/glyphs, at whichever zoom scales have real content today (`far` and `closest` — `medium` is a documented stub and the CLI says so rather than silently returning nothing).

```
<VERIFY: exact command, e.g. `npm run dev:terrain -- --seed <n> --tier <n> --zoom far --tiles` >
```

Expect: a walkable-tile map with visible region blobs, sealed vs. open borders, and blended transitions at kernel seams. This is the single most useful command in the project right now for "does this look like a game" — it's the first thing that produces something resembling a world you could walk around.

---

## How to verify Claude Code's work yourself

Don't just trust a green checkmark or a chat summary — including this file, and including the phase summaries reported in conversation. The actual standard:

1. **Read `CLAUDE.md`'s gate table for the phase in question.** Every gate lists a test file and a CI run link.
2. **Run the test suite locally**: `<VERIFY: the actual test command, e.g. npm test / pnpm test>`.
3. **Click through to the CI run** linked in `CLAUDE.md` and confirm it actually says success — a link alone isn't proof, the conclusion on that link is.
4. **If a gate result looks like a diagnostic rather than a real assertion** (a percentage, a "should," a narrative claim without a number attached), that's worth a follow-up before trusting it. This has happened at least once already (Phase 4.5's first pass reported a residual rate that turned out to be a pre-CI diagnostic, not a live gate result) — the fix isn't to distrust every report, it's to ask "is this number from the CI-run gate, or from somewhere else" whenever a report is ambiguous about it.

---

## Content status — what's a fixture vs. what's real

Nearly everything is deliberately under-authored right now — every phase proves its architecture on a small fixture set and defers full content volume, on purpose (`docs/roadmap.md` §13, the Unix filter). That's correct discipline, but it means large parts of what you generate today are thin by design, not by accident. Current backlog:

- Only 2 of 4 kernel biomes (Fen, Cinderreach) have authored terrain chunks — the other two render as generic `common` terrain
- `medium` zoom has no terrain at all yet (stub)
- 4 fixture region kernels exist; the design calls for 15-25
- 3-4 fixture jobs, regional arcs, and name pools exist per category; full rosters are a later pass
- Puzzle minigames haven't started (Phase 8)

None of this blocks development. It's the list for the eventual dedicated content-authoring pass, and it's kept in sync with `docs/roadmap.md`'s own copy of this backlog.

---

## For a fresh Claude conversation

Paste `docs/handoff.md` into a new chat to restore full design context — canon rules, every resolved design question, and the rejected/retracted list (so a fresh instance doesn't re-propose something already tried and cut).

## Session protocol (for Claude Code)

Read `CLAUDE.md` before any action; update it after every meaningful action; commit regularly; commit-and-push closes every session. Full protocol in `CLAUDE.md` itself.

**Standing rule, not a per-phase reminder:** whenever a phase adds a new CLI capability or changes what's real vs. stubbed, update the relevant section of *this* file as part of that phase's definition of done — the same way `CLAUDE.md` gets updated after every action. This file drifting out of date is exactly the failure mode it exists to prevent.
