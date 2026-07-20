// ---------------------------------------------------------------------
// Battle tab — interactive CTB fights against the real resolver. Every
// "turn" replays runBattle(request, inputs, ctx) from tick 0 with one
// more committed input than last time (cheap — fights are short and
// headless) and reads the live pause-point state off the additive
// AwaitingPartyInputError the resolver throws when it needs the next
// scripted input (CLAUDE.md invariant #21 — "a caller must compute
// whose turn is next before prompting"). No battle logic is
// reimplemented here; this file only orchestrates the same exported
// primitives resolver.ts itself uses.
// ---------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import {
  loadEngineContent,
  createRng,
  parseSeed,
  runBattle,
  AwaitingPartyInputError,
  EventLogWriter,
  remainingTurnsForStatus,
  resolvedActionCost,
  isBroken,
  BASE_ACTION_TICKS,
  eligibleTargets,
  type BattleRequest,
  type BattleInput,
  type LiveCombatant,
  type Ability,
  type ContentPort,
  type Event,
} from "../engine/access.js";
import { debugPresetParty } from "../engine/party.js";
import { debugRollEncounter } from "../engine/encounter.js";
import { debugRollGear } from "../engine/gear.js";
import type { DebugLog } from "../debugLog.js";

export interface BattleTabProps {
  readonly seed: string;
  readonly log: DebugLog;
}

export const BATTLE_TAB_LEGEND =
  "up/down select · enter confirm · esc back · +/- band (pre-fight) · r reset · n reroll encounter · g reroll rewards";

type MenuEntry = { kind: "ability"; ability: Ability } | { kind: "defend" } | { kind: "scan" };
type UiPhase = "ability-menu" | "target-menu";

function queuePreview(actors: readonly LiveCombatant[]): LiveCombatant[] {
  return [...actors]
    .filter((a) => !a.koed)
    .sort((a, b) => (a.nextActionTick !== b.nextActionTick ? a.nextActionTick - b.nextActionTick : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Human-readable, one line per resolved event, naming actor/target/effect
 * by their display name rather than internal ids or raw ability ids —
 * "no raw event JSON" (CLAUDE.md "Debug tooling" §2). `names`/`content`
 * are read-only lookups; this never re-derives or mutates battle state.
 */
function formatEvent(e: Event, names: ReadonlyMap<string, string>, content: ContentPort): string {
  const p = e.payload as Record<string, unknown>;
  const who = (id: unknown): string => (typeof id === "string" ? (names.get(id) ?? id) : String(id));
  const abilityName = (id: unknown): string => {
    if (typeof id !== "string") return String(id);
    try {
      return content.getAbility(id).name;
    } catch {
      return id;
    }
  };
  switch (e.type) {
    case "battle:damage":
      return `[${e.tick}] ${who(p.actorId)} hits ${who(p.targetId)} with ${abilityName(p.abilityId)} — ${p.amount} dmg${p.isCrit ? " (crit)" : ""}${p.isWeaknessHit ? " (weakness hit!)" : ""}`;
    case "battle:heal":
      return `[${e.tick}] ${who(p.actorId)} heals ${who(p.targetId)} for ${p.amount} (${abilityName(p.abilityId)})`;
    case "battle:status":
      return `[${e.tick}] ${who(p.actorId)} inflicts ${p.status} on ${who(p.targetId)}`;
    case "battle:dot":
      return `[${e.tick}] ${who(p.actorId)} suffers ${p.amount} damage over time`;
    case "battle:break":
      return `[${e.tick}] ${who(p.targetId)}'s Break shield shatters — vulnerable until tick ${p.windowUntilTick}`;
    case "battle:buff":
    case "battle:debuff":
      return `[${e.tick}] ${who(p.actorId)} ${e.type === "battle:buff" ? "buffs" : "debuffs"} ${who(p.targetId)}'s ${p.stat} by ${p.magnitude}`;
    case "battle:shift_queue":
      return `[${e.tick}] ${who(p.actorId)} shifts ${who(p.targetId)}'s turn ${p.direction} by ${p.amount} ticks`;
    case "battle:scan":
      return `[${e.tick}] ${who(p.actorId)} scans ${who(p.targetId)}`;
    case "battle:referenceable":
      return `[${e.tick}] ${p.who} — ${p.what}`;
    default:
      return `[${e.tick}] ${e.type} ${JSON.stringify(p)}`;
  }
}

function computeTargetPool(actor: LiveCombatant, party: readonly LiveCombatant[], enemies: readonly LiveCombatant[], entry: MenuEntry): LiveCombatant[] {
  if (entry.kind === "scan") return [...party, ...enemies].filter((c) => !c.koed);
  if (entry.kind === "defend") return [];
  const ability = entry.ability;
  if (ability.targetShape === "self") return [];
  const isOffensive = ability.effects.some((e) => e.primitive === "damage");
  const isSupport = ability.effects.some((e) => e.primitive === "heal" || e.primitive === "buff");
  let pool: LiveCombatant[] = isOffensive ? [...enemies] : isSupport ? [...party] : [...party, ...enemies];
  pool = pool.filter((c) => !c.koed);
  if (isOffensive && actor.reach) pool = [...eligibleTargets(actor.reach, pool)];
  return pool;
}

export function BattleTab({ seed, log }: BattleTabProps): React.ReactElement {
  const { stdout } = useStdout();
  const content = useMemo(() => loadEngineContent(), []);
  const [level] = useState(5);
  const party = useMemo(() => debugPresetParty(content, level), [content, level]);

  const [band, setBand] = useState(5);
  const [encounterSeq, setEncounterSeq] = useState(0);
  const [fightSeq, setFightSeq] = useState(0);
  const [inputs, setInputs] = useState<BattleInput[]>([]);
  const [rewardRerollSeq, setRewardRerollSeq] = useState(0);

  const encounterId = `debug-tui-fight-${fightSeq}`;
  const encounter = useMemo(() => {
    const rng = createRng(parseSeed(seed)).substream(`debug-tui:encounter-roll:${encounterSeq}`);
    return debugRollEncounter(content, band, rng, 2);
  }, [content, seed, band, encounterSeq]);

  const request: BattleRequest = useMemo(
    () => ({ party, encounter, encounterId, counteredArchetypeIds: new Set() }),
    [party, encounter, encounterId],
  );

  const step = useMemo(() => {
    const rng = createRng(parseSeed(seed)).substream(`battle:${request.encounterId}`);
    const ctx = { content, rng, log: new EventLogWriter(), startTick: 0 };
    try {
      const result = runBattle(request, inputs, ctx);
      return { status: "complete" as const, result, events: result.log as Event[] };
    } catch (e) {
      if (e instanceof AwaitingPartyInputError) {
        return {
          status: "awaiting" as const,
          actorId: e.actorId,
          tick: e.tick,
          party: e.party,
          enemies: e.enemies,
          events: ctx.log.toArray() as Event[],
        };
      }
      throw e;
    }
  }, [request, inputs, content]);

  const [uiPhase, setUiPhase] = useState<UiPhase>("ability-menu");
  const [menuCursor, setMenuCursor] = useState(0);
  const [targetCursor, setTargetCursor] = useState(0);
  const [pendingEntry, setPendingEntry] = useState<MenuEntry | null>(null);

  useEffect(() => {
    setUiPhase("ability-menu");
    setMenuCursor(0);
    setTargetCursor(0);
    setPendingEntry(null);
  }, [inputs.length, request.encounterId]);

  const actor = step.status === "awaiting" ? [...step.party, ...step.enemies].find((c) => c.id === step.actorId) : undefined;
  const menu: MenuEntry[] = actor ? [...actor.abilities.map((a) => ({ kind: "ability" as const, ability: a })), { kind: "defend" as const }, { kind: "scan" as const }] : [];
  const targetPool = actor && pendingEntry && step.status === "awaiting" ? computeTargetPool(actor, step.party, step.enemies, pendingEntry) : [];

  function handleReset(): void {
    setInputs([]);
    log.push("battle: reset (same config)");
  }
  function handleRerollEncounter(): void {
    setEncounterSeq((s) => s + 1);
    setFightSeq((s) => s + 1);
    setInputs([]);
    log.push("battle: rerolled encounter");
  }

  useInput((input, key) => {
    if (input === "r") return handleReset();
    if (input === "n") return handleRerollEncounter();
    if (step.status !== "awaiting") {
      if (step.result.outcome === "party_win" && input === "g") setRewardRerollSeq((s) => s + 1);
      return;
    }
    if (inputs.length === 0 && (input === "+" || input === "=")) return setBand((b) => b + 1);
    if (inputs.length === 0 && input === "-") return setBand((b) => Math.max(1, b - 1));
    if (!actor) return;

    if (uiPhase === "ability-menu") {
      if (key.upArrow || input === "w") return setMenuCursor((c) => Math.max(0, c - 1));
      if (key.downArrow || input === "s") return setMenuCursor((c) => Math.min(menu.length - 1, c + 1));
      if (key.return) {
        const entry = menu[menuCursor];
        if (entry.kind === "defend") {
          setInputs((prev) => [...prev, { kind: "defend", actorId: actor.id }]);
          log.push(`battle: ${actor.name} defends`);
          return;
        }
        if (entry.kind === "ability" && entry.ability.targetShape === "self") {
          setInputs((prev) => [...prev, { kind: "ability", actorId: actor.id, abilityId: entry.ability.id }]);
          log.push(`battle: ${actor.name} uses ${entry.ability.name}`);
          return;
        }
        setPendingEntry(entry);
        setTargetCursor(0);
        setUiPhase("target-menu");
      }
      return;
    }

    // target-menu
    if (key.escape) {
      setUiPhase("ability-menu");
      setPendingEntry(null);
      return;
    }
    if (key.upArrow || input === "w") return setTargetCursor((c) => Math.max(0, c - 1));
    if (key.downArrow || input === "s") return setTargetCursor((c) => Math.min(targetPool.length - 1, c + 1));
    if (key.return) {
      const target = targetPool[targetCursor];
      if (!target || !pendingEntry) return;
      if (pendingEntry.kind === "scan") {
        setInputs((prev) => [...prev, { kind: "scan", actorId: actor.id, targetId: target.id }]);
        log.push(`battle: ${actor.name} scans ${target.name}`);
      } else if (pendingEntry.kind === "ability") {
        setInputs((prev) => [...prev, { kind: "ability", actorId: actor.id, abilityId: pendingEntry.ability.id, targetId: target.id }]);
        log.push(`battle: ${actor.name} uses ${pendingEntry.ability.name} on ${target.name}`);
      }
    }
  });

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of party) map.set(p.id, p.name);
    for (const en of encounter) map.set(en.id, en.name);
    return map;
  }, [party, encounter]);

  const tailEvents = step.events.slice(-12);
  const logWidth = Math.max(40, (stdout?.columns ?? 80) - 4);

  return (
    <Box flexDirection="column">
      <Text>
        band {band}
        {inputs.length === 0 ? " (+/- to adjust)" : ""} · party {party.map((p) => p.name).join(", ")} vs{" "}
        {encounter.map((e) => e.name).join(", ")}
      </Text>

      {step.status === "awaiting" && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>upcoming: {queuePreview([...step.party, ...step.enemies]).slice(0, 6).map((c) => `${c.name}${c.id === step.actorId ? "*" : ""}`).join(" -> ")}</Text>
          {/* Stacked, not side-by-side: two independent-height flex columns row-align by
              vertical INDEX, not by combatant, so a status line on one side can land on
              the same terminal row as an unrelated combatant on the other side and read
              as if it belongs to them. Stacking removes the ambiguity entirely. */}
          <Box marginTop={1} flexDirection="column">
            <CombatantColumn title="Party" combatants={step.party} tick={step.tick} />
            <Box marginTop={1}>
              <CombatantColumn title="Enemies" combatants={step.enemies} tick={step.tick} />
            </Box>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text bold>
              {actor?.name}'s turn (tick {step.tick})
            </Text>
            {uiPhase === "ability-menu" &&
              menu.map((entry, i) => (
                <Text key={i} color={i === menuCursor ? "cyan" : undefined}>
                  {i === menuCursor ? "> " : "  "}
                  {entry.kind === "ability" ? `${entry.ability.name} (${entry.ability.resourceCost} MP)` : entry.kind === "defend" ? "Defend" : "Scan"}
                </Text>
              ))}
            {uiPhase === "target-menu" && (
              <Box flexDirection="column">
                <Text dimColor>target for {pendingEntry?.kind === "ability" ? pendingEntry.ability.name : "Scan"}:</Text>
                {targetPool.length === 0 && <Text dimColor>(no legal targets)</Text>}
                {targetPool.map((t, i) => (
                  <Text key={t.id} color={i === targetCursor ? "cyan" : undefined}>
                    {i === targetCursor ? "> " : "  "}
                    {t.name} ({t.hp}/{t.maxHp} HP)
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        </Box>
      )}

      {step.status === "complete" && (
        <OutcomeScreen result={step.result} band={band} content={content} seed={seed} encounterId={encounterId} rewardRerollSeq={rewardRerollSeq} />
      )}

      <Box marginTop={1} flexDirection="column" borderStyle="single" paddingX={1} width={logWidth}>
        <Text dimColor>log</Text>
        {tailEvents.map((e, i) => (
          <Text key={i} wrap="wrap">
            {formatEvent(e, nameById, content)}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function CombatantColumn({ title, combatants, tick }: { title: string; combatants: readonly LiveCombatant[]; tick: number }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      {combatants.map((c) => (
        <Box key={c.id} flexDirection="column">
          <Text color={c.koed ? "gray" : undefined}>
            {c.koed ? "[down] " : ""}
            {c.name} HP {c.hp}/{c.maxHp} MP {c.mp}/{c.maxMp}
            {c.side === "party" ? ` Boost ${c.boost}` : ""}
            {c.breakShieldMax > 0 ? ` Break ${c.breakShieldCurrent}/${c.breakShieldMax}` : ""}
          </Text>
          {isBroken(c, tick) && c.breakWindowUntilTick !== null && (
            <Text color="magenta">
              {"  "}
              BROKEN — window closes in {((c.breakWindowUntilTick - tick) / resolvedActionCost(c, BASE_ACTION_TICKS, tick)).toFixed(1)} turns
            </Text>
          )}
          {c.statuses.map((s) => {
            const cost = resolvedActionCost(c, BASE_ACTION_TICKS, tick);
            const turns = remainingTurnsForStatus(s, c, tick, cost);
            return (
              <Text key={s.id} dimColor>
                {"  "}
                {s.statusId} ({turns.toFixed(1)} turns left)
              </Text>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

function OutcomeScreen({
  result,
  band,
  content,
  seed,
  encounterId,
  rewardRerollSeq,
}: {
  result: import("../engine/access.js").BattleResult;
  band: number;
  content: ReturnType<typeof loadEngineContent>;
  seed: string;
  encounterId: string;
  rewardRerollSeq: number;
}): React.ReactElement {
  const won = result.outcome === "party_win";
  const gearDrops = useMemo(() => {
    if (!won) return [];
    const rng = createRng(parseSeed(seed)).substream(`debug-tui:reward-roll:${encounterId}:${rewardRerollSeq}`);
    const weapons = content.listWeaponArchetypes();
    return Array.from({ length: 2 }, () => debugRollGear(band, weapons, rng));
  }, [won, seed, encounterId, rewardRerollSeq, band, content]);

  return (
    <Box marginTop={1} flexDirection="column" borderStyle="double" paddingX={1}>
      <Text bold color={won ? "green" : "red"}>
        {won ? "VICTORY" : "DEFEAT"} — tickCost {result.tickCost}
      </Text>
      {won && (
        <Box flexDirection="column">
          <Text>gold: {result.rewards.gold}</Text>
          <Text dimColor>gear (debug-only roll, not real Phase 13 loot):</Text>
          {gearDrops.map((g, i) => (
            <Text key={i}>
              {"  "}
              {g.name}
            </Text>
          ))}
          {result.partyDeltas.map((d) => (
            <Text key={d.id}>
              {d.id}: {d.xpEarned} XP{d.woundsGained > 0 ? `, +${d.woundsGained} wound` : ""}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
