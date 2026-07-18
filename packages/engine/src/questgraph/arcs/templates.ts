import type { ArcTemplate } from "./types.js";

/**
 * 3-4 hand-authored arc fixtures (Deliverable 7's "same discipline as
 * Phase 3's job fixtures" — prove the model, defer the full 15-20
 * roster). All four share one proven beat-graph topology (rally →
 * escalate-or-confront → confrontation, with tick-timeout branches
 * peeling off toward StatusQuo/Lockdown along the way) re-themed per
 * template — reusing a validated shape across flavors is "generated
 * variety, authored structure" applied to arcs the same way it's
 * applied everywhere else in this project, not corner-cutting.
 *
 * `theme` matches this template against a region kernel's `arcPool`
 * theme (questgraph/arcs/select.ts) — three of the four are themed;
 * Siege is the universal fallback so every kernel always has at least
 * 3 eligible templates to weight-select from.
 */
export const ARC_TEMPLATES: readonly ArcTemplate[] = [
  {
    id: "arc:overthrow",
    name: "Overthrow",
    theme: "political",
    trackedVariable: "tyrantSupport",
    initialValue: 100,
    startBeatId: "rally-opposition",
    beats: [
      {
        id: "rally-opposition",
        questTemplate: "fetch",
        delta: -20,
        onQuestComplete: "expose-corruption",
        onTickTimeout: "T:StatusQuo",
      },
      {
        id: "expose-corruption",
        questTemplate: "deliver",
        delta: -30,
        onQuestComplete: "confrontation",
        onTickTimeout: "tyrant-consolidates",
      },
      {
        id: "tyrant-consolidates",
        questTemplate: "kill",
        delta: 15,
        onQuestComplete: "confrontation",
        onTickTimeout: "T:Lockdown",
      },
      {
        id: "confrontation",
        questTemplate: "kill",
        delta: -40,
        onQuestComplete: "T:Victory",
        onTickTimeout: "T:Inversion",
      },
    ],
    terminals: [
      { id: "T:Victory", outcomeTag: "Victory" },
      { id: "T:Lockdown", outcomeTag: "Lockdown" },
      { id: "T:StatusQuo", outcomeTag: "StatusQuo" },
      { id: "T:Inversion", outcomeTag: "Inversion" },
    ],
  },
  {
    id: "arc:plague",
    name: "Plague",
    theme: "disaster",
    trackedVariable: "contagionSpread",
    initialValue: 20,
    startBeatId: "identify-source",
    beats: [
      {
        id: "identify-source",
        questTemplate: "fetch",
        delta: 10,
        onQuestComplete: "contain-outbreak",
        onTickTimeout: "T:StatusQuo",
      },
      {
        id: "contain-outbreak",
        questTemplate: "deliver",
        delta: -15,
        onQuestComplete: "final-cure",
        onTickTimeout: "outbreak-worsens",
      },
      {
        id: "outbreak-worsens",
        questTemplate: "escort",
        delta: 25,
        onQuestComplete: "final-cure",
        onTickTimeout: "T:Lockdown",
      },
      {
        id: "final-cure",
        questTemplate: "deliver",
        delta: -30,
        onQuestComplete: "T:Victory",
        onTickTimeout: "T:Inversion",
      },
    ],
    terminals: [
      { id: "T:Victory", outcomeTag: "Victory" },
      { id: "T:Lockdown", outcomeTag: "Lockdown" },
      { id: "T:StatusQuo", outcomeTag: "StatusQuo" },
      { id: "T:Inversion", outcomeTag: "Inversion" },
    ],
  },
  {
    id: "arc:cult-uprising",
    name: "Cult Uprising",
    theme: "cult",
    trackedVariable: "cultInfluence",
    initialValue: 100,
    startBeatId: "investigate-rumors",
    beats: [
      {
        id: "investigate-rumors",
        questTemplate: "fetch",
        delta: -15,
        onQuestComplete: "infiltrate-cell",
        onTickTimeout: "T:StatusQuo",
      },
      {
        id: "infiltrate-cell",
        questTemplate: "escort",
        delta: -25,
        onQuestComplete: "confront-high-priest",
        onTickTimeout: "cult-entrenches",
      },
      {
        id: "cult-entrenches",
        questTemplate: "kill",
        delta: 20,
        onQuestComplete: "confront-high-priest",
        onTickTimeout: "T:Lockdown",
      },
      {
        id: "confront-high-priest",
        questTemplate: "kill",
        delta: -35,
        onQuestComplete: "T:Victory",
        onTickTimeout: "T:Inversion",
      },
    ],
    terminals: [
      { id: "T:Victory", outcomeTag: "Victory" },
      { id: "T:Lockdown", outcomeTag: "Lockdown" },
      { id: "T:StatusQuo", outcomeTag: "StatusQuo" },
      { id: "T:Inversion", outcomeTag: "Inversion" },
    ],
  },
  {
    id: "arc:siege",
    name: "Siege",
    theme: "universal",
    trackedVariable: "wallIntegrity",
    initialValue: 100,
    startBeatId: "scout-enemy",
    beats: [
      {
        id: "scout-enemy",
        questTemplate: "fetch",
        delta: -10,
        onQuestComplete: "reinforce-defenses",
        onTickTimeout: "T:StatusQuo",
      },
      {
        id: "reinforce-defenses",
        questTemplate: "deliver",
        delta: 20,
        onQuestComplete: "last-stand",
        onTickTimeout: "enemy-breaches",
      },
      {
        id: "enemy-breaches",
        questTemplate: "escort",
        delta: -30,
        onQuestComplete: "last-stand",
        onTickTimeout: "T:Lockdown",
      },
      {
        id: "last-stand",
        questTemplate: "kill",
        delta: -35,
        onQuestComplete: "T:Victory",
        onTickTimeout: "T:Inversion",
      },
    ],
    terminals: [
      { id: "T:Victory", outcomeTag: "Victory" },
      { id: "T:Lockdown", outcomeTag: "Lockdown" },
      { id: "T:StatusQuo", outcomeTag: "StatusQuo" },
      { id: "T:Inversion", outcomeTag: "Inversion" },
    ],
  },
];

/** Which arc themes a kernel is eligible for, derived from Phase 2's kernel `arcPool` fixture data (fen/hollow/canopy/cinderreach — read-only, not reopened this phase). See questgraph/arcs/select.ts. */
export const KERNEL_ARC_THEMES: Readonly<Record<string, readonly ("political" | "disaster" | "cult")[]>> = {
  "kernel:fen": ["political", "cult"],
  "kernel:hollow": ["disaster", "cult"],
  "kernel:canopy": ["disaster", "political"],
  "kernel:cinderreach": ["political", "disaster"],
};
