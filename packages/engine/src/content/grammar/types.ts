/**
 * Weighted-rule symbol expansion (Tracery's core model, reimplemented
 * against Rng — see engine.ts). A plain string expansion has weight 1;
 * `{ text, weight }` lets some expansions be commoner than others.
 */
export type RuleExpansion = string | { readonly text: string; readonly weight: number };

export interface Grammar {
  readonly id: string;
  /** Optional kernel binding (Phase 2's RegionKernel id) — enables the reserved `#kernelRoot#` symbol. */
  readonly kernelId?: string;
  readonly rules: Readonly<Record<string, readonly RuleExpansion[]>>;
}
