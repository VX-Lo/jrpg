// ---------------------------------------------------------------------
// The battle resolver — the CTB main loop. A pure function of
// (BattleRequest, ordered BattleInput[], rng substream) per CLAUDE.md
// §2: same three inputs, bit-identical BattleResult and log.
// ---------------------------------------------------------------------

import type { ContentPort } from "../content/index.js";
import type { Ability, BuffableStat, Effect, PrimaryStat, TagId, TargetShape } from "../content/types.js";
import { rollLootedGear } from "../content/gearInstance.js";
import type { EventLogWriter } from "../log/index.js";
import type { Rng } from "../rng/index.js";
import { grantBoostForTurn, setBoostPressure, spendBoost, applyBreakDamage } from "./breakBoost.js";
import { nextActor, resolvedActionCost, scheduleNextAction } from "./clock.js";
import { rollDamage } from "./damage.js";
import { logCombatantDowned } from "./events.js";
import { addModifier, pruneExpiredModifiers, resolveVariable } from "./registry.js";
import { eligibleTargets } from "./rows.js";
import { avgStat, buildLiveState } from "./state.js";
import { activeGrantedTags, applyStatus, tickStatusesOnTurnStart } from "./status.js";
import { decideEnemyAction } from "./ai.js";
import type {
  AbilityInput,
  BattleInput,
  BattleRequest,
  BattleResult,
  BestiaryObservation,
  LiveCombatant,
  PartyMemberDelta,
} from "./types.js";

export interface BattleContext {
  readonly content: ContentPort;
  /** Must already be the battle's own substream (CLAUDE.md §2 — e.g. rootRng.substream(`battle:${request.encounterId}`)). Never a shared/ambient stream. */
  readonly rng: Rng;
  readonly log: EventLogWriter;
  readonly startTick: number;
}

/**
 * Thrown instead of a plain Error specifically when the scripted input
 * stream has run OUT (as opposed to the next input naming the wrong
 * actor, which stays a plain Error — that's a real caller bug). Carries
 * the live state at the exact pause point so an interactive caller
 * (CLAUDE.md §21 — "a caller must compute whose turn is next before
 * prompting") can render it and decide the next input without
 * duplicating any resolver logic. Not part of the determinism contract:
 * replaying with one more input appended reproduces everything up to
 * this point bit-identically, same as any other prefix of `inputs`.
 */
export class AwaitingPartyInputError extends Error {
  constructor(
    readonly actorId: string,
    readonly tick: number,
    readonly party: readonly LiveCombatant[],
    readonly enemies: readonly LiveCombatant[],
  ) {
    super(
      `battle: awaiting scripted input for actor "${actorId}" at tick ${tick} — the determinism contract ` +
        `requires an ordered BattleInput[] matching queue order exactly.`,
    );
    this.name = "AwaitingPartyInputError";
  }
}

const DEFEND_DAMAGE_TAKEN_MULT = 0.5;
const DEFEND_NEXT_ACTION_COST_MULT = 0.75;
const SCAN_TICK_COST = 500;

function findCombatant(id: string, party: readonly LiveCombatant[], enemies: readonly LiveCombatant[]): LiveCombatant | undefined {
  return party.find((c) => c.id === id) ?? enemies.find((c) => c.id === id);
}

function sideOf(id: string, party: readonly LiveCombatant[], enemies: readonly LiveCombatant[]): readonly LiveCombatant[] {
  return party.some((c) => c.id === id) ? party : enemies;
}

/**
 * Deterministic auto-retarget (CLAUDE.md §9): if the originally-targeted
 * combatant is dead by the time an action resolves, retarget to the
 * alive combatant with the lexicographically smallest id on the same
 * side rather than wasting the turn.
 */
function autoRetarget(originalTargetId: string, party: readonly LiveCombatant[], enemies: readonly LiveCombatant[]): LiveCombatant | undefined {
  const side = sideOf(originalTargetId, party, enemies);
  const alive = side.filter((c) => !c.koed);
  if (alive.length === 0) return undefined;
  return [...alive].sort((a, b) => a.id.localeCompare(b.id))[0];
}

function expandTargets(
  shape: TargetShape,
  actor: LiveCombatant,
  primaryTarget: LiveCombatant | undefined,
  party: readonly LiveCombatant[],
  enemies: readonly LiveCombatant[],
): readonly LiveCombatant[] {
  if (shape === "self") return [actor];
  if (!primaryTarget) return [];
  const side = sideOf(primaryTarget.id, party, enemies);
  if (shape === "one") return [primaryTarget];
  if (shape === "row") return side.filter((c) => !c.koed && c.row === primaryTarget.row);
  return side.filter((c) => !c.koed); // "all"
}

function applyDamageToHp(
  target: LiveCombatant,
  amount: number,
  tick: number,
  encounterId: string,
  log: EventLogWriter,
): void {
  target.hp = Math.max(0, target.hp - amount);
  if (target.hp === 0 && !target.koed) {
    target.koed = true;
    if (target.side === "party") target.wounds += 1;
    logCombatantDowned(log, tick, encounterId, target);
  }
}

function applyBuffDebuff(
  target: LiveCombatant,
  primitive: "buff" | "debuff",
  stat: BuffableStat,
  magnitude: number,
  durationTicks: number,
  source: string,
  tick: number,
): void {
  const sign = primitive === "debuff" ? -1 : 1;
  if (stat === "threat") {
    addModifier(target, {
      targetVariable: "threatGenerationMult",
      operation: "multiply",
      magnitude: Math.max(0, 1 + sign * magnitude),
      durationTicks,
      source,
      currentTick: tick,
    });
  } else {
    addModifier(target, {
      targetVariable: stat,
      operation: "add",
      magnitude: sign * magnitude,
      durationTicks,
      source,
      currentTick: tick,
    });
  }
}

function relevantStatForAbility(
  ability: Ability,
  actor: LiveCombatant,
  content: ContentPort,
  tick: number,
): { value: number; hasMasteryMatch: boolean } {
  const effect = ability.effects.find((e) => e.primitive === "damage" || e.primitive === "heal");
  const formula = effect ? (effect.params as { powerFormula: { base: { kind: string; stat?: string } } }).powerFormula : undefined;
  let value = 0;
  if (formula) {
    if (formula.base.kind === "primary_stat" && formula.base.stat) {
      value = resolveVariable(actor, formula.base.stat as PrimaryStat, tick);
    } else if (formula.base.kind === "weapon_scaling" && actor.weaponArchetypeId) {
      const weapon = content.getWeaponArchetype(actor.weaponArchetypeId);
      value = resolveVariable(actor, weapon.scalingStat, tick);
    }
  }
  let hasMasteryMatch = false;
  if (actor.side === "party") {
    // jobId isn't retained on LiveCombatant; mastery is resolved once at state-build time via
    // primaryDomainTag vs the actor's tags (job.allowedTags carries primaryTag membership signal).
    hasMasteryMatch = actor.tags.includes(ability.primaryDomainTag);
  }
  return { value, hasMasteryMatch };
}

function executeEffect(
  effect: Effect,
  actor: LiveCombatant,
  ability: Ability,
  targets: readonly LiveCombatant[],
  ctx: BattleContext,
  tick: number,
  uncountered: (target: LiveCombatant) => boolean,
  encounterId: string,
): void {
  const source = `${actor.id}:${ability.id}`;
  switch (effect.primitive) {
    case "damage": {
      const params = effect.params as { powerFormula: Parameters<typeof rollDamage>[0]["powerFormula"]; channel?: "physical" | "magical" | "true" };
      const { value, hasMasteryMatch } = relevantStatForAbility(ability, actor, ctx.content, tick);
      for (const target of targets) {
        // A setup status (e.g. oiled) can grant a tag dynamically at runtime —
        // merge it in alongside the target's authored tags so the weakness
        // lookup sees it too (CLAUDE.md "Fixture content" decisions log:
        // hasVulnerabilityTag existed but was never wired into damage
        // resolution, so a status-granted tag could never trigger a weakness
        // hit or deplete Break shield; this closes that gap).
        const weaknessTags: readonly TagId[] = ctx.content.getWeaknessesFor([...target.tags, ...activeGrantedTags(target, tick)]);
        const roll = rollDamage({
          attacker: actor,
          target,
          powerFormula: params.powerFormula,
          channel: params.channel ?? "physical",
          abilityTags: ability.tags,
          targetWeaknessTags: weaknessTags,
          relevantStatValue: value,
          jobLevel: actor.level,
          hasMasteryMatch,
          uncountered: uncountered(target),
          currentTick: tick,
          rng: ctx.rng,
        });
        applyDamageToHp(target, roll.amount, tick, encounterId, ctx.log);
        if (roll.isWeaknessHit && applyBreakDamage(target, roll.weaknessPortion, tick)) {
          ctx.log.append(tick, "battle:break", { targetId: target.id, windowUntilTick: target.breakWindowUntilTick });
        }
        ctx.log.append(tick, "battle:damage", {
          actorId: actor.id,
          targetId: target.id,
          abilityId: ability.id,
          amount: roll.amount,
          isCrit: roll.isCrit,
          isWeaknessHit: roll.isWeaknessHit,
        });
      }
      break;
    }
    case "heal": {
      const params = effect.params as { powerFormula: Parameters<typeof rollDamage>[0]["powerFormula"] };
      const { value, hasMasteryMatch } = relevantStatForAbility(ability, actor, ctx.content, tick);
      const jobLevelBonus = hasMasteryMatch ? actor.level : 0;
      const base = value + jobLevelBonus;
      const multiplierProduct = params.powerFormula.multipliers.reduce((p, m) => p * (m.value ?? 1), 1);
      const amount = Math.max(0, Math.round(base * multiplierProduct));
      for (const target of targets) {
        target.hp = Math.min(target.maxHp, target.hp + amount);
        ctx.log.append(tick, "battle:heal", { actorId: actor.id, targetId: target.id, abilityId: ability.id, amount });
      }
      break;
    }
    case "apply_status": {
      const params = effect.params as { status: Parameters<typeof applyStatus>[1]["status"]; baseDuration: number; baseMagnitude: number };
      for (const target of targets) {
        applyStatus(target, { status: params.status, baseDuration: params.baseDuration, baseMagnitude: params.baseMagnitude, source, currentTick: tick });
        ctx.log.append(tick, "battle:status", { actorId: actor.id, targetId: target.id, status: params.status });
      }
      break;
    }
    case "shift_queue": {
      const params = effect.params as { direction: "forward" | "back"; amount: number };
      for (const target of targets) {
        if (params.direction === "back") {
          target.nextActionTick += params.amount;
        } else {
          target.nextActionTick = Math.max(tick, target.nextActionTick - params.amount);
        }
        ctx.log.append(tick, "battle:shift_queue", { actorId: actor.id, targetId: target.id, direction: params.direction, amount: params.amount });
      }
      break;
    }
    case "modify_threat": {
      const params = effect.params as { amount: number };
      for (const target of targets) {
        target.threat = Math.max(0, target.threat + params.amount);
      }
      break;
    }
    case "buff":
    case "debuff": {
      const params = effect.params as { stat: BuffableStat; magnitude: number; durationTicks: number };
      for (const target of targets) {
        applyBuffDebuff(target, effect.primitive, params.stat, params.magnitude, params.durationTicks, source, tick);
        ctx.log.append(tick, `battle:${effect.primitive}`, { actorId: actor.id, targetId: target.id, stat: params.stat, magnitude: params.magnitude });
      }
      break;
    }
  }
}

function checkOutcome(party: readonly LiveCombatant[], enemies: readonly LiveCombatant[]): "party_win" | "tpk" | undefined {
  if (enemies.every((e) => e.koed)) return "party_win";
  if (party.every((p) => p.koed)) return "tpk";
  return undefined;
}

function xpForEnemy(enemy: LiveCombatant, partyAvgLevel: number): number {
  const base = enemy.level * 10;
  const diff = partyAvgLevel - enemy.level;
  const scalar = Math.max(0, Math.min(1.5, 1 - diff * 0.1));
  return Math.round(base * scalar);
}

function buildBestiaryObservations(scanned: readonly LiveCombatant[], content: ContentPort): readonly BestiaryObservation[] {
  return scanned
    .filter((e) => e.side === "enemy")
    .map((e) => ({
      archetypeId: e.id,
      tagsRevealed: e.tags,
      weaknessesRevealed: content.getWeaknessesFor(e.tags),
    }));
}

function finalizeResult(
  outcome: "party_win" | "tpk",
  party: readonly LiveCombatant[],
  enemies: readonly LiveCombatant[],
  tickCost: number,
  ctx: BattleContext,
  band: number,
): BattleResult {
  const partyAvgLevel = party.reduce((s, p) => s + p.level, 0) / Math.max(1, party.length);
  const xpTotal = outcome === "party_win" ? enemies.reduce((s, e) => s + xpForEnemy(e, partyAvgLevel), 0) : 0;
  const xpPerMember = Math.floor(xpTotal / Math.max(1, party.length));
  const partyDeltas: readonly PartyMemberDelta[] = party.map((p) => ({
    id: p.id,
    hp: p.hp,
    mp: p.mp,
    woundsGained: p.wounds,
    koed: p.koed,
    xpEarned: outcome === "party_win" ? xpPerMember : 0,
    finalBoost: p.boost,
  }));
  const gold = outcome === "party_win" ? enemies.reduce((s, e) => s + e.level * 5, 0) : 0;
  const gear =
    outcome === "party_win"
      ? [rollLootedGear(ctx.content.listWeaponArchetypes(), ctx.content.listArmorArchetypes(), band, ctx.rng.substream("battle:gear-reward"), `gear:${enemies[0]?.id ?? "none"}`)]
      : [];
  const bestiaryObservations = buildBestiaryObservations(enemies.filter((e) => e.scanned || e.koed), ctx.content);
  return {
    outcome,
    partyDeltas,
    rewards: { gold, gear },
    tickCost,
    log: ctx.log.toArray(),
    bestiaryObservations,
  };
}

/**
 * Runs a full CTB battle from a scripted BattleInput[] stream. Never
 * iterates tick-by-tick — jumps the clock to the next actor's
 * nextActionTick each step (CLAUDE.md §4).
 */
export function runBattle(request: BattleRequest, inputs: readonly BattleInput[], ctx: BattleContext): BattleResult {
  const { party, enemies } = buildLiveState(request, ctx.content, ctx.startTick);
  const uncountered = (target: LiveCombatant) => target.side === "enemy" && !target.countered && target.counterMaterial !== undefined;
  let inputIndex = 0;
  let tick = ctx.startTick;

  for (;;) {
    const outcome = checkOutcome(party, enemies);
    if (outcome) return finalizeResult(outcome, party, enemies, tick - ctx.startTick, ctx, request.band ?? 1);

    const actor = nextActor([...party, ...enemies]);
    tick = actor.nextActionTick;
    pruneExpiredModifiers(actor, tick);

    if (actor.side === "party") {
      const wounded = actor.hp < actor.maxHp * 0.5 || actor.koed;
      setBoostPressure(actor, wounded, tick);
      grantBoostForTurn(actor, tick);
    }

    // Defend reduces the guarding actor's OWN next action cost (CLAUDE.md §4) — consumed here,
    // the first time their turn comes back around after guarding.
    let nextActionCostMult = 1;
    if (actor.defending) {
      actor.modifiers = actor.modifiers.filter((m) => m.source !== `defend:${actor.id}`);
      actor.defending = false;
      nextActionCostMult = DEFEND_NEXT_ACTION_COST_MULT;
    }

    const statusResult = tickStatusesOnTurnStart(actor, tick);
    if (statusResult.dotDamage > 0) {
      const dotAmount = Math.round(statusResult.dotDamage);
      ctx.log.append(tick, "battle:dot", { actorId: actor.id, amount: dotAmount });
      applyDamageToHp(actor, dotAmount, tick, request.encounterId, ctx.log);
    }
    if (actor.koed) continue;
    if (statusResult.skipTurn) continue;

    if (actor.side === "enemy") {
      const decision = decideEnemyAction(actor, party, {
        threshold: actor.threatThreshold ?? 0,
        targetSelectionRule: actor.threatBehavior === "assassin" ? "lowest_hp" : actor.threatBehavior === "opportunist" ? "lowest_threat" : "highest_threat",
      });
      if (!decision) {
        scheduleNextAction(actor, resolvedActionCost(actor, 1000, tick));
        continue;
      }
      const targets = expandTargets(decision.ability.targetShape, actor, decision.target, party, enemies);
      for (const effect of decision.ability.effects) {
        executeEffect(effect, actor, decision.ability, targets, ctx, tick, uncountered, request.encounterId);
      }
      scheduleNextAction(actor, resolvedActionCost(actor, decision.ability.tickCost, tick));
      continue;
    }

    // Party turn — consume the next scripted input.
    const input = inputs[inputIndex];
    if (!input) {
      throw new AwaitingPartyInputError(actor.id, tick, party, enemies);
    }
    if (input.actorId !== actor.id) {
      throw new Error(
        `battle: expected next scripted input for actor "${actor.id}" at tick ${tick}, ` +
          `got "${input.actorId}" — the determinism contract requires an ordered BattleInput[] matching ` +
          `queue order exactly.`,
      );
    }
    inputIndex++;

    if (input.kind === "defend") {
      actor.defending = true;
      addModifier(actor, {
        targetVariable: "damageTakenMult",
        operation: "multiply",
        magnitude: DEFEND_DAMAGE_TAKEN_MULT,
        durationTicks: null,
        source: `defend:${actor.id}`,
        currentTick: tick,
      });
      scheduleNextAction(actor, Math.floor(resolvedActionCost(actor, 1000, tick) * nextActionCostMult));
      continue;
    }

    if (input.kind === "scan") {
      const target = findCombatant(input.targetId, party, enemies);
      if (target) {
        target.scanned = true;
        ctx.log.append(tick, "battle:scan", { actorId: actor.id, targetId: target.id });
      }
      scheduleNextAction(actor, Math.floor(resolvedActionCost(actor, SCAN_TICK_COST, tick) * nextActionCostMult));
      continue;
    }

    // input.kind === "ability"
    const abilityInput = input as AbilityInput;
    const ability = ctx.content.getAbility(abilityInput.abilityId);
    let primaryTarget: LiveCombatant | undefined;
    if (ability.targetShape !== "self") {
      if (!abilityInput.targetId) {
        throw new Error(`battle: ability "${ability.id}" with targetShape "${ability.targetShape}" requires a targetId`);
      }
      const requested = findCombatant(abilityInput.targetId, party, enemies);
      primaryTarget = requested && !requested.koed ? requested : autoRetarget(abilityInput.targetId, party, enemies);

      // Weapon geometry (D6/CLAUDE.md §7): an offensive melee action targeting the opposing
      // side must land on the front row unless it's empty. Never a wasted turn — redirect
      // to the deterministic legal target rather than rejecting the input.
      const isOffensive = ability.effects.some((e) => e.primitive === "damage");
      if (isOffensive && primaryTarget && primaryTarget.side !== actor.side && actor.reach) {
        const opposingSide = sideOf(primaryTarget.id, party, enemies);
        const legal = eligibleTargets(actor.reach, opposingSide);
        if (!legal.includes(primaryTarget)) primaryTarget = legal[0];
      }
    }
    const targets = expandTargets(ability.targetShape, actor, primaryTarget, party, enemies);

    if (abilityInput.boostSpend && abilityInput.boostSpend > 0) {
      const spent = spendBoost(actor, abilityInput.boostSpend);
      if (spent > 0) {
        addModifier(actor, {
          targetVariable: "damageDealtMult",
          operation: "multiply",
          magnitude: 1 + 0.2 * spent,
          durationTicks: 1,
          source: `boost:${actor.id}:${tick}`,
          currentTick: tick,
        });
      }
    }

    for (const effect of ability.effects) {
      executeEffect(effect, actor, ability, targets, ctx, tick, uncountered, request.encounterId);
    }

    actor.mp = Math.max(0, actor.mp - ability.resourceCost * resolveVariable(actor, "mpCostMult", tick));
    scheduleNextAction(actor, Math.floor(resolvedActionCost(actor, ability.tickCost, tick) * nextActionCostMult));
  }
}

export { avgStat, eligibleTargets };
