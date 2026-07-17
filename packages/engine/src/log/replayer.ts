import type { Event } from "./types.js";

/** Pure state transition: given a state and one event, produce the next state. */
export type Reducer<S> = (state: S, event: Event) => S;

/**
 * Replays a full event log from an initial state through a pure reducer.
 * This is the entire mechanism by which "seed + log" reconstructs a run:
 * no hidden state, no side effects, no reliance on anything but the
 * events themselves.
 */
export function replay<S>(initial: S, events: Iterable<Event>, reducer: Reducer<S>): S {
  let state = initial;
  for (const event of events) {
    state = reducer(state, event);
  }
  return state;
}
