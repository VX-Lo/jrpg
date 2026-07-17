/**
 * A single entry in the event log. The log IS the run — a save file is
 * `seed + ordered event log`; everything else is derived by replaying it.
 *
 * - `seq`: monotonic index within this log, assigned at append time.
 * - `tick`: the universal game clock. Movement, actions, and failures all
 *   cost ticks; downstream systems (faction updates, market drift, event
 *   rolls) key off this field starting in later phases.
 * - `type`: a namespaced event kind, e.g. "oracle:chess-move" or "party:move".
 * - `payload`: event-specific data. Must be JSON-serializable (Gate 4).
 */
export interface Event<T = unknown> {
  readonly seq: number;
  readonly tick: number;
  readonly type: string;
  readonly payload: T;
}
