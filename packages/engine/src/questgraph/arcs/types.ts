/** No new mechanical vocabulary — a Beat is an existing quest template plus a variable delta (Deliverable 7). */
export type QuestTemplateKind = "fetch" | "kill" | "deliver" | "escort";

export type ArcOutcomeTag = "Victory" | "Lockdown" | "StatusQuo" | "Inversion";

/**
 * Theme used to weight arc-template selection against a region kernel
 * (questgraph/arcs/select.ts). "universal" templates are eligible
 * everywhere as a fallback — see CLAUDE.md for why exactly 3 themed
 * buckets: they mirror the latent 3-theme × 4-kernel structure already
 * present in Phase 2's kernel `arcPool` fixture data.
 */
export type ArcTheme = "political" | "disaster" | "cult" | "universal";

export interface BeatDef {
  readonly id: string;
  readonly questTemplate: QuestTemplateKind;
  /** Applied to the arc's tracked variable when this Beat resolves, whichever transition fires. */
  readonly delta: number;
  /** Next beat/terminal id when the Beat's quest is completed. */
  readonly onQuestComplete: string;
  /** Next beat/terminal id when world ticks accumulate past ARC_BEAT_TICK_THRESHOLD before the quest is completed — the arc doesn't wait for the player. */
  readonly onTickTimeout: string;
}

export interface TerminalBeatDef {
  readonly id: string;
  readonly outcomeTag: ArcOutcomeTag;
}

export interface ArcTemplate {
  readonly id: string;
  readonly name: string;
  readonly theme: ArcTheme;
  readonly trackedVariable: string;
  readonly initialValue: number;
  readonly startBeatId: string;
  readonly beats: readonly BeatDef[];
  readonly terminals: readonly TerminalBeatDef[];
}

/** One step of a simulated arc instance's trajectory — the fabula the terminal-event log line is drawn from. */
export interface BeatTransition {
  readonly beatId: string;
  readonly firedBy: "questComplete" | "tickTimeout";
  readonly delta: number;
  readonly variableValueAfter: number;
}

export interface ArcInstanceResult {
  readonly templateId: string;
  readonly regionId: string;
  readonly trajectory: readonly BeatTransition[];
  readonly terminalBeatId: string;
  readonly outcomeTag: ArcOutcomeTag;
  readonly finalVariableValue: number;
}
