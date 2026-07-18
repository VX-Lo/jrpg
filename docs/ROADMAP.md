# HOLLOWMARK — Project Roadmap v3

*Working title. Cairn was the original placeholder but collides with a well-known OSR tabletop RPG. Hollowmark holds the slot for now — bottom-up naming is the plan: once the "hollow marks" mechanic the title should actually reference exists, the name gets built from it, not the other way around. Not there yet.*

**Status:** Phases 0-3 complete — Phase 4 (quest graph) up next
**Model allocation:** Opus for design + audit, Sonnet for all implementation
**Reference lesson:** The tactics project shipped systems fast, accumulated combat sequencing bugs that surfaced late, and is currently learning that presentation can't rescue an illegible event log. This roadmap front-loads design and gates every phase on a test, not a review.

---

## 1. What this is

A turn-based party RPG with FF1's skeleton and Elite's storage philosophy: **store a seed and a generator, never a world.**

**The loop:**
> Wander → fight → level → find fragments → infer what they mean → beat the fiend → new areas, factions, contracts, NPCs → repeat.

The loop is deliberately familiar. The hook is that **the goal structure is cryptic and generated**: you find the Orb of Redfeather without knowing it pairs with the Thunder Rod to forge the key to B3. Discovery is the content.

**Structure:** Long-term roguelike, organized into **tiers** — multi-region campaigns, each terminating in a boss. Beat the boss, the world expands a tier, you keep going. There is no last boss; there are just bosses, forever, and one eventually kills you. Difficulty (`f(tier)`) outruns the party's reachable ceiling, so runs end. TPK ends the run; a bounded meta-upgrade carries forward. Ending a run is a feature — it's what lets you try new classes.

**Deliberately out of scope:**
- Territory control, politics, diplomacy. Factions are reputation scalars.
- Trade routes, caravans, trade contracts. See §5 — the economy is a texture, not a second game.
- Dwarf Fortress-style history generation.
- Any second genre. Additions fit *inside* the RPG loop, not beside it.

---

## 2. Hard rules

1. **Determinism.** Same seed + same input sequence = bit-identical event log. Enforced by test.
2. **Variance affects margin, never outcome** — unless the player chose the risk.
3. **Scaling-blend.** Nothing is taken away as the game grows.
4. **Generator, not database.** Derivable from the seed → not stored.
5. **Legibility is a feature.** An emergent story the player can't perceive did not happen.
6. **Every seed is winnable by inference**, not by exhaustive search. Proven by solver. (§4)
7. **Oracles are logged, never recomputed.** (§6)
8. **Generated variety, authored structure.** ← *the load-bearing new one*
9. **Composability over invention.** Small, provably-terminating systems that interact freely produce more story than one large clever system. Solved and cheap → canonize directly. Novel or risky → gets a design pass first. (§13)
10. **At most one unbounded factor per formula.** Additive between meta and tier; multiplicative only by bounded things. (§7)

### On rule 8

This is the through-line of the whole project and it resolves three separate design questions at once.

A thousand trade goods with random prices is not a market — it's a spreadsheet you scan for the lowest number. Infinite quests with no grammar is not mystery — it's noise. Forty puzzle types scattered arbitrarily is not a world — it's a minigame menu.

In every system: **generate the variety, author the structure.** A thousand goods across sixteen learnable categories. Infinite quests through one grammar of inference. Dozens of puzzle types keyed legibly to fiction. The player learns the structure — that's skill expression, which is what you actually want out of a game — and the generated variety is what keeps the structure from going stale.

Elite is the proof. Seventeen commodities, and price modifiers driven by system type: agricultural systems sell food cheap and pay for computers. That's *learnable*, and learning it is the game. Eight galaxies of 256 systems provided the variety. Structure was authored, and it was tiny.

---

## 3. Storage model — three tiers

| Tier | Contents | Persistence |
|---|---|---|
| **Generated** | map, regions, settlements, factions, NPCs, quest graph, item placement, markets, encounter tables | Derived from seed. Never stored. |
| **Run state** | party, inventory, faction rep, NPC memory, quest progress, market stock | Derived by replaying the event log. |
| **Meta-profile** | cross-run party upgrades, unlocks | **Actually stored.** The only file that isn't seed + log. |

**Load-bearing rule: the meta-profile may modify the party's starting state and nothing else. It is never an input to world generation.**

If upgrades feed worldgen, "same seed" silently becomes "same seed *and* same profile," seed-sharing breaks, and the determinism tests keep passing while the property they test is gone. `worldgen(seed) → world`, full stop. The profile applies to the party after the world exists.

---

## 4. The quest graph — this is the actual project

Everything else here is well-trodden. This isn't. It's the largest piece of new engineering in the design, the part most likely to fail quietly, and the best idea in the pitch.

### The real distinction

You named it exactly: **requiring pen and paper is not lame; requiring you to check every chest is lame.** That's the whole design target, and it's sharper than "cryptic."

The difference is whether the next step is **deducible from information the player holds** or **findable only by exhaustive search**. Deduction is a puzzle. Search is tedium. They can look identical from inside the generator, which is why this needs a test.

### The two-solver gate ← *the key mechanism*

Build two solvers.

- **Solver A — inference only.** Uses only information the player could hold. Makes only the deductions live hints support. Never opens a container it has no reason to open.
- **Solver B — brute force.** Opens everything.

Then:
- **Solver A completes the seed → it's a puzzle.**
- **Only Solver B completes → it's tedium. The seed is a failure even though it's technically winnable.**

The gap between A and B is your **tedium index**, and it's the number you tune against. Target: A completes ~100% of seeds. Secondary metric: how many times A has to fall back on a guess — every guess is a place your hint economy has a hole.

This is a much stronger gate than "max wander distance," because it measures the thing you actually care about instead of a proxy for it.

### Structure

- **Forward generation, always.** Build the DAG, then place items only in already-reachable nodes. Never place-then-validate — that's how you get deadlocks you find in month six.
- **Layered / multi-path.** Yes: the Rod should sometimes be obtainable from an unrelated quest. This makes the DAG a graph rather than a tree, and redundancy *is* bad-luck protection — multiple paths to a node means no single point of failure. Free robustness from a design choice you wanted anyway.
- **The hint economy is the safety valve.** Breadcrumbs are emitted *by the generator, from the graph it just built*, at tunable density. The generator knows the answer and leaks it at a controlled rate. Hints are not flavor; they're the mechanism.

### Mercy relocation — allowed, but fenced

You floated moving an item the player hasn't found in an hour. Good instinct, but it needs a hard limit:

**Mercy adds hints. Mercy never moves a hinted item.**

If any live hint points at an item, that item is **pinned** and cannot relocate. Only unhinted items — ones the player provably has no lead on — may move.

The reason is the pen-and-paper contract. If the player reasons *"the Rod must be in the Sunken Vault, because the ledger said X and the cairn said Y"* and the game has quietly moved the Rod, you have punished correct reasoning. That is worse than never finding it — it teaches the player their deductions are worthless, and once they believe that, the entire design is dead. Bad luck is survivable. Betrayed inference isn't.

Relocation, when it does fire, is a **logged event** driven by seeded RNG plus logged player state — so replay reproduces it exactly. Determinism holds.

### Regional arcs — companion system, canonized

Rule 8 one grain coarser than the item DAG: 15–20 hand-authored arcs (Overthrow, Missing Heir, Plague, Blood Feud, Siege), each a state machine of 4–8 **Beats**. A Beat is an existing quest template plus a variable delta — no new mechanical vocabulary. Terminal Beats carry an outcome tag: **Victory / Lockdown / Status Quo / Inversion** — the tyrant falls and someone worse fills the vacuum. Region generation *picks* an arc weighted by theme and slot-fills it with regionally generated NPCs and factions.

Terminal outcomes feed the Echo taxonomy (§12) for free — "the tyrant fell" is just another referenceable event.

**Gate:** across 100+ seeds per arc, every instance reaches a terminal Beat within its authored bound, and the outcome-tag distribution isn't degenerate — no arc that resolves to Status Quo 95% of the time. A formulaic arc is a design failure the same way a tedious quest graph is.

---

## 5. Economy — texture, not a second game

~1,000 generated trade goods. Limited stock. Refreshes on fiend death (ties the market to the loop, prevents farming).

**But per rule 8, the prices are not independently random.** A thousand goods at independent bell curves means no market can ever be learned, and "find a good deal" degrades into scanning a list for a low number. That's the opposite of skill expression.

Instead:

- ~12–16 **categories** (ore, salt, textiles, reagents, preserved food, glass, tools, livestock…). Generated goods each belong to one.
- Each region gets a **production/consumption profile** from the seed. The Fen produces reagents and wants metal. The Highlands the reverse.
- `price = base(good) × category_modifier(region) × local_variance(seeded, tight)`

Now the thousand goods are flavor, and the sixteen categories are a market you can *learn* — knowledge that transfers between towns and across a run. Straight out of Elite, and it's why Elite's trading still works forty years on.

**Scope fence:** profit is incidental to wandering. No routes, no caravans, no contracts. If you ever find yourself building a logistics layer, that's the Dwarf Fortress creep alarm and the answer is no.

---

## 6. Minigames as locks

Chess was an example, not a requirement — right call. The real reference is **Simon Tatham's Portable Puzzle Collection**, and it's the right reference for a reason worth naming: Tatham's puzzles are *generated and then verified by a solver at a target difficulty tier*. That is the same architecture as the quest-graph gate in §4. You're building that machinery anyway. Two systems, one pattern.

### Selection criteria (not taste)

A puzzle earns a slot only if it is:
1. **Seed-generatable** — deterministic from a substream
2. **Difficulty-tunable as a scalar** — so it can scale with run depth
3. **30–120 seconds at low tier** — it's a lock, not an intermission
4. **Reflex-free** — no timing, no dexterity
5. **Solver-verifiable at generation** — never emit an unsolvable or ambiguous instance
6. **Legible in a small panel** in a dark/neutral palette
7. **Diegetic** — it can plausibly *be* a lock

### Puzzle-type-to-fiction keying

Per rule 8, don't scatter puzzle types randomly. **Key them to factions/regions/lock tiers**, so a Fen lock is always a nonogram and a Highland vault is always a nonogram-of-a-different-flavor. Then the puzzle type is itself a *hint* — the player learns to read a lock's origin from its mechanism, and that knowledge feeds back into the quest graph. Variety generated, structure authored, same principle.

### Chess, specifically

Keep it, but hand-rolled: a few hundred lines of alpha-beta plus piece-square tables lands in the ~1200–1600 range, scales via depth, is kilobytes, and is deterministic by construction. Given you play around 800–1000, it clears the bar comfortably. Stockfish WASM (~1–2 MB, lazy-loaded, pinned for determinism) stays as the upgrade path if the homebrew disappoints. Maia is a stretch goal — it's the best *human-feeling* play, which is the real argument for it, but it's the heaviest and the least deterministic.

**Any nondeterministic engine is an `OraclePort`: log its moves as events, never re-invoke on replay.**

*Licensing note: verify Tatham's collection license before porting any generator logic. Take the architecture as inspiration regardless; the generate-and-verify pattern isn't anyone's IP.*

### Task for a design pass
Generate ~30 candidate puzzle types, score against the seven criteria, trim to 6–8 for MVP. See §8.

---

## 7. Tiers and difficulty — supersedes stamp-at-spawn

### The tier model

The world is organized into **tiers**. Each tier is a multi-region campaign — 2 big / 3 medium / 4 small regions, node budget held constant (2×12, 3×8, 4×6 all land at 24) so every shape carries the same weight with different texture. Each tier has multiple main cities, outposts, deep dungeons, and its own quest graph terminating in a **boss**.

Beat the boss → the world expands a tier → you keep going. **There is no last boss. There are just bosses, forever, and one of them eventually kills you.** Bosses are what separate tiers and what genuinely require preparation.

This resolves the endless-vs-victory tension that looked like a fork: "win" and "forever" were never competing terminal states, just different scopes. Victory is per-tier; the run is endless until it isn't.

**Consequence for the two-solver gate (§4):** better, not worse. Instead of proving one giant graph reachable, Solver A proves *tier N's* quest graph is completable by inference — a smaller, cleaner, repeatable unit.

### Tier-indexed level bands

**`level_band = f(tier_index)`. Never party level.** Tier 5 is the same band on every seed, in every run.

Stamp-at-spawn is retired. It generated content at ±N levels *of the party*, which broke three things at once under a tier model:

1. `worldgen(seed) → world` became false — the world derived from seed *plus replayed run state*.
2. The meta-fence leaked: meta-profile → starting state → party level at tier 5 → tier 5's content.
3. **Tier 47 became untestable.** You'd have to simulate 46 tiers of play to generate it — so the Phase 4 gate couldn't reach the depths where a generator is most likely to go stale.

Tier bands restore all three. The world is generatable cold at any depth. Meta affects how *fast* you climb, never what you face. "I reached tier 9" becomes an absolute measure across runs rather than a relative one.

It also keeps the property stamp-at-spawn existed for: **the XP cap** (no meaningful XP from mobs X levels below you) bounds grinding to roughly the band's ceiling, so "go level up and come back and crush it" still works — bounded within a tier instead of unbounded across the world. Eventually you *have* to fight the boss.

**Difficulty drift is then just `f(tier)` outrunning the reachable ceiling.** That's what ends runs.

### Level difference is a scalar, never a gate

Rule 2 governs this and it's easy to miss. "Enemy is three levels higher and therefore resists your stuff" is an *outcome flip* from something the player didn't choose — the same violation as a miss.

**Three levels under means ~88% damage. Not "30% of your spells evaporate."**

Once level difference is a scalar, the gap stops being feel-bad permanently — on run 1 and run 500 alike — and no "drift-closing" meta stat is needed. That upgrade would be a second system paying to fix something rule 2 already fixes for free.

### What meta actually does

**Meta moves the death frontier outward. It does not make tier 4 easier.** Run 500 reaches tier 14 instead of tier 12. Early tiers becoming a victory lap is correct — the same contract Hades and Slay the Spire make.

Meta is **power at a level, not level itself** — stat and ability upgrades, never starting level. Granting levels would collide with the XP cap (you'd out-level tier 1 into yielding nothing, effectively skipping content by accident rather than by design).

**No cap, and no Ascension ladder.** Both were proposed and are retracted. The curve self-limits:

- Power grows **linearly** in runs: `P(run) = base + k·runs`
- Difficulty grows **superlinearly** in tiers: `D(tier) = d·g^tier`
- Death at `D > P`, so **depth ≈ log(runs)**

Run 500 → ~tier 17. Run 5,000 → ~tier 22. It asymptotes on its own and never actually stops — that's "theoretically forever." A cap would be a mechanism fighting a curve that already self-limits, and Ascension was only introduced to solve that nonexistent cap.

**The only requirement: difficulty must grow superlinearly in tier.** That exponent is the single knob controlling the entire meta curve.

### Stats — and why meta only touches three of them

Five primaries: **STR, INT, VIT, AGI, PER.** No LCK (variance stat, rule 2 hates it), no CHA (no home since politics were cut), no DEX (three stats in a trenchcoat).

**Meta grants flat party-wide primaries — STR, INT, VIT only. Unbounded, linear, no tree.**

AGI and PER are excluded on principle: **meta is unbounded, so it may only target unbounded stats.** Tick cost needs a floor or you act infinitely often — AGI's benefit structurally ceilings. Accuracy dies at 100%. An unbounded system pouring points into a bounded stat is broken by construction; at some run count the node is a dead purchase. STR/INT/VIT don't ceiling — they get *outpaced* by exponential tier growth, slowly and equally, which is the log curve working as designed. **Outpaced is fine. Dead is broken.** AGI and PER come from levels, jobs, and gear — all tier-bounded.

No talent tree: at run 500 with 500 points you've bought every node, so an unbounded tree decays into flat fields anyway. Build expression already lives in FF5 jobs, slot-composed weapons, and party comp. Meta's job is runway, not decisions.

**Why the player can't just dump STR:** party-wide dilution (+200 STR is wasted on two casters — every meta stat pays on half the party) and frontier archetype diversity (physical-immune tags wall a mono-STR run 500 instantly).

### Rule 10 — at most one unbounded factor per formula

`damage = STR × crit_mult` → crit_mult is bounded. Fine.
`damage = STR × weapon_power` → **broken.** STR is meta, weapon_power is tier. That's **meta × tier = compound interest** — a hidden second exponent that stops the difficulty knob from working, with no crit chance in sight.

**Correct: `damage = (STR + weapon_power) × bounded_multipliers`.** Additive between meta and tier; multiplicative only by bounded things.

---

## 8. Design passes are phases

You're right that gates need design in front of them, not just tests behind them. Formalize it: **every implementation phase N is preceded by a design pass N.0** (Opus, chat), whose output is a spec Sonnet codes against.

The pattern is generate-wide-then-trim: produce 30 puzzle candidates and cut to 8; produce 40 faction archetypes and cut to 12; produce 20 hint grammars and cut to 6. Generating wide is cheap in a design chat and expensive in an implementation chat — which is exactly why the split pays for itself.

---

## 9. Tech stack & the Design handoff

**Stack:** Vite + TypeScript. React for the shell. Plain CSS with custom properties for the design system.

**Hard boundary:** the engine is a separate package with **zero DOM and zero React imports** — pure TS, headless, Node-testable. The renderer is a thin layer that reads state and draws it. Enforced by package boundary or lint rule, not discipline. This is what makes every gate in §10 possible.

**The handoff problem is a format problem, not a tooling problem.** Hand-copying screens was awkward because *screens are the wrong unit*. Ask Design for a **design system, not pages**:

- `tokens.css` — palette (dark/neutral), type scale, spacing, radii, motion curves, elevation
- 3–4 reference components as static HTML/CSS — a panel, a resource bar, a menu button, a log entry

Commit as read-only gospel. Claude Code then builds every screen against those tokens and owns the frontend outright. You copy **once**, at the token layer, instead of once per screen. It doesn't look worse, because the taste lives in the tokens — Code isn't being asked to have taste, only to apply it.

---

## 10. Phases

Every phase gated on an automated test or diffable artifact. No phase starts until the previous gate is green. Each is preceded by a design pass (§8). Commit-and-push closes every session.

| # | Phase | Model | Gate |
|---|---|---|---|
| 0 | Design lock | Opus | Zero open architecture questions; cold-boot CLAUDE.md exists |
| 1 | **Determinism substrate** — splittable PRNG, substreams, event log, `OraclePort` — **PASSED, CI green** | Sonnet | Byte-diff two runs of one seed. **Then the perturbation test: a new substream consumer must not perturb existing output.** Most important gate in the project — get it wrong and determinism breaks silently, months before you notice |
| 2 | World generator — tiers, regions, settlements, factions, NPCs, tier-indexed level bands — **PASSED, CI green** | Sonnet | 1,000 seeds generate without crash or degenerate output; spot-check 5 for "is this a place I want to be". **Cold-depth test: generate tier 40 directly from seed with no simulated play** — proves bands are `f(tier_index)` and the meta-fence holds |
| 3 | Content schema + grammars — TOML classes/jobs, effect-primitive abilities, three-tier ability sourcing, equip cap, tag access + primary-tag mastery via job level, weapon-derived reach/scaling, seeded grammar engine — **PASSED, CI green (73/73)** | Opus design + Sonnet build | New class added by editing TOML only, zero code changes. **Plus: a new ability expressible as a composition of existing primitives, zero engine changes; and a grammar draws from a named substream (same seed → same output).** |
| 4 | **Quest graph** — forward DAG, multi-path, item placement, **skill trainer + elite-capture node placement (same machinery, per §16)**, hint emission, mercy rules, regional arcs | Opus + Sonnet | **Two-solver gate (§4).** Solver A completes 1,000+ seeds by inference alone. Report tedium index + guess count. Companion: each regional arc reaches a terminal Beat within bound across 100+ seeds, outcome-tag distribution non-degenerate |
| 5 | Battle engine, headless | Sonnet | Identical log twice. Variance audit. **Port the tactics project's three known sequencing bugs (counters, doubles, miss) as tests before writing the engine** |
| 6 | Economy — categories, region profiles, stock, refresh | Sonnet | Market structure is learnable: a scripted "trader" using only category knowledge beats a random buyer over 100 seeds |
| 7 | Simulation layer — faction rep, contracts, NPC memory, escalation, **Echo system (§12)** | Sonnet | **Read the raw event log of a 30-min playthrough with no UI.** If you can't reconstruct a story — including whether Echo chains actually fire, reference, and decay — the sim layer isn't done and no UI will save it |
| 8 | Minigame modules — `MinigamePort`, 6–8 puzzle types, chess | Sonnet | Replay a logged chess game without invoking the engine. Every generated instance solver-verified |
| 9 | Design system | Claude Design | `tokens.css` + components committed as read-only |
| 10 | UI wire-up — battle, map, **history/log viewer** | Sonnet | Full battle + traversal through UI. Logic already tested; debug layout only |
| 11 | Run lifecycle + meta — TPK, upgrades, new run, save/load | Sonnet | Save/quit/reload replays clean. Meta-profile provably doesn't touch worldgen |
| 12 | Integration audit | Opus | Clean report |
| 13 | Polish — transitions, seed sharing, credits | Sonnet | — |

---

## 11. Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| Substreams wrong; determinism breaks silently | 1 | Perturbation test |
| Quest graph deadlocks | 4 | Forward generation |
| Cryptic reads as tedium, not mystery | 4 | Two-solver gate; tedium index |
| Mercy relocation punishes correct deduction | 4 | Pinned-item rule (§4) |
| Regional arcs go formulaic or balloon past their Beat budget | 4 | Hard cap at 4-8 Beats; terminal-state + outcome-distribution test per arc across 100+ seeds |
| Economy collapses to list-scanning | 6 | Categories + region profiles (§5) |
| Economy grows into a logistics game | 6 | No routes/caravans/contracts. Hard no |
| Minigames become a menu, not a world | 8 | Puzzle-type-to-fiction keying (§6) |
| Chess breaks determinism | 8 | `OraclePort` logging |
| Meta-profile leaks into worldgen | 11 | Hard fence, tested |
| Sim layer emits events but no stories | 7 | Log-legibility gate before UI spend |
| Design handoff stays awkward | 9 | Tokens, not pages |
| Echo chains run away, never terminate | 7 | Spawn probability decays per generation, kept subcritical (§12); hard depth cap as backup |
| Echoes become load-bearing, silently break the two-solver gate | 7 | Echoes restricted to rep/flavor/gear/memory only — never progress items (§12) |
| Soft-gate threshold reads as a hard wall in practice | 5 | No `canEngage` check exists in code, by design; tune effective-stat and variance scalars per threat tier and playtest (§14) |
| Chronicle callback leaks solution info | 7 | Surfaces combat outcomes only — level, gear, result — never item locations or quest state (§14) |
| Level scaling feels like a treadmill | 2 | Tier-indexed bands + XP cap (§7); level difference is a damage scalar, never a resist gate |
| Bands drift party-level-dependent; deep tiers become untestable | 2 | `level_band = f(tier_index)`; cold-depth generation test in the Phase 2 gate |
| Meta uncapped; run 500 is a god-run | 11 | Not a risk — depth = log(runs). Linear power vs superlinear difficulty self-limits (§7) |
| Meta × tier compound interest breaks the difficulty knob | 5 | Rule 10: additive between meta and tier, multiplicative only by bounded things (§7) |
| Meta stat becomes a dead purchase | 11 | Meta targets unbounded primaries only — STR/INT/VIT, never secondaries (§7) |
| Trivial-encounter tedium at high meta | 5 | Auto-resolve above a power ratio; XP still lands, log still written |
| Cannot playtest deep tiers by playing | 1 | Dev harness — `seed + tier + party → jump`. Free because the engine is headless |
| Run length makes TPK punishing rather than climactic | 2 | **Open — needs a number.** See §16 |
| Scope creep | all | §1 out-of-scope list; park, don't build |

---

## 12. Story generation — the Echo system

Canonized, closing the last open question from Phase 0. Not a story engine. The game does not model drama, does not simulate character psychology, and does not write anything. It reads its own event log and reacts to it using the grammars and quest templates already being built for other reasons. Tradition Two (§ discussion), stated as a system.

### The mechanism

**1. Referenceable event taxonomy.** A small authored list — 8–12 archetypes — of event *shapes* eligible to be referenced later: notable death, faction raid, player heroic act, market shock, NPC betrayal, artifact recovery, boss defeat, landmark discovery. Not every log line qualifies. Per rule 8, this is a small authored vocabulary wearing generated fillers (who/where/what/magnitude) — the same move as the trade categories and the Propp-tagged quest edges, pointed at events instead of goods or dungeon rooms.

**2. The reference roll.** On a cadence — entering a settlement, a faction tick — NPCs with a relationship to a referenceable event (witness, faction-mate, kin, rival) get a seeded chance to pick it up. A hit generates an **Echo**: a quest hook whose justification text is templated from the source event (the same fabula → sujet move the hint economy already performs), with a mechanical shape drawn from the existing quest templates — fetch, kill, deliver, escort. The NPC isn't reasoning about anything. It's a tagged lookup with flavor text attached.

**3. Chains, and why they're safe by construction.** Completing an Echo can itself become a new referenceable event, so the system is recursive. Left unbounded, that's a branching process — but the fix is one number: **spawn probability decays per generation** (p at depth 1, p² at depth 2, …). Keep p under 1 and the process is subcritical; a branching process with expected offspring under 1 terminates almost surely on its own, no orchestration required. A hard depth cap stays in as belt-and-suspenders, but the real safety net is the one decaying probability.

**4. Determinism holds for free.** Every reference roll pulls from a substream keyed to the source event's ID. No new determinism surface — same mechanism as everything else in this document.

### The rule that protects the golden path

**Echoes are never load-bearing.** Rule 6 requires every seed be solvable by inference on the pre-generated DAG, proven by the two-solver gate in §4. If a live-spawned Echo could ever produce something the golden path needs, that gate stops meaning what it claims the moment an Echo fires. Echoes may only grant reputation, flavor, minor gear, or NPC memory flags — texture on a structure already proven sound, never a new beam.

### Precedent

Not untested territory. Static rumor tables in Ultima and Might & Magic did the coarse version by hand forty years ago. NetHack's bone files are the same instinct in a different register — past events leaving physical traces other playthroughs stumble into. What's new here is making the rumor table generative and the traces mechanical instead of fixed — a small, well-scoped step past prior art, not a leap beyond it.

---

## 13. Design triage — the Unix filter

The operating principle for everything from here forward, made explicit so it governs future design passes without being re-litigated each time it comes up:

- **Solved, cheap, low-risk → canonize directly, no design pass.** A system that's a few lines of code, has no open failure mode, and composes cleanly with what already exists goes straight into the roadmap. Every individual piece of the Echo system qualifies: a tagged lookup, a templated string, a decaying probability. None of it is research. A sudoku puzzle standing in for a chest lock is the same category of move.
- **Novel or risky → gets a design pass (§8) first.** The quest graph earned its two-solver gate because "is this a puzzle or is this tedium" isn't decidable by inspection. The Echo system didn't need that treatment once decomposed — every piece of it, individually, is already solved elsewhere.

This generalizes the choice of Tradition Two over Tradition One for story generation into a standing rule rather than a one-off conclusion: prefer many small, provably-terminating, composable systems over one large clever system, whenever the small version is available. Systems interacting is what produces stories — no single system has to be, or needs to be, clever. Ten easy roads over one road that's ten times harder, as policy.

**Canonization runs on implementation cost, not content taste.** Content is cheap to cut later if it doesn't land; architecture built around a taste decision isn't. The operative question for anything on the table is "is this clean to build," not "do we like the flavor" — flavor can always be turned off.

---

## 14. Crafting — the soft gate

Resolved, not a system with an open failure mode. Counter-material gear is never mandatory. Rule 2 already covers this: variance affects margin, never outcome — unless the player chose the risk. Walking up to a threat underequipped is the player choosing the risk.

**Structure.** Slot-composed weapons, Guild Wars lineage: universal slot roles (`striking`, `core`) with per-archetype display names — a sword's `striking` slot reads as "edge," a mace's reads as "head." Two slots for MVP. Archetypal stats only — a Tier 2 longsword is a Tier 2 longsword, always, no rolls. Gear identity is composition and regional bonus, not a number; it kills the loot treadmill outright. Materials come from trade and exploration only, never mob drops — farming a material off enemies is exactly the grind this design avoids everywhere else.

**The mechanism.** No `canEngage` check exists in code, anywhere. Instead each `ThreatArchetype` carries an optional counter-material tag and two scalars:

- **Uncountered:** a flat effective-stat edge to the threat, *plus* a widened variance band on both sides of the fight — bigger crit ranges, swingier status rolls. Not just harder: less predictable. That's the bet.
- **Countered:** variance narrows to normal; the reliable crit bonus from the original pitch stays.

The threshold where "strong enough" beats "uncountered" is never a displayed number — stat math, same as everything else here meant to be learned rather than told.

**Context clues, including prior runs — nearly free.** The event log already records deaths; the meta-profile already persists across runs. The only new piece is a query: approaching a threat you've lost to before surfaces that attempt in-fiction — a chronicler, a graveyard marker — party level, gear, outcome, no stat-comparison screen. Never touches item locations or quest state, so it can't quietly become a second hint economy.

**Consequence for Phase 4.** Since counter-gear is never mandatory by construction, Solver A never has to model crafting as a requirement. Rule 6 is untouched — the open solver-scope question from the prior pass is resolved by deletion, not by extension.

---

## 14b. Classes, abilities, and skill hunting

The class system pushes past FF5 toward Guild Wars' deckbuilder feel, because self-surprise and combinatorial depth are explicit design goals. Everything here is Phase 3 schema.

**Abilities are data, composed from effect primitives.** An ability is `{ cost, reach, target_shape, tick_cost, tags[], effect[] }`, where each effect references a primitive (deal damage scaling on a stat, apply status, shift a queue position) rather than bespoke per-ability code. **Adding a class is authoring data; a genuinely new mechanical idea is at most one new primitive.** This is the schema's load-bearing spine — Phase 5's battle engine consumes it, so the primitive vocabulary is committed now even though content is deferred. Discipline: a primitive earns inclusion only when an ability actually needs it (generate-then-trim, applied to primitives).

**Three ability tiers, and tags only need to be clever on one:**
- **Signature** — a job's native tree. Locked to the job, no tag check. "I made a Paladin and I work in Paladin tags" is literally true here.
- **Common** — the broad shared middle, loosely tag-gated, workable and replaceable.
- **Huntable** — captured from the world (elite capture), bought from single-location trainers (the WotLK one-trainer instinct), or taken as an **optional quest reward** (a choice of 2-3 rewards, never a forced skill). Tagged deliberately broad so the same hunted skill means different things to different builds — that's what makes a shared pool worth hunting.

All three tiers compete for a **hard equip cap (~6-8 slots)**. The cap, not access, is what produces "the build you leave town with matters" — GW's actual mechanic. Loadout swaps are **free at rest** (inn/camp), with 2-3 saved presets; never mid-dungeon. Reconfiguration is cheap at the right moment, so different content rewards different bars without friction.

**One flat tag vocabulary** — shared with weakness-tagging and puzzle-keying, no second namespace. Access and power are split:
- **Access** (can you equip it?): overlap-based. An ability tagged `{holy, fire}` is reachable by a `{holy}` job *or* a `{fire}` job — overlap, not containment.
- **Mastery** (are you good with it?): each job declares one **primary tag**; the bonus fires only when an ability's domain tag matches it. A fire tank *can* equip an ice-tank skill; it just won't hit as hard as a real ice tank's would. Same soft-gate house move as counter-material combat and lock integrity — never blocked, only costed.

**Mastery reuses job level, not a new stat.** Job level already gates ability unlocks; it also scales ability power for that job's kit. `ability_power = (relevant_stat + job_level_bonus) × bounded_multipliers` — additive, rule-10-clean. Job level stays tier-bounded and out of meta (meta remains STR/INT/VIT only), giving two clean axes: **meta = cross-run ceiling, job level = within-run identity.** "Empyrean Legacy" or similar can be the in-fiction name; the mechanism is just job level doing one more job.

**Capture is guaranteed, never a roll** — a roll on the valuable moment is the same outcome-flip violation as a miss (rule 2). Carry a **catalyst** (occupies one of the ~6-8 equip slots, so hunting has a real opportunity cost — "am I hunting today?" becomes a genuine loadout decision), defeat the tagged elite, guaranteed learn. **Which** ability an elite yields resolves *at capture* (run-state, party-aware, weighted ~70/30 toward party-relevant tags) — not at worldgen. Placement stays seed-derived and party-blind; only the grant is late-bound. Determinism holds: replay knows the party state at that log position because the log *is* that state.

**Regional resonance — reconfiguration by carrot, never stick.** Kernels declare 1-2 **resonant tags**; abilities carrying them hit harder in that region. The Fen making frost builds stronger makes you *want* to reroll for it. Buffs, never debuffs — never punish a build, make a new one tempting.

**Reach is weapon-derived, and this is a deliberate build lever.** Reach (`melee | ranged`) and scaling stat are inherent properties of the equipped **weapon archetype**, not the ability or the class. The same ability shifts when you swap weapons — a witch's `Hex Volley` is ranged and scales off a bow, or melee-reach off a staff. This makes weapon choice a build decision instead of a class label ("archers use bows, casters use staves" is exactly what this avoids). Geometry: melee targets the enemy front row unless empty; ranged targets either row. This reuses the existing row system (back-row melee already eats the physical penalty) and creates a real tactical payoff — clearing the front line opens the enemy back row to your melee units. It's battlefield geometry, not a soft gate, so a hard rule is correct here.

---

## 15. Recently resolved

- **Regional arcs** — build now, as a Phase 4 companion. Design in §4.
- **Chess** — build it. Design in §6, implementation in Phase 8.
- **Endgame shape** — resolved by the tier model (§7). Not a fork: "win" and "forever" were different scopes, not competing terminals.
- **Stamp-at-spawn** — retired, superseded by tier-indexed bands (§7).
- **Drift-closing meta stat** — rejected. Rule 2 already covers it: level difference is a damage scalar, so the gap is never feel-bad and needs no upgrade to close.
- **Cross-run bestiary** — rejected as a mechanic. The bestiary is a within-run notepad; cross-run knowledge lives in the player's head, which preserves Rimworld-lite exactly and needs no third meta category.

---

## 16. Open — needs a number

**How long is a run?**

Not a taste question, and not a fork — a calibration parameter that everything downstream depends on.

Tiers are multi-region campaigns: ~24 nodes, multiple cities, deep dungeons, an 18-step quest chain to the boss. Call it 3–6 hours per tier. If the death frontier sits around tier 10–12, **runs are 40–60 hours, and a TPK at hour 50 restarts at tier 1.**

That may be exactly right. Rimworld, Kenshi, and X4 are all built on 100-hour saves that die, and every seed regenerates tier 1 fresh — you're never *replaying* a tier, you're playing a new one. Procedural generation is the anti-tedium mechanism, and it may fully cover this.

Or it may mean tiers want to be a third of that size.

The number determines: the XP curve, band spacing, tier count to frontier, meta magnitude, and what Phase 2's generator is aiming at. **It blocks Phase 2's calibration, though not Phase 1.**
